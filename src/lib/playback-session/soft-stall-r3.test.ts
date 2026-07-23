import {
  createInitialPlaybackSessionState,
  reducePlaybackSession,
} from '@/lib/playback-session';
import type { SearchResult, SourceStatus } from '@/lib/types';

function createSource(
  source: string,
  id: string,
  episodes: string[] = ['ep-1.m3u8', 'ep-2.m3u8', 'ep-3.m3u8']
): SearchResult {
  return {
    id,
    source,
    title: `${source}-${id}`,
    year: '2026',
    poster: '',
    episodes,
    source_name: source,
  };
}

function loadPlayableAlts() {
  const sources = [
    createSource('current', '1'),
    createSource('short', '2', ['ep-1.m3u8']),
    createSource('bad', '3'),
    createSource('proxy', '4'),
    createSource('direct', '5'),
  ];
  return reducePlaybackSession(createInitialPlaybackSessionState(), {
    type: 'sources.loaded',
    sources,
    currentSourceKey: 'current-1',
    currentEpisodeIndex: 2,
    sourceStatuses: new Map<string, SourceStatus>([
      ['bad-3', { kind: 'unavailable' }],
      ['proxy-4', { kind: 'proxy' }],
      ['direct-5', { kind: 'direct' }],
    ]),
    sourceScores: new Map([
      ['proxy-4', { score: 99 }],
      ['direct-5', { score: 10 }],
    ]),
  }).state;
}

/**
 * Regression: sustained soft stuttering must reach R3 auto source-switch.
 * Root causes locked here:
 * 1) R2 effectSettled must clear in-flight (not park on resume) so soft stalls
 *    can keep escalating — while keeping Recovery Resume Time for later R3
 * 2) Sustained soft stalls must exhaust the shared R ladder before R3.
 */
describe('soft-stall → R3 auto source-switch', () => {
  it('clears in-flight after a single R2 settle so soft stalls can continue', () => {
    let state = loadPlayableAlts();

    for (let tick = 0; tick < 10; tick += 1) {
      const nowMs = 10_000 + tick * 3_000;
      const result = reducePlaybackSession(state, {
        type: 'video.waiting',
        nowMs,
        snapshot: { currentTime: 120 },
      });
      state = result.state;

      const sameSource = result.effects.find(
        (e) => e.type === 'sameSourceRecover'
      );
      if (sameSource && sameSource.type === 'sameSourceRecover') {
        state = reducePlaybackSession(state, {
          type: 'recovery.effectSettled',
          kind: sameSource.stage as 'R1' | 'R2',
          nowMs: nowMs + 100,
        }).state;

        if (sameSource.stage === 'R2') {
          expect(state.recoveryInFlight).toBeNull();
          // Keep Recovery Resume Time after R2 so a later R3 can seed even if
          // the media element briefly reports currentTime≈0.

          const continued = reducePlaybackSession(state, {
            type: 'video.waiting',
            nowMs: nowMs + 5_000,
            snapshot: { currentTime: 125 },
          });
          // Must not be silently ignored due to resume parking.
          expect(
            continued.state.recoveryInFlight === 'resume' &&
              continued.effects.length === 0
          ).toBe(false);
          return;
        }
      }
    }

    throw new Error('never reached R2');
  });

  it('does not treat repeated callbacks from one soft stall as five independent stalls', () => {
    let state = loadPlayableAlts();
    const effects = [];

    for (let count = 1; count <= 5; count += 1) {
      const result = reducePlaybackSession(state, {
        type: 'recovery.runtimeEvidence',
        nowMs: 10_000 + count * 300,
        snapshot: { currentTime: 120 },
        evidence: {
          platform: 'hlsjs',
          stallCandidate: true,
          hardFailure: false,
          hls: {
            stallCount: count,
            stallWindowCount: count,
            fatal: false,
            errorType: 'mediaError',
          },
        },
      });
      state = result.state;
      effects.push(...result.effects);
    }

    expect(effects.some((effect) => effect.type === 'switchSource')).toBe(
      false
    );
    expect(state.recoveryStage).toBe('R0');
  });

  it('starts a settle window when an automatic source change completes', () => {
    const started = reducePlaybackSession(loadPlayableAlts(), {
      type: 'sourceChange.started',
      attemptId: 1,
      sourceKey: 'direct-5',
    }).state;

    const completed = reducePlaybackSession(started, {
      type: 'sourceChange.completed',
      attemptId: 1,
      sourceKey: 'direct-5',
      nowMs: 10_000,
      automatic: true,
    }).state;

    expect(completed.sourceSwitchSettledUntilMs).toBe(12_000);
    expect(
      reducePlaybackSession(completed, {
        type: 'recovery.runtimeEvidence',
        nowMs: 10_100,
        snapshot: { currentTime: 120 },
        evidence: {
          platform: 'hlsjs',
          stallCandidate: true,
          hardFailure: false,
          hls: {
            stallCount: 5,
            stallWindowCount: 5,
            fatal: false,
          },
        },
      }).effects
    ).toEqual([
      expect.objectContaining({
        type: 'emitDebugEvent',
        eventType: 'intent.gate.denied',
        details: expect.objectContaining({ deniedBy: 'source-switch-settle' }),
      }),
    ]);
  });

  it('ignores completion from a different source in the same attempt', () => {
    const started = reducePlaybackSession(loadPlayableAlts(), {
      type: 'sourceChange.started',
      attemptId: 1,
      sourceKey: 'direct-5',
    }).state;

    const completed = reducePlaybackSession(started, {
      type: 'sourceChange.completed',
      attemptId: 1,
      sourceKey: 'proxy-4',
      nowMs: 10_000,
      automatic: true,
    });

    expect(completed.state).toBe(started);
    expect(completed.effects).toEqual([]);
  });

  it('does not add the automatic settle window to manual source changes', () => {
    const started = reducePlaybackSession(loadPlayableAlts(), {
      type: 'sourceChange.started',
      attemptId: 1,
      sourceKey: 'direct-5',
    }).state;

    const completed = reducePlaybackSession(started, {
      type: 'sourceChange.completed',
      attemptId: 1,
      sourceKey: 'direct-5',
      nowMs: 10_000,
      automatic: false,
    }).state;

    expect(completed.sourceSwitchSettledUntilMs).toBeNull();
  });

  it('keeps fatal errors on the fast switch path during settle', () => {
    const settling = {
      ...loadPlayableAlts(),
      sourceSwitchSettledUntilMs: 12_000,
    };

    const result = reducePlaybackSession(settling, {
      type: 'video.error',
      nowMs: 10_100,
      snapshot: { currentTime: 120 },
      errorCode: 3,
    });

    expect(
      result.effects.some((effect) => effect.type === 'switchSource')
    ).toBe(true);
  });

  it('eventually emits switchSource after soft waiting ladder with settles', () => {
    let state = loadPlayableAlts();
    let switched = false;
    let switchResumeTime: number | null | undefined;

    for (let tick = 0; tick < 20; tick += 1) {
      const nowMs = 10_000 + tick * 3_000;
      const result = reducePlaybackSession(state, {
        type: 'video.waiting',
        nowMs,
        snapshot: { currentTime: 120 },
      });
      state = result.state;

      const switchEffect = result.effects.find((e) => e.type === 'switchSource');
      if (switchEffect && switchEffect.type === 'switchSource') {
        switched = true;
        switchResumeTime = switchEffect.resumeTime;
        break;
      }

      const sameSource = result.effects.find(
        (e) => e.type === 'sameSourceRecover'
      );
      if (sameSource && sameSource.type === 'sameSourceRecover') {
        state = reducePlaybackSession(state, {
          type: 'recovery.effectSettled',
          kind: sameSource.stage as 'R1' | 'R2',
          nowMs: nowMs + 100,
        }).state;
      }
    }

    expect(switched).toBe(true);
    // Session-layer R3 must carry a near-stuck resume point; page-layer canplay
    // races are covered separately in play/page.test.tsx.
    expect(switchResumeTime).toBeGreaterThan(100);
  });

  /**
   * Prod symptom: after several soft delays the player auto-switches source,
   * but playback restarts at 0. If the media element briefly reports
   * currentTime≈0 after same-source reload/remount, R3 must still seed from
   * Recovery Resume Time / Bad Points — not treat 0 as the real playhead.
   */
  it('keeps R3 resume near the pre-stall playhead when currentTime collapses after R2 settle', () => {
    let state = loadPlayableAlts();
    let sawR2 = false;

    for (let tick = 0; tick < 20; tick += 1) {
      const nowMs = 10_000 + tick * 3_000;
      const result = reducePlaybackSession(state, {
        type: 'video.waiting',
        nowMs,
        snapshot: { currentTime: 120 },
      });
      state = result.state;

      const sameSource = result.effects.find(
        (e) => e.type === 'sameSourceRecover'
      );
      if (sameSource && sameSource.type === 'sameSourceRecover') {
        state = reducePlaybackSession(state, {
          type: 'recovery.effectSettled',
          kind: sameSource.stage as 'R1' | 'R2',
          nowMs: nowMs + 100,
        }).state;
        if (sameSource.stage === 'R2') {
          sawR2 = true;
          expect(state.recoveryInFlight).toBeNull();
          break;
        }
      }
    }

    expect(sawR2).toBe(true);

    // Media element collapsed to 0 after same-source reload — common before
    // the escape seek lands, or when ArtPlayer host briefly remounts.
    const collapsed = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 80_000,
      snapshot: { currentTime: 0 },
    });

    // Keep pumping the ladder until R3 if the first collapsed waiting only
    // re-enters observe / same-source recovery.
    let next = collapsed;
    for (let tick = 0; tick < 12 && !next.effects.some((e) => e.type === 'switchSource'); tick += 1) {
      const sameSource = next.effects.find((e) => e.type === 'sameSourceRecover');
      if (sameSource && sameSource.type === 'sameSourceRecover') {
        next = reducePlaybackSession(next.state, {
          type: 'recovery.effectSettled',
          kind: sameSource.stage as 'R1' | 'R2',
          nowMs: 80_100 + tick * 3_000,
        });
      }
      next = reducePlaybackSession(next.state, {
        type: 'video.waiting',
        nowMs: 81_000 + tick * 3_000,
        snapshot: { currentTime: 0 },
      });
    }

    const switchEffect = next.effects.find((e) => e.type === 'switchSource');
    expect(switchEffect).toBeDefined();
    expect(switchEffect && switchEffect.type === 'switchSource').toBe(true);
    if (!switchEffect || switchEffect.type !== 'switchSource') {
      throw new Error('expected switchSource');
    }

    // User was at ~120 before the stall cascade; restarting at 0 is the bug.
    expect(switchEffect.resumeTime).toBeGreaterThan(100);
  });
});
