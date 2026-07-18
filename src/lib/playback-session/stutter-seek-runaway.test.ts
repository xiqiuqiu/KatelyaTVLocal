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
  // Earlier in this Playback Session the stream already stalled across this
  // region, so Bad Points are remembered along it.
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
 * Regression for the "拖动进度条后进度条自动不停向前跳，一直跳到结尾" bug.
 *
 * Root cause: `recovery.progressHealthy` cleared the whole Stall Episode on any
 * momentary progress, so a stuttering source (each escape plays a blip then
 * stalls) reset the R2/R3 budget every cycle and the bad-point skip-forward
 * escape ratcheted the playhead to the end of the video, never switching source.
 */
describe('stutter → bad-point escape must not ratchet to the end', () => {
  it('bounds the forward escapes and escalates to a source switch', () => {
    const DURATION = 1200;
    let state = seedStallProneTail(loadPlayableAlts(), DURATION);
    let currentTime = 300; // user just dragged here
    let now = 10_000;

    // Move past the post-seek grace so this test isolates the escape budget,
    // not the post-seek suppression (covered separately below).
    state = reducePlaybackSession(state, {
      type: 'user.seekStarted',
      nowMs: now,
    }).state;
    now += 500;
    state = reducePlaybackSession(state, {
      type: 'user.seekSettled',
      nowMs: now,
    }).state;
    now += state.seekSettledLongGuardMs + 1000;

    const forwardJumps: number[] = [];
    let switched = false;

    for (let spot = 0; spot < 200 && !switched; spot += 1) {
      let escaped = false;
      // Sustained buffering for this spot: waiting events, no healthy progress.
      for (let w = 0; w < 12 && !escaped && !switched; w += 1) {
        now += 1500;
        const stall = reducePlaybackSession(state, {
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
            escaped = true;
          } else if (recover.targetTime != null) {
            currentTime = recover.targetTime;
            escaped = true;
          }
          now += 100;
          state = reducePlaybackSession(state, {
            type: 'recovery.effectSettled',
            kind: recover.stage,
            nowMs: now,
          }).state;
        }
      }

      // Choppy playback: a short blip (< sustained threshold), several small
      // healthy ticks that never reach a sustained healthy run.
      for (let k = 0; k < 2; k += 1) {
        currentTime = Math.min(DURATION, currentTime + 0.4);
        now += 400;
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

    expect(switched).toBe(true);
    expect(forwardJumps.length).toBeLessThanOrEqual(MAX_ESCAPE_COUNT);
    const totalForward = forwardJumps.reduce((a, b) => a + b, 0);
    expect(totalForward).toBeLessThanOrEqual(
      MAX_ESCAPE_FORWARD_SPAN_SECONDS + 25
    );
    // The playhead must never be ratcheted anywhere near the end of the video.
    expect(currentTime).toBeLessThan(500);
  });

  it('sustained healthy playback ends the episode (no false runaway)', () => {
    const DURATION = 1200;
    let state = seedStallProneTail(loadPlayableAlts(), DURATION);
    let currentTime = 300;
    let now = 10_000;

    // One genuine stall, then the source recovers and plays cleanly for a while.
    now += 1500;
    state = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: now,
      snapshot: { currentTime, duration: DURATION },
    }).state;

    // Sustained healthy progress (playhead tracks wall-clock for > threshold).
    let ended = false;
    for (let k = 0; k < 12; k += 1) {
      currentTime += 0.5;
      now += 500;
      const result = reducePlaybackSession(state, {
        type: 'recovery.progressHealthy',
        nowMs: now,
        snapshot: { currentTime, duration: DURATION },
      });
      state = result.state;
      if (
        result.effects.some(
          (e) =>
            e.type === 'emitDebugEvent' &&
            e.eventType === 'recovery.stall-episode.ended'
        )
      ) {
        ended = true;
        break;
      }
    }

    expect(ended).toBe(true);
    expect(state.stallEpisodeActive).toBe(false);
    expect(state.escapeCount).toBe(0);
    expect(state.escapeForwardSpanSeconds).toBe(0);
  });
});

describe('post-seek grace respects the user-chosen position', () => {
  it('does not skip forward off a pre-existing bad point right after a seek', () => {
    const DURATION = 1200;
    let state = seedStallProneTail(loadPlayableAlts(), DURATION);
    const currentTime = 305; // dragged straight onto a remembered bad point
    let now = 10_000;

    state = reducePlaybackSession(state, {
      type: 'user.seekStarted',
      nowMs: now,
    }).state;
    now += 300;
    state = reducePlaybackSession(state, {
      type: 'user.seekSettled',
      nowMs: now,
    }).state;
    const seekSettledAtMs = now;
    const longGuardMs = state.seekSettledLongGuardMs;

    // Buffering right after the seek, strictly inside the long guard window
    // (past the short guard that blocks all same-source recovery): recovery
    // must prefer in-place reload, never a forward escape.
    now = seekSettledAtMs + state.seekSettledShortGuardMs + 100;
    const actions: Array<{ action: string; targetTime: number | null }> = [];
    while (now - seekSettledAtMs < longGuardMs - 200) {
      const result = reducePlaybackSession(state, {
        type: 'video.waiting',
        nowMs: now,
        snapshot: { currentTime, duration: DURATION },
      });
      state = result.state;
      const recover = findSameSourceRecover(result.effects);
      if (recover) {
        actions.push({ action: recover.action, targetTime: recover.targetTime });
        now += 50;
        state = reducePlaybackSession(state, {
          type: 'recovery.effectSettled',
          kind: recover.stage,
          nowMs: now,
        }).state;
      }
      now += 1500;
    }

    // At least one recovery action fired, and none of them skipped forward.
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(a.action).not.toBe('escape-bad-point');
      if (a.targetTime != null) {
        expect(a.targetTime).toBeLessThanOrEqual(currentTime);
      }
    }
  });
});
