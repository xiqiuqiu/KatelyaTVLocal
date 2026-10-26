import { executePlaybackSessionEffects } from './adapter-effects';
import { allowsAutomaticEffect } from './intent';
import {
  createInitialPlaybackSessionState,
  reducePlaybackSession,
} from './reducer';
import { isStartupWorkAllowed } from './startup-budget';
import type { PlaybackSessionEvent, PlaybackSessionState } from './types';
import type { SearchResult } from '../types';

const sources: SearchResult[] = ['first', 'second', 'third'].map((key) => ({
  source: key,
  id: '1',
  title: '测试',
  year: '2026',
  poster: '',
  source_name: key,
  episodes: ['https://example.com/video.m3u8'],
}));

function load(state: PlaybackSessionState, key = 'first-1') {
  return reducePlaybackSession(state, {
    type: 'sources.loaded',
    sources,
    currentSourceKey: key,
    currentEpisodeIndex: 0,
    contentKey: '测试::2026',
    sourceStatuses: new Map(
      sources.map((item) => [`${item.source}-1`, { kind: 'direct' }])
    ),
  }).state;
}

function start() {
  return reducePlaybackSession(load(createInitialPlaybackSessionState()), {
    type: 'startup.started',
    nowMs: 0,
  }).state;
}

function media(state: PlaybackSessionState, attemptId = 1, key = 'first-1') {
  return reducePlaybackSession(load(state, key), {
    type: 'sourceChange.started',
    attemptId,
    sourceKey: key,
  }).state;
}

function tick(state: PlaybackSessionState, nowMs: number, currentTime = 0) {
  return reducePlaybackSession(state, {
    type: 'startup.tick',
    nowMs,
    snapshot: { currentTime },
  });
}

function sourceTimeout(
  state: PlaybackSessionState,
  attemptId = 1,
  sourceKey = 'first-1'
) {
  return reducePlaybackSession(state, {
    type: 'timer.sourceChangeTimeout',
    attemptId,
    sourceKey,
    nowMs: 1_000_000,
    snapshot: { currentTime: 0 },
  });
}

describe('startup budget authority', () => {
  it('counts preparation before a media element exists and emits only one exhaustion', () => {
    const running = reducePlaybackSession(createInitialPlaybackSessionState(), {
      type: 'startup.started',
      startedAtMs: 100,
      nowMs: 2100,
    }).state;
    expect(running.startup?.activeWaitMs).toBe(2000);
    expect(tick(running, 30099).effects).toEqual([]);
    const expired = tick(running, 30100);
    expect(expired.state.startup?.status).toBe('waiting-choice');
    expect(expired.effects).toEqual([
      { type: 'startupBudgetExhausted', sourceKey: null, attemptId: null },
    ]);
    expect(tick(expired.state, 60_000).effects).toEqual([]);
  });

  it('does not count pre-entry time while the page is hidden', () => {
    const running = reducePlaybackSession(createInitialPlaybackSessionState(), {
      type: 'startup.started',
      startedAtMs: 0,
      nowMs: 50_000,
      hidden: true,
    }).state;
    expect(running.startup?.activeWaitMs).toBe(0);
    expect(running.startup?.status).toBe('active');
    expect(isStartupWorkAllowed(running)).toBe(false);
  });

  it.each(['paused', 'hidden', 'autoplayBlocked'] as const)(
    'suspends both clocks during %s and resumes the remaining source budget',
    (flag) => {
      let state = tick(media(start()), 4000).state;
      state = reducePlaybackSession(state, {
        type: 'startup.activity',
        nowMs: 4000,
        [flag]: true,
      }).state;
      state = tick(state, 20_000).state;
      expect(state.startup?.activeWaitMs).toBe(4000);
      expect(state.startup?.sourceWaitMs).toBe(4000);
      expect(isStartupWorkAllowed(state)).toBe(false);
      expect(
        sourceTimeout(state).effects.some(
          (effect) => effect.type === 'switchSource'
        )
      ).toBe(false);
      state = reducePlaybackSession(state, {
        type: 'startup.activity',
        nowMs: 20_000,
        [flag]: false,
      }).state;
      expect(tick(state, 25_999).effects).toEqual([]);
      const due = tick(state, 26_000);
      expect(due.effects).toEqual([
        { type: 'startupSourceTimeout', attemptId: 1, sourceKey: 'first-1' },
      ]);
      expect(tick(due.state, 27_000).effects).toEqual([]);
    }
  );

  it('pausing at 29 seconds preserves one second after resume', () => {
    let state = tick(start(), 29_000).state;
    state = reducePlaybackSession(state, { type: 'user.pause' }).state;
    state = tick(state, 100_000).state;
    expect(state.startup?.activeWaitMs).toBe(29_000);
    state = reducePlaybackSession(state, { type: 'user.play' }).state;
    expect(tick(state, 100_999).effects).toEqual([]);
    expect(tick(state, 101_000).state.startup?.status).toBe('waiting-choice');
  });

  it('canplay stops only the source clock and expiry captures the restored playhead', () => {
    let state = tick(media(start()), 9000).state;
    state = reducePlaybackSession(state, {
      type: 'sourceChange.completed',
      attemptId: 1,
      sourceKey: 'first-1',
      automatic: false,
      nowMs: 1_000_000,
    }).state;
    expect(state.startup?.status).toBe('active');
    expect(tick(state, 29_999).effects).toEqual([]);
    const expired = tick(state, 30_000, 120);
    expect(expired.state.startup?.status).toBe('waiting-choice');
    expect(expired.state.recoveryResumeTime).toBe(120);
    expect(expired.state.pendingResumeTime).toBe(120);
  });

  it('does not reset total wait across auto switches or mark the final budget interruption failed', () => {
    let state = media(start());
    const first = tick(state, 10_000);
    expect(first.effects[0]?.type).toBe('startupSourceTimeout');
    const switched = sourceTimeout(first.state);
    expect(switched.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'switchSource',
          sourceKey: 'second-1',
        }),
      ])
    );
    state = media(switched.state, 2, 'second-1');
    const second = tick(state, 20_000);
    state = media(
      sourceTimeout(second.state, 2, 'second-1').state,
      3,
      'third-1'
    );
    const expired = tick(state, 30_000, 120);
    expect(expired.effects).toEqual([
      { type: 'startupBudgetExhausted', sourceKey: 'third-1', attemptId: 3 },
    ]);
    expect(expired.state.startup?.failedSourceKeys).toEqual(
      new Set(['first-1', 'second-1'])
    );
    expect(expired.state.startup?.interruptedSourceKey).toBe('third-1');

    const retried = reducePlaybackSession(expired.state, {
      type: 'startup.retry',
      nowMs: 40_000,
    });
    expect(retried.state.startup?.activeWaitMs).toBe(0);
    expect(retried.state.recoveredSourceKeys).toEqual(
      new Set(['first-1', 'second-1'])
    );
    expect(retried.state.recoveryResumeTime).toBe(120);
    expect(retried.state.startup?.failedSourceKeys).toEqual(
      new Set(['first-1', 'second-1'])
    );
  });

  it('retains explicitly failed sources when the overall budget later expires', () => {
    let state = media(start());
    state = reducePlaybackSession(state, {
      type: 'startup.sourceFailed',
      attemptId: 1,
      sourceKey: 'first-1',
      nowMs: 2000,
    }).state;
    const expired = tick(state, 30_000);
    expect(expired.state.startup?.interruptedSourceKey).toBeNull();
    const retried = reducePlaybackSession(expired.state, {
      type: 'startup.retry',
      nowMs: 40_000,
    });
    expect(retried.state.recoveredSourceKeys.has('first-1')).toBe(true);
  });

  it('accepts a genuine current-source recovery before expiry while discovery is still pending', () => {
    let state = reducePlaybackSession(media(start()), {
      type: 'sources.discoveryStarted',
      discoveryId: 1,
    }).state;
    state = reducePlaybackSession(state, {
      type: 'sources.loaded',
      sources: [sources[0]],
      currentSourceKey: 'first-1',
      currentEpisodeIndex: 0,
    }).state;
    state = sourceTimeout(tick(state, 10_000).state).state;
    expect(state.startup?.failedSourceKeys.has('first-1')).toBe(true);
    state = reducePlaybackSession(state, {
      type: 'sourceChange.completed',
      attemptId: 1,
      sourceKey: 'first-1',
      automatic: false,
      nowMs: 1_000_000,
    }).state;
    const result = reducePlaybackSession(state, {
      type: 'startup.frame',
      nowMs: 12_000,
      attemptId: 1,
    });
    expect(result.state.startup?.status).toBe('succeeded');
    expect(result.state.startup?.failedSourceKeys.has('first-1')).toBe(false);
    expect(result.state.recoveredSourceKeys.has('first-1')).toBe(false);
    expect(tick(result.state, 30_000).effects).toEqual([]);
  });

  it.each<PlaybackSessionEvent>([
    { type: 'sourceChange.started', attemptId: 2, sourceKey: 'second-1' },
    {
      type: 'sourceChange.completed',
      attemptId: 1,
      sourceKey: 'first-1',
      automatic: true,
      nowMs: 1_000_000,
    },
    {
      type: 'timer.sourceChangeTimeout',
      attemptId: 1,
      sourceKey: 'first-1',
      snapshot: { currentTime: 0 },
      nowMs: 1_000_000,
    },
    { type: 'video.error', snapshot: { currentTime: 0 }, nowMs: 1_000_000 },
    {
      type: 'recovery.runtimeEvidence',
      snapshot: { currentTime: 0 },
      nowMs: 1_000_000,
      evidence: { platform: 'hlsjs', hardFailure: true },
    },
    {
      type: 'recovery.switchSkipped',
      sourceKey: 'first-1',
      reason: 'source-timeout',
      snapshot: { currentTime: 0 },
      nowMs: 1_000_000,
    },
  ])('ignores late $type in choice states', (event) => {
    const completed = reducePlaybackSession(media(start()), {
      type: 'sourceChange.completed',
      attemptId: 1,
      sourceKey: 'first-1',
      automatic: false,
      nowMs: 1_000_000,
    }).state;
    const waiting = tick(completed, 30_000).state;
    for (const state of [
      waiting,
      reducePlaybackSession(waiting, {
        type: 'startup.chooseSource',
        nowMs: 31_000,
      }).state,
    ]) {
      const result = reducePlaybackSession(state, event);
      expect(result.state).toBe(state);
      expect(result.effects).toEqual([]);
    }
  });

  it('ignores late or wrong-source frames and succeeds only on the active attempt', () => {
    let state = tick(media(start()), 4000).state;
    state = media(state, 2, 'second-1');
    expect(
      reducePlaybackSession(state, {
        type: 'startup.frame',
        attemptId: 1,
        nowMs: 5000,
      }).state.startup?.status
    ).toBe('active');
    const ready = reducePlaybackSession(state, {
      type: 'startup.frame',
      attemptId: 2,
      nowMs: 5000,
    });
    expect(ready.state.startup?.status).toBe('succeeded');
    expect(tick(ready.state, 50_000).effects).toEqual([]);
    expect(isStartupWorkAllowed(ready.state)).toBe(true);
    const waiting = tick(state, 30_000).state;
    expect(
      reducePlaybackSession(waiting, {
        type: 'startup.frame',
        attemptId: 2,
        nowMs: 30_001,
      }).state.startup?.status
    ).toBe('waiting-choice');
  });

  it('fetches sources only in a fresh round and waits for explicit manual selection', () => {
    const waiting = tick(start(), 30_000).state;
    const selected = reducePlaybackSession(waiting, {
      type: 'startup.chooseSource',
      nowMs: 31_000,
    }).state;
    const fetching = reducePlaybackSession(selected, {
      type: 'startup.retry',
      nowMs: 40_000,
      mode: 'sources-only',
    }).state;
    expect(isStartupWorkAllowed(fetching)).toBe(false);
    expect(
      reducePlaybackSession(fetching, {
        type: 'sourceChange.started',
        attemptId: 1,
        sourceKey: 'first-1',
      }).state
    ).toBe(fetching);
    const ready = reducePlaybackSession(fetching, {
      type: 'startup.sourcesReady',
      nowMs: 42_000,
    });
    expect(ready.state.startup?.status).toBe('selecting-source');
    expect(ready.effects).toEqual([]);
    const play = reducePlaybackSession(ready.state, {
      type: 'startup.retry',
      nowMs: 50_000,
    }).state;
    expect(isStartupWorkAllowed(play)).toBe(true);
    expect(play.startup?.activeWaitMs).toBe(0);
  });

  it('permits paused hard-failure disclosure without automatic recovery', () => {
    const paused = reducePlaybackSession(media(start()), {
      type: 'user.pause',
    }).state;
    const result = reducePlaybackSession(paused, {
      type: 'video.error',
      nowMs: 1_000_000,
      snapshot: { currentTime: 0 },
    });
    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'showInPlayerFailure',
          reason: 'source-unavailable-paused',
        }),
      ])
    );
    expect(
      result.effects.some(
        (effect) =>
          effect.type === 'switchSource' || effect.type === 'sameSourceRecover'
      )
    ).toBe(false);
    const pending = reducePlaybackSession(paused, {
      type: 'sources.discoveryStarted',
      discoveryId: 1,
    }).state;
    expect(
      reducePlaybackSession(pending, {
        type: 'video.error',
        nowMs: 1_000_000,
        snapshot: { currentTime: 0 },
      }).effects.some((effect) => effect.type === 'showInPlayerFailure')
    ).toBe(false);
  });

  it('does not change legacy or post-start playback recovery', () => {
    const legacy = load(createInitialPlaybackSessionState());
    const started = reducePlaybackSession(media(start()), {
      type: 'startup.frame',
      nowMs: 1000,
      attemptId: 1,
    }).state;
    for (const state of [legacy, started]) {
      expect(
        allowsAutomaticEffect(state, 'auto-source-switch', 1_000_000)
      ).toBe(true);
      const failed = reducePlaybackSession(state, {
        type: 'recovery.runtimeEvidence',
        nowMs: 1_000_000,
        snapshot: { currentTime: 120 },
        evidence: { platform: 'hlsjs', hardFailure: true },
      });
      expect(failed.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'switchSource' }),
        ])
      );
    }
  });

  it('supports optional adapter sinks without changing existing effect handlers', () => {
    const onStartupBudgetExhausted = jest.fn();
    const onStartupSourceTimeout = jest.fn();
    const sink = {
      onSwitchSource: jest.fn(),
      onSameSourceRecover: jest.fn(),
      onApplyRecoveryResume: jest.fn(),
      onStartupBudgetExhausted,
      onStartupSourceTimeout,
    };
    executePlaybackSessionEffects(
      [
        { type: 'startupBudgetExhausted', sourceKey: null, attemptId: null },
        { type: 'startupSourceTimeout', attemptId: 1, sourceKey: 'first-1' },
      ],
      sink
    );
    expect(onStartupBudgetExhausted).toHaveBeenCalledTimes(1);
    expect(onStartupSourceTimeout).toHaveBeenCalledWith({
      type: 'startupSourceTimeout',
      attemptId: 1,
      sourceKey: 'first-1',
    });
    expect(sink.onSwitchSource).not.toHaveBeenCalled();
  });
});
