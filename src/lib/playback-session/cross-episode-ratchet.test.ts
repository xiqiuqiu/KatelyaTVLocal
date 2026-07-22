import {
  createInitialPlaybackSessionState,
  reducePlaybackSession,
} from '@/lib/playback-session';
import {
  MAX_ESCAPE_COUNT,
  MAX_ESCAPE_FORWARD_SPAN_SECONDS,
} from '@/lib/playback-session/recovery';
import type {
  PlaybackSessionEffect,
  PlaybackSessionState,
} from '@/lib/playback-session/types';
import type { SearchResult, SourceStatus } from '@/lib/types';

function createSource(source: string, id: string): SearchResult {
  return {
    id,
    source,
    title: `${source}-${id}`,
    year: '2026',
    poster: '',
    episodes: ['ep-1.m3u8', 'ep-2.m3u8', 'ep-3.m3u8'],
    source_name: source,
  };
}

function loadPlayableAlts(): PlaybackSessionState {
  const sources = [
    createSource('current', '1'),
    createSource('proxy', '4'),
    createSource('direct', '5'),
  ];
  return reducePlaybackSession(createInitialPlaybackSessionState(), {
    type: 'sources.loaded',
    sources,
    currentSourceKey: 'current-1',
    currentEpisodeIndex: 2,
    contentKey: 'title::2026',
    sourceStatuses: new Map<string, SourceStatus>([
      ['proxy-4', { kind: 'proxy' }],
      ['direct-5', { kind: 'direct' }],
    ]),
    sourceScores: new Map([
      ['proxy-4', { score: 99 }],
      ['direct-5', { score: 10 }],
    ]),
  }).state;
}

function seedStallProneTail(
  state: PlaybackSessionState,
  duration: number
): PlaybackSessionState {
  const badPoints = [] as PlaybackSessionState['badPoints'];
  for (let t = 305; t < duration; t += 12) {
    badPoints.push({
      sourceKey: 'current-1',
      timeSeconds: t,
      hitCount: 1,
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

/**
 * Regression for the iOS "卡顿时进度自动往前加载、一路窜到片尾" runaway.
 *
 * Root cause: the escape budget only guarded R2, and a ≥1.5s healthy beat
 * cleared the whole Stall Episode (and the budget) every cycle. On a stuttering
 * source that recovers for a beat between stalls, the FIRST recovery of each
 * fresh episode (R1 `resume-playback` on iOS native / `nudge-playback` on
 * HLS.js) skipped +20s off a Bad Point — uncounted — so the playhead ratcheted
 * to the end and never switched source.
 *
 * Fix: R1 forward skips are charged against the same escape budget as R2, and a
 * short healthy beat ends the episode WITHOUT clearing that budget (only a long
 * continuous healthy run, a user seek, or a source/episode change clears it).
 */
describe('stutter that recovers between stalls must not ratchet across episodes', () => {
  function runStutter(platform: 'apple-native' | 'hlsjs') {
    const DURATION = 1200;
    let state = seedStallProneTail(loadPlayableAlts(), DURATION);
    let currentTime = 300;
    let now = 10_000;

    const forwardJumps: number[] = [];
    let switched = false;

    for (let spot = 0; spot < 400 && !switched; spot += 1) {
      let recovered = false;
      for (let w = 0; w < 12 && !recovered && !switched; w += 1) {
        now += 1500;
        const stall =
          platform === 'apple-native'
            ? reducePlaybackSession(state, {
                type: 'recovery.runtimeEvidence',
                nowMs: now,
                snapshot: {
                  currentTime,
                  duration: DURATION,
                  readyState: 4,
                  networkState: 2,
                  paused: false,
                  ended: false,
                  playbackUrl: 'ep-3.m3u8',
                },
                evidence: {
                  platform: 'apple-native',
                  stallCandidate: true,
                  native: {
                    severity: 'soft-stall',
                    isJitter: false,
                    jitterWindowCount: 0,
                  },
                },
              })
            : reducePlaybackSession(state, {
                type: 'video.waiting',
                nowMs: now,
                snapshot: { currentTime, duration: DURATION },
              });
        state = stall.state;

        if (stall.effects.some((e) => e.type === 'switchSource')) {
          switched = true;
          break;
        }

        const recover = findSameSourceRecover(stall.effects);
        if (recover) {
          if (recover.targetTime != null && recover.targetTime > currentTime) {
            forwardJumps.push(recover.targetTime - currentTime);
            currentTime = recover.targetTime;
            recovered = true;
          } else if (recover.targetTime != null) {
            currentTime = recover.targetTime;
            recovered = true;
          }
          now += 100;
          state = reducePlaybackSession(state, {
            type: 'recovery.effectSettled',
            kind: recover.stage,
            nowMs: now,
          }).state;
        }
      }

      // Choppy playback: a short healthy beat (enough to end a Stall Episode
      // but well under the long budget-reset threshold), then it stalls again.
      for (let k = 0; k < 5; k += 1) {
        currentTime = Math.min(DURATION, currentTime + 0.5);
        now += 500;
        state = reducePlaybackSession(state, {
          type: 'recovery.progressHealthy',
          nowMs: now,
          snapshot: { currentTime, duration: DURATION },
        }).state;
      }

      if (currentTime >= DURATION - 3) {
        break;
      }
    }

    const totalForward = forwardJumps.reduce((a, b) => a + b, 0);
    return { currentTime, forwardJumps, totalForward, switched };
  }

  it('bounds forward progress and escalates to a source switch (iOS native)', () => {
    const { currentTime, forwardJumps, totalForward, switched } =
      runStutter('apple-native');

    expect(switched).toBe(true);
    // A few Bad-Point skips are allowed, but the escape budget must cap them.
    expect(forwardJumps.length).toBeLessThanOrEqual(MAX_ESCAPE_COUNT);
    expect(totalForward).toBeLessThanOrEqual(MAX_ESCAPE_FORWARD_SPAN_SECONDS + 25);
    // The playhead must never be ratcheted anywhere near the end of the video.
    expect(currentTime).toBeLessThan(500);
  });

  it('bounds forward progress and escalates to a source switch (HLS.js)', () => {
    const { currentTime, forwardJumps, totalForward, switched } =
      runStutter('hlsjs');

    expect(switched).toBe(true);
    expect(forwardJumps.length).toBeLessThanOrEqual(MAX_ESCAPE_COUNT);
    expect(totalForward).toBeLessThanOrEqual(MAX_ESCAPE_FORWARD_SPAN_SECONDS + 25);
    expect(currentTime).toBeLessThan(500);
  });
});
