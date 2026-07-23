import {
  createInitialPlaybackSessionState,
  reducePlaybackSession,
} from '@/lib/playback-session';
import type {
  PlaybackSessionEffect,
  PlaybackSessionState,
} from '@/lib/playback-session/types';
import {
  PLAYBACK_EDGE_REWIND_SECONDS,
  PLAYBACK_FALLBACK_SEGMENT_DURATION_SECONDS,
} from '@/lib/playback-stuck-escape';
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

function findSameSourceRecover(
  effects: PlaybackSessionEffect[]
): Extract<PlaybackSessionEffect, { type: 'sameSourceRecover' }> | null {
  const effect = effects.find((e) => e.type === 'sameSourceRecover');
  return effect && effect.type === 'sameSourceRecover' ? effect : null;
}

function findDebug(
  effects: PlaybackSessionEffect[],
  eventType: string
): Extract<PlaybackSessionEffect, { type: 'emitDebugEvent' }> | undefined {
  return effects.find(
    (e): e is Extract<PlaybackSessionEffect, { type: 'emitDebugEvent' }> =>
      e.type === 'emitDebugEvent' && e.eventType === eventType
  );
}

function withKnownFault(
  state: PlaybackSessionState,
  timeSeconds = 120
): PlaybackSessionState {
  return {
    ...state,
    badPoints: [
      {
        sourceKey: 'current-1',
        timeSeconds,
        hitCount: 1,
        updatedAtMs: 1_000,
      },
    ],
  };
}

/**
 * #48 / ADR 0007 — Segment-Scaled Escape + one-escape-then-R3 at the
 * Playback Session seam (events in → state + effects out).
 */
describe('Segment-Scaled Escape and Recovery Disclosure (#48)', () => {
  it('forward escape distance tracks provided playlist segment duration', () => {
    const stuckAt = 120;
    const segmentDuration = 4;
    const state = withKnownFault(loadPlayableAlts(), stuckAt);

    const r0 = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: {
        currentTime: stuckAt,
        nearbySegmentDurationSeconds: segmentDuration,
      },
    }).state;

    const escaped = reducePlaybackSession(r0, {
      type: 'video.waiting',
      nowMs: 12_600,
      snapshot: {
        currentTime: stuckAt,
        nearbySegmentDurationSeconds: segmentDuration,
      },
    });

    const recover = findSameSourceRecover(escaped.effects);
    expect(recover).toMatchObject({
      stage: 'R2',
      action: 'escape-bad-point',
    });
    expect(recover?.targetTime).toBe(
      Number((stuckAt + segmentDuration).toFixed(2))
    );

    const scaleEvent = findDebug(escaped.effects, 'recovery.escape.scaled');
    expect(scaleEvent?.details).toMatchObject({
      scale: 'playlist',
      segmentDurationSeconds: segmentDuration,
    });
  });

  it('uses mid-segment fallback when playlist duration is missing', () => {
    const stuckAt = 200;
    const state = withKnownFault(loadPlayableAlts(), stuckAt);

    const r0 = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: stuckAt },
    }).state;

    const escaped = reducePlaybackSession(r0, {
      type: 'video.waiting',
      nowMs: 12_600,
      snapshot: { currentTime: stuckAt },
    });

    const recover = findSameSourceRecover(escaped.effects);
    expect(recover?.targetTime).toBe(
      Number((stuckAt + PLAYBACK_FALLBACK_SEGMENT_DURATION_SECONDS).toFixed(2))
    );
    expect(recover?.targetTime).toBeLessThan(stuckAt + 12);

    const scaleEvent = findDebug(escaped.effects, 'recovery.escape.scaled');
    expect(scaleEvent?.details).toMatchObject({
      scale: 'fallback',
      segmentDurationSeconds: PLAYBACK_FALLBACK_SEGMENT_DURATION_SECONDS,
    });
  });

  it('second sustained stall after one forward escape escalates to R3', () => {
    const stuckAt = 120;
    let state = withKnownFault(loadPlayableAlts(), stuckAt);

    const r0 = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: stuckAt, nearbySegmentDurationSeconds: 6 },
    }).state;
    const escaped = reducePlaybackSession(r0, {
      type: 'video.waiting',
      nowMs: 12_600,
      snapshot: { currentTime: stuckAt, nearbySegmentDurationSeconds: 6 },
    });
    expect(findSameSourceRecover(escaped.effects)?.stage).toBe('R2');
    state = reducePlaybackSession(escaped.state, {
      type: 'recovery.effectSettled',
      kind: 'R2',
      nowMs: 12_700,
    }).state;

    // Still stalled after the single Segment-Scaled Escape → R3, not another jump.
    const after = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 15_200,
      snapshot: {
        currentTime: stuckAt + 6,
        nearbySegmentDurationSeconds: 6,
      },
    });

    expect(
      after.effects.some((effect) => effect.type === 'switchSource')
    ).toBe(true);
    expect(
      after.effects.some(
        (effect) =>
          effect.type === 'sameSourceRecover' &&
          effect.action === 'escape-bad-point' &&
          (effect.targetTime ?? 0) > stuckAt + 6
      )
    ).toBe(false);
  });

  it('small edge rewind does not consume the forward-escape quota', () => {
    const stuckAt = 150;
    let state = loadPlayableAlts();

    // No Bad Point yet → first R2 is a small edge rewind.
    let cursor = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: stuckAt },
    }).state;
    let sawEdgeRewind = false;
    // Exhaust soft R1 attempts so we reach R2 rewind.
    for (let i = 0; i < 6; i += 1) {
      const tick = reducePlaybackSession(cursor, {
        type: 'video.waiting',
        nowMs: 12_600 + i * 3_000,
        snapshot: { currentTime: stuckAt },
      });
      const recover = findSameSourceRecover(tick.effects);
      if (!recover) {
        cursor = tick.state;
        continue;
      }
      cursor = reducePlaybackSession(tick.state, {
        type: 'recovery.effectSettled',
        kind: recover.stage,
        nowMs: 12_700 + i * 3_000,
      }).state;
      if (recover.stage === 'R2' && recover.action === 'escape-bad-point') {
        expect(recover.targetTime).toBe(
          Number((stuckAt - PLAYBACK_EDGE_REWIND_SECONDS).toFixed(2))
        );
        expect(tick.state.escapeCount).toBe(0);
        state = cursor;
        sawEdgeRewind = true;
        break;
      }
    }

    expect(sawEdgeRewind).toBe(true);
    expect(state.escapeCount).toBe(0);
    expect(state.badPoints.length).toBeGreaterThan(0);

    // Next stall near the recorded Bad Point still gets one forward escape
    // (edge rewind did not consume the Stall Episode forward quota).
    const forward = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 30_000,
      snapshot: { currentTime: stuckAt, nearbySegmentDurationSeconds: 5 },
    });
    const forwardRecover = findSameSourceRecover(forward.effects);
    expect(forwardRecover).toMatchObject({
      stage: 'R2',
      action: 'escape-bad-point',
    });
    expect(forwardRecover?.targetTime).toBeGreaterThan(stuckAt);
    expect(forward.state.escapeCount).toBe(1);
  });

  it('emits R3 disclosure undo effect when auto-switching source', () => {
    const stuckAt = 120;
    let state = withKnownFault(loadPlayableAlts(), stuckAt);

    const r0 = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: stuckAt, nearbySegmentDurationSeconds: 6 },
    }).state;
    state = reducePlaybackSession(r0, {
      type: 'video.waiting',
      nowMs: 12_600,
      snapshot: { currentTime: stuckAt, nearbySegmentDurationSeconds: 6 },
    }).state;
    state = reducePlaybackSession(state, {
      type: 'recovery.effectSettled',
      kind: 'R2',
      nowMs: 12_700,
    }).state;

    const r3 = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 15_200,
      snapshot: { currentTime: stuckAt + 6, nearbySegmentDurationSeconds: 6 },
    });

    expect(r3.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'switchSource' }),
        expect.objectContaining({
          type: 'showAutoSourceSwitchUndo',
          previousSourceKey: 'current-1',
        }),
      ])
    );
    expect(r3.state.recoverableAutoSourceSwitch).toMatchObject({
      previousSourceKey: 'current-1',
    });
  });

  it('clears R3 undo disclosure when Playback Intent cancels recovery', () => {
    const stuckAt = 120;
    let state = withKnownFault(loadPlayableAlts(), stuckAt);

    const r0 = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: stuckAt, nearbySegmentDurationSeconds: 6 },
    }).state;
    state = reducePlaybackSession(r0, {
      type: 'video.waiting',
      nowMs: 12_600,
      snapshot: { currentTime: stuckAt, nearbySegmentDurationSeconds: 6 },
    }).state;
    state = reducePlaybackSession(state, {
      type: 'recovery.effectSettled',
      kind: 'R2',
      nowMs: 12_700,
    }).state;
    state = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 15_200,
      snapshot: { currentTime: stuckAt + 6, nearbySegmentDurationSeconds: 6 },
    }).state;
    expect(state.recoverableAutoSourceSwitch).not.toBeNull();

    const paused = reducePlaybackSession(state, { type: 'user.pause' });
    expect(paused.state.recoverableAutoSourceSwitch).toBeNull();
  });

  it('emits In-Player Failure State when recovery candidates are exhausted', () => {
    const alone = reducePlaybackSession(createInitialPlaybackSessionState(), {
      type: 'sources.loaded',
      sources: [createSource('current', '1')],
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
      contentKey: 'solo',
    }).state;

    const result = reducePlaybackSession(alone, {
      type: 'video.error',
      nowMs: 10_000,
      snapshot: { currentTime: 40 },
      errorCode: 3,
    });

    expect(result.state.recoveryStage).toBe('exhausted');
    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'showInPlayerFailure',
          reason: 'recovery-exhausted',
        }),
      ])
    );
  });
});
