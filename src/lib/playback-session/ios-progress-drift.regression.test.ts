import { shouldStampSeekingPlaybackIntent } from '@/lib/playback-seek-intent';
import {
  createInitialPlaybackSessionState,
  reducePlaybackSession,
} from '@/lib/playback-session';
import {
  MAX_ESCAPE_COUNT,
  MAX_ESCAPE_FORWARD_SPAN_SECONDS,
  PREFER_R2_MIN_JITTER_WINDOWS,
} from '@/lib/playback-session/recovery';
import type {
  PlaybackSessionEffect,
  PlaybackSessionState,
} from '@/lib/playback-session/types';
import type { SearchResult, SourceStatus } from '@/lib/types';

/**
 * Regression for prod session 8bd17d7d (家业 ep39, iOS native-hls):
 * jitter → R2 +20 → escape budget exhausted → iOS spurious seeking wiped the
 * budget / gated recovery → more +20 jumps → progress drift persisted.
 *
 * Seams: session reducer + seek-intent classifier (page adapter consumes both).
 */

function createSource(source: string, id: string): SearchResult {
  return {
    id,
    source,
    title: `${source}-${id}`,
    year: '2026',
    poster: '',
    episodes: ['ep-1.m3u8'],
    source_name: source,
  };
}

function loadPlayableAlts(): PlaybackSessionState {
  const sources = [createSource('current', '1'), createSource('alt', '2')];
  return reducePlaybackSession(createInitialPlaybackSessionState(), {
    type: 'sources.loaded',
    sources,
    currentSourceKey: 'current-1',
    currentEpisodeIndex: 0,
    contentKey: 'title::2026',
    sourceStatuses: new Map<string, SourceStatus>([
      ['alt-2', { kind: 'direct' }],
    ]),
    sourceScores: new Map([['alt-2', { score: 80 }]]),
  }).state;
}

function seedDenseBadPoints(
  state: PlaybackSessionState,
  from: number,
  to: number
): PlaybackSessionState {
  const badPoints = [] as PlaybackSessionState['badPoints'];
  for (let t = from; t <= to; t += 10) {
    badPoints.push({
      sourceKey: 'current-1',
      timeSeconds: t,
      hitCount: 2,
      updatedAtMs: 1_000,
    });
  }
  return { ...state, badPoints };
}

function findSameSourceRecover(
  effects: PlaybackSessionEffect[]
): Extract<PlaybackSessionEffect, { type: 'sameSourceRecover' }> | null {
  const effect = effects.find((e) => e.type === 'sameSourceRecover');
  return effect && effect.type === 'sameSourceRecover' ? effect : null;
}

function findSwitchSource(
  effects: PlaybackSessionEffect[]
): Extract<PlaybackSessionEffect, { type: 'switchSource' }> | null {
  const effect = effects.find((e) => e.type === 'switchSource');
  return effect && effect.type === 'switchSource' ? effect : null;
}

function dispatchJitter(
  state: PlaybackSessionState,
  currentTime: number,
  now: number,
  jitterWindowCount: number
) {
  return reducePlaybackSession(state, {
    type: 'recovery.runtimeEvidence',
    nowMs: now,
    snapshot: {
      currentTime,
      duration: 2800,
      readyState: 3,
      networkState: 2,
      paused: false,
      ended: false,
      playbackUrl: 'https://example.com/index.m3u8',
    },
    evidence: {
      platform: 'apple-native',
      stallCandidate: true,
      native: {
        severity: 'soft-stall',
        isJitter: true,
        jitterWindowCount,
      },
    },
  });
}

describe('iOS progress drift regression (prod 8bd17d7d)', () => {
  it('does not prefer R2 on weak jitter (below preferR2 threshold)', () => {
    const state = seedDenseBadPoints(loadPlayableAlts(), 300, 400);
    const weak = Math.max(1, PREFER_R2_MIN_JITTER_WINDOWS - 1);
    const result = dispatchJitter(state, 310, 20_000, weak);
    const recover = findSameSourceRecover(result.effects);
    // Weak jitter may enter R0 observe, but must not immediately escape +20.
    expect(recover?.action === 'escape-bad-point').toBe(false);
  });

  it('keeps escape budget after ambiguous seeking noise and escalates to R3', () => {
    let state = seedDenseBadPoints(loadPlayableAlts(), 2100, 2600);
    let currentTime = 2176;
    let now = 1_000_000;
    const forwardJumps: number[] = [];
    let switched = false;

    const applyJitterBurst = (jitterWindowCount: number) => {
      for (let i = 0; i < 8 && !switched; i += 1) {
        now += 300;
        const result = dispatchJitter(
          state,
          currentTime,
          now,
          jitterWindowCount
        );
        state = result.state;

        if (findSwitchSource(result.effects)) {
          switched = true;
          break;
        }

        const recover = findSameSourceRecover(result.effects);
        if (recover?.targetTime != null && recover.targetTime > currentTime) {
          forwardJumps.push(recover.targetTime - currentTime);
          currentTime = recover.targetTime;
          now += 50;
          state = reducePlaybackSession(state, {
            type: 'recovery.effectSettled',
            kind: recover.stage,
            nowMs: now,
          }).state;
        }

        // Short healthy beat between stalls (preserves budget).
        for (let h = 0; h < 4; h += 1) {
          currentTime += 0.4;
          now += 400;
          state = reducePlaybackSession(state, {
            type: 'recovery.progressHealthy',
            nowMs: now,
            snapshot: { currentTime, duration: 2800 },
          }).state;
        }
      }
    };

    applyJitterBurst(PREFER_R2_MIN_JITTER_WINDOWS);
    const afterFirstBudget = forwardJumps.reduce((a, b) => a + b, 0);
    expect(afterFirstBudget).toBeGreaterThan(0);
    expect(afterFirstBudget).toBeLessThanOrEqual(
      MAX_ESCAPE_FORWARD_SPAN_SECONDS + 25
    );

    // Prod failure mode: iOS fires seeking with a small delta after escapes.
    const stampSeeking = shouldStampSeekingPlaybackIntent({
      systemSeekInFlight: false,
      recoveryInFlight: state.recoveryInFlight,
      automaticRecoveryGraceActive: false,
      stallEpisodeActive: state.stallEpisodeActive,
      escapeBudgetCharged:
        state.escapeCount > 0 || state.escapeForwardSpanSeconds > 0,
      seekDeltaSeconds: 2.2,
    });
    expect(stampSeeking).toBe(false);

    // Adapter must not dispatch user.seekStarted when unclassified as user.
    // Belt-and-suspenders: even a mistaken dispatch during recoveryInFlight
    // must not wipe the budget.
    if (state.recoveryInFlight) {
      const before = state.escapeCount;
      state = reducePlaybackSession(state, {
        type: 'user.seekStarted',
        nowMs: now,
      }).state;
      expect(state.escapeCount).toBe(before);
    } else if (state.escapeCount > 0) {
      const beforeCount = state.escapeCount;
      const beforeSpan = state.escapeForwardSpanSeconds;
      // Mistaken dispatch without confirmed gesture — reducer preserves budget.
      state = reducePlaybackSession(state, {
        type: 'user.seekStarted',
        nowMs: now,
        confirmedUserGesture: false,
      }).state;
      expect(state.escapeCount).toBe(beforeCount);
      expect(state.escapeForwardSpanSeconds).toBe(beforeSpan);
      expect(state.playbackIntent).not.toBe('seeking');
    }

    const jumpsBeforeSecondBurst = forwardJumps.length;
    applyJitterBurst(PREFER_R2_MIN_JITTER_WINDOWS + 1);

    const totalForward = forwardJumps.reduce((a, b) => a + b, 0);
    // Must not open a second full +60s window after ambiguous seeking.
    expect(totalForward).toBeLessThanOrEqual(
      MAX_ESCAPE_FORWARD_SPAN_SECONDS + 25
    );
    expect(forwardJumps.length - jumpsBeforeSecondBurst).toBeLessThanOrEqual(1);
    expect(forwardJumps.length).toBeLessThanOrEqual(MAX_ESCAPE_COUNT + 1);
    expect(switched).toBe(true);
  });
});
