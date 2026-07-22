import {
  createInitialPlaybackSessionState,
  reducePlaybackSession,
} from '@/lib/playback-session';
import {
  HEALTHY_SUSTAINED_SECONDS,
  RECOVERY_R0_SOFT_OBSERVE_MS,
} from '@/lib/playback-session/recovery';
import { allowsAutomaticEffect } from '@/lib/playback-session/intent';
import type {
  PlaybackSessionEffect,
  PlaybackSessionState,
} from '@/lib/playback-session/types';
import type { SearchResult, SourceStatus } from '@/lib/types';

/**
 * Regression for prod session 209f363a (家业 ep41, iPhone native-hls):
 * 1) R0 thrash — ~1.5s healthy gaps end Stall Episodes before R0 observe (2.5s)
 *    can escalate to R1.
 * 2) Ambiguous iOS seeking is ignored on seekStarted, but a bare seekSettled
 *    still stamped seek-settled and gated same-source recovery.
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
    contentKey: '家业::2026',
    sourceStatuses: new Map<string, SourceStatus>([
      ['alt-2', { kind: 'direct' }],
    ]),
    sourceScores: new Map([['alt-2', { score: 80 }]]),
  }).state;
}

function findSameSourceRecover(
  effects: PlaybackSessionEffect[]
): Extract<PlaybackSessionEffect, { type: 'sameSourceRecover' }> | null {
  const effect = effects.find((e) => e.type === 'sameSourceRecover');
  return effect && effect.type === 'sameSourceRecover' ? effect : null;
}

describe('家业 iOS stall ladder (prod 209f363a)', () => {
  it('keeps HEALTHY_SUSTAINED longer than R0 soft observe so soft stalls can escalate', () => {
    expect(HEALTHY_SUSTAINED_SECONDS * 1000).toBeGreaterThan(
      RECOVERY_R0_SOFT_OBSERVE_MS
    );
  });

  it('escalates R0 → R1 across brief healthy gaps shorter than the observe window', () => {
    let state = loadPlayableAlts();
    let currentTime = 1311.0;
    let now = 1_000_000;
    let reachedR1 = false;

    // Prod shape (fixture p50): waiting → ~1.5s real progress → waiting again.
    // First progressHealthy tick only arms the anchor, so use >1.5s of follow-on
    // progress to actually end the episode under the old 1.5s threshold.
    for (let cycle = 0; cycle < 5 && !reachedR1; cycle += 1) {
      state = reducePlaybackSession(state, {
        type: 'video.waiting',
        nowMs: now,
        snapshot: { currentTime, duration: 2772, paused: false },
      }).state;

      // ~2.0s continuous healthy playhead (fixture gaps were ~1.5–1.6s of
      // sustained advance after the anchor tick).
      for (let step = 0; step < 8; step += 1) {
        now += 250;
        currentTime += 0.25;
        state = reducePlaybackSession(state, {
          type: 'recovery.progressHealthy',
          nowMs: now,
          snapshot: { currentTime, duration: 2772, paused: false },
        }).state;
      }

      now += 300;
      const result = reducePlaybackSession(state, {
        type: 'video.waiting',
        nowMs: now,
        snapshot: { currentTime, duration: 2772, paused: false },
      });
      state = result.state;
      if (
        state.recoveryStage === 'R1' ||
        findSameSourceRecover(result.effects)
      ) {
        reachedR1 = true;
      }
    }

    expect(reachedR1).toBe(true);
    expect(state.recoveryStage).toBe('R1');
  });

  it('does not stamp seek-settled from a bare seekSettled after ambiguous seeking', () => {
    let state = loadPlayableAlts();
    const now = 2_000_000;

    // Ambiguous iOS seeking: reducer ignores seekStarted.
    state = reducePlaybackSession(state, {
      type: 'user.seekStarted',
      nowMs: now,
      confirmedUserGesture: false,
    }).state;
    expect(state.playbackIntent).toBe('playing');

    // Native seeked still fires — must NOT arm seek-settled guards.
    state = reducePlaybackSession(state, {
      type: 'user.seekSettled',
      nowMs: now + 50,
    }).state;

    expect(state.playbackIntent).toBe('playing');
    expect(state.seekSettledAtMs).toBeNull();
    expect(
      allowsAutomaticEffect(state, 'same-source-recovery', now + 100)
    ).toBe(true);
  });
});
