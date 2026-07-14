import { getHlsRecoveryPlan } from '@/lib/hls-recovery';
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
 * 1) R2 effectSettled must not park on resume (blocks further escalation)
 * 2) HLS stallCount/window ≥5 must escalate like legacy getHlsRecoveryPlan
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
          expect(state.recoveryResumeTime).toBeNull();

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

  it('emits switchSource when HLS feeds the same non-fatal stall evidence legacy would switch on', () => {
    const legacy = getHlsRecoveryPlan({
      fatal: false,
      errorType: 'mediaError',
      errorDetails: 'bufferStalledError',
      playbackMode: 'direct',
      stallCount: 5,
      stallWindowCount: 5,
      networkRecoveryAttempts: 1,
      mediaRecoveryAttempts: 1,
      hasAlternativeSource: true,
    });
    expect(legacy.action).toBe('switch-source');

    const result = reducePlaybackSession(loadPlayableAlts(), {
      type: 'recovery.runtimeEvidence',
      nowMs: 10_000,
      snapshot: { currentTime: 120 },
      evidence: {
        platform: 'hlsjs',
        stallCandidate: true,
        hardFailure: false,
        hls: {
          stallCount: 5,
          stallWindowCount: 5,
          fatal: false,
          errorType: 'mediaError',
        },
      },
    });

    expect(result.effects.some((e) => e.type === 'switchSource')).toBe(true);
    expect(result.state.recoveryStage).toBe('R3');
  });

  it('eventually emits switchSource after soft waiting ladder with settles', () => {
    let state = loadPlayableAlts();
    let switched = false;

    for (let tick = 0; tick < 20; tick += 1) {
      const nowMs = 10_000 + tick * 3_000;
      const result = reducePlaybackSession(state, {
        type: 'video.waiting',
        nowMs,
        snapshot: { currentTime: 120 },
      });
      state = result.state;

      if (result.effects.some((e) => e.type === 'switchSource')) {
        switched = true;
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
  });
});
