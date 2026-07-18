import { analyzeM3U8AdCandidates } from '@/lib/hls-ad-filter';
import { toHlsAdSkipWindows } from '@/lib/hls-ad-skip';
import {
  allowsAutomaticEffect,
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

function loadSources({
  sourceStatuses = new Map<string, SourceStatus>(),
  sourceScores = new Map<string, { score: number }>(),
  recoveredSourceKeys = new Set<string>(),
  currentEpisodeIndex = 2,
  measuredVideoInfo,
}: {
  sourceStatuses?: Map<string, SourceStatus>;
  sourceScores?: Map<string, { score: number }>;
  recoveredSourceKeys?: Set<string>;
  currentEpisodeIndex?: number;
  measuredVideoInfo?: Map<
    string,
    {
      quality: string;
      loadSpeed: string;
      pingTime: number;
      speedSource?: 'backend' | 'browser' | 'feedback' | 'none';
      speedPending?: boolean;
      hasError?: boolean;
    }
  >;
} = {}) {
  const sources = [
    createSource('current', '1'),
    createSource('short', '2', ['ep-1.m3u8']),
    createSource('bad', '3'),
    createSource('proxy', '4'),
    createSource('direct', '5'),
  ];
  const initial = createInitialPlaybackSessionState();

  return reducePlaybackSession(initial, {
    type: 'sources.loaded',
    sources,
    currentSourceKey: 'current-1',
    currentEpisodeIndex,
    sourceStatuses,
    sourceScores,
    recoveredSourceKeys,
    measuredVideoInfo,
  }).state;
}

describe('Playback Session Intent gate', () => {
  it('freezes automatic effects after explicit pause until play', () => {
    const paused = reducePlaybackSession(loadSources(), {
      type: 'user.pause',
    }).state;

    expect(paused.playbackIntent).toBe('user-paused');
    expect(allowsAutomaticEffect(paused, 'ad-skip', 10_000)).toBe(false);
    expect(allowsAutomaticEffect(paused, 'same-source-recovery', 10_000)).toBe(
      false
    );
    expect(allowsAutomaticEffect(paused, 'auto-source-switch', 10_000)).toBe(
      false
    );

    const afterWaiting = reducePlaybackSession(paused, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: 438.123 },
    });
    expect(afterWaiting.effects).toEqual([
      {
        type: 'emitDebugEvent',
        eventType: 'intent.gate.denied',
        message: 'Automatic effect gated by Playback Intent',
        details: {
          deniedBy: 'user-paused',
          kind: 'same-source-recovery',
        },
      },
    ]);
    expect(afterWaiting.state.playbackIntent).toBe('user-paused');

    const afterPlay = reducePlaybackSession(paused, {
      type: 'user.play',
    }).state;
    expect(afterPlay.playbackIntent).toBe('playing');
    expect(allowsAutomaticEffect(afterPlay, 'auto-source-switch', 10_000)).toBe(
      true
    );
  });

  it('does not treat ambiguous media pause snapshots as user pause intent', () => {
    const playing = loadSources();
    expect(playing.playbackIntent).toBe('playing');

    const afterMediaPauseShape = reducePlaybackSession(playing, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: {
        currentTime: 12,
        paused: true,
        readyState: 4,
      },
    });

    expect(afterMediaPauseShape.state.playbackIntent).toBe('playing');
  });

  it('freezes all automatic effects while seeking', () => {
    const seeking = reducePlaybackSession(loadSources(), {
      type: 'user.seekStarted',
      nowMs: 10_000,
    }).state;

    expect(seeking.playbackIntent).toBe('seeking');
    expect(allowsAutomaticEffect(seeking, 'ad-skip', 10_100)).toBe(false);
    expect(allowsAutomaticEffect(seeking, 'same-source-recovery', 10_100)).toBe(
      false
    );
    expect(allowsAutomaticEffect(seeking, 'auto-source-switch', 10_100)).toBe(
      false
    );

    const afterStall = reducePlaybackSession(seeking, {
      type: 'video.stalled',
      nowMs: 10_100,
      snapshot: { currentTime: 50 },
    });
    expect(afterStall.effects).toEqual([
      expect.objectContaining({
        type: 'emitDebugEvent',
        eventType: 'intent.gate.denied',
      }),
    ]);
  });

  it('applies seek-settled protection windows per Intent contract', () => {
    const seeking = reducePlaybackSession(loadSources(), {
      type: 'user.seekStarted',
      nowMs: 10_000,
    }).state;
    const settled = reducePlaybackSession(seeking, {
      type: 'user.seekSettled',
      nowMs: 10_500,
    }).state;

    expect(settled.playbackIntent).toBe('seek-settled');

    // Within S1/S2 window (~4s): all auto effects denied
    expect(allowsAutomaticEffect(settled, 'ad-skip', 13_000)).toBe(false);
    expect(allowsAutomaticEffect(settled, 'same-source-recovery', 13_000)).toBe(
      false
    );
    expect(allowsAutomaticEffect(settled, 'auto-source-switch', 13_000)).toBe(
      false
    );

    // After S1/S2 window but still inside S3 window (≥10s): only auto switch denied
    expect(allowsAutomaticEffect(settled, 'ad-skip', 15_000)).toBe(true);
    expect(allowsAutomaticEffect(settled, 'same-source-recovery', 15_000)).toBe(
      true
    );
    expect(allowsAutomaticEffect(settled, 'auto-source-switch', 15_000)).toBe(
      false
    );

    // After S3 window: all allowed while still seek-settled
    expect(allowsAutomaticEffect(settled, 'auto-source-switch', 21_000)).toBe(
      true
    );
    expect(settled.playbackIntent).toBe('seek-settled');
  });

  it('treats manual source and episode switches as implied play with settle', () => {
    const paused = reducePlaybackSession(loadSources(), {
      type: 'user.pause',
    }).state;

    const afterSource = reducePlaybackSession(paused, {
      type: 'user.switchSource',
      sourceKey: 'direct-5',
      nowMs: 10_000,
    }).state;

    expect(afterSource.playbackIntent).toBe('playing');
    expect(afterSource.currentSourceKey).toBe('direct-5');
    expect(
      allowsAutomaticEffect(afterSource, 'auto-source-switch', 10_500)
    ).toBe(false);
    expect(
      allowsAutomaticEffect(afterSource, 'auto-source-switch', 12_100)
    ).toBe(true);

    const afterEpisode = reducePlaybackSession(paused, {
      type: 'user.switchEpisode',
      episodeIndex: 1,
      nowMs: 20_000,
    }).state;

    expect(afterEpisode.playbackIntent).toBe('playing');
    expect(afterEpisode.currentEpisodeIndex).toBe(1);
    expect(allowsAutomaticEffect(afterEpisode, 'ad-skip', 20_500)).toBe(false);
    expect(allowsAutomaticEffect(afterEpisode, 'ad-skip', 22_100)).toBe(true);
  });

  it('keeps user-paused freeze across seek until play or implied-play', () => {
    const paused = reducePlaybackSession(loadSources(), {
      type: 'user.pause',
    }).state;
    const seeking = reducePlaybackSession(paused, {
      type: 'user.seekStarted',
      nowMs: 10_000,
    }).state;
    const settled = reducePlaybackSession(seeking, {
      type: 'user.seekSettled',
      nowMs: 10_500,
    }).state;

    expect(settled.playbackIntent).toBe('user-paused');
    expect(allowsAutomaticEffect(settled, 'auto-source-switch', 30_000)).toBe(
      false
    );
  });
});

describe('Playback Session automatic recovery', () => {
  function loadPlayableAlts(overrides: Parameters<typeof loadSources>[0] = {}) {
    return loadSources({
      sourceStatuses: new Map<string, SourceStatus>([
        ['bad-3', { kind: 'unavailable' }],
        ['proxy-4', { kind: 'proxy' }],
        ['direct-5', { kind: 'direct' }],
      ]),
      sourceScores: new Map([
        ['proxy-4', { score: 99 }],
        ['direct-5', { score: 10 }],
      ]),
      ...overrides,
    });
  }

  it('enters R0 observe on soft stall without privately escalating to R3', () => {
    const state = loadPlayableAlts();

    const result = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: 438.123 },
    });

    expect(result.state.recoveryStage).toBe('R0');
    expect(result.state.stallEpisodeActive).toBe(true);
    expect(
      result.effects.some((effect) => effect.type === 'switchSource')
    ).toBe(false);
  });

  it('escalates R0 → R1 same-source recover after soft observe window', () => {
    const r0 = reducePlaybackSession(loadPlayableAlts(), {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: 438.123 },
    }).state;

    const result = reducePlaybackSession(r0, {
      type: 'video.waiting',
      nowMs: 12_600,
      snapshot: { currentTime: 438.123 },
    });

    expect(result.state.recoveryStage).toBe('R1');
    expect(result.state.recoveryInFlight).toBe('R1');
    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'sameSourceRecover',
          stage: 'R1',
        }),
      ])
    );
    expect(
      result.effects.some((effect) => effect.type === 'switchSource')
    ).toBe(false);
  });

  it('escalates to R2 escape when playhead is inside a known fault interval', () => {
    const withBadPoint = {
      ...loadPlayableAlts(),
      badPoints: [
        {
          sourceKey: 'current-1',
          timeSeconds: 438.12,
          hitCount: 1,
          updatedAtMs: 9_000,
        },
      ],
    };

    const r0 = reducePlaybackSession(withBadPoint, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: 438.123 },
    }).state;

    const result = reducePlaybackSession(r0, {
      type: 'video.waiting',
      nowMs: 12_600,
      snapshot: { currentTime: 438.123 },
    });

    expect(result.state.recoveryStage).toBe('R2');
    expect(result.state.recoveryResumeTime).toBeGreaterThan(438.123);
    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'sameSourceRecover',
          stage: 'R2',
          action: 'escape-bad-point',
        }),
      ])
    );
    expect(
      result.effects.some((effect) => effect.type === 'applyRecoveryResume')
    ).toBe(false);
  });

  it('keeps Recovery Resume Time as Session authority and only applies via effects', () => {
    const withBadPoint = {
      ...loadPlayableAlts(),
      badPoints: [
        {
          sourceKey: 'current-1',
          timeSeconds: 100,
          hitCount: 2,
          updatedAtMs: 9_000,
        },
      ],
    };
    const r0 = reducePlaybackSession(withBadPoint, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: 100 },
    }).state;
    const escaped = reducePlaybackSession(r0, {
      type: 'video.waiting',
      nowMs: 12_600,
      snapshot: { currentTime: 100 },
    });

    expect(escaped.state.recoveryResumeTime).toBe(
      escaped.state.pendingResumeTime
    );
    expect(escaped.state.recoveryResumeTime).toBeGreaterThan(100);
    const escapeEffect = escaped.effects.find(
      (effect) =>
        effect.type === 'sameSourceRecover' &&
        effect.action === 'escape-bad-point'
    ) as { targetTime: number | null };
    expect(escapeEffect.targetTime).toBe(escaped.state.recoveryResumeTime);
  });

  it('cancels recovery without erasing bad points', () => {
    const withBadPoint = {
      ...loadPlayableAlts(),
      badPoints: [
        {
          sourceKey: 'current-1',
          timeSeconds: 50,
          hitCount: 1,
          updatedAtMs: 1_000,
        },
      ],
    };
    const r0 = reducePlaybackSession(withBadPoint, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: 50 },
    }).state;

    const cancelled = reducePlaybackSession(r0, { type: 'recovery.cancel' });

    expect(cancelled.state.recoveryStage).toBe('idle');
    expect(cancelled.state.stallEpisodeActive).toBe(false);
    expect(cancelled.state.badPoints).toEqual(withBadPoint.badPoints);
  });

  it('scopes bad points by contentKey+episodeIndex; episode change hides prior scope', () => {
    const initial = reducePlaybackSession(createInitialPlaybackSessionState(), {
      type: 'sources.loaded',
      sources: [createSource('current', '1')],
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
      contentKey: 'title-a',
    }).state;

    const withPoint = {
      ...initial,
      badPoints: [
        {
          sourceKey: 'current-1',
          timeSeconds: 40,
          hitCount: 1,
          updatedAtMs: 1_000,
        },
      ],
    };

    const nextEpisode = reducePlaybackSession(withPoint, {
      type: 'user.switchEpisode',
      episodeIndex: 1,
      nowMs: 20_000,
    }).state;

    expect(nextEpisode.badPoints).toEqual([]);
    expect(nextEpisode.badPointsByScope.get('title-a::0')).toEqual(
      withPoint.badPoints
    );

    const back = reducePlaybackSession(nextEpisode, {
      type: 'user.switchEpisode',
      episodeIndex: 0,
      nowMs: 30_000,
    }).state;
    expect(back.badPoints).toEqual(withPoint.badPoints);
  });

  it('routes native jitter evidence into the same R tree (strengthens R2, no parallel switch)', () => {
    const r0 = reducePlaybackSession(loadPlayableAlts(), {
      type: 'recovery.runtimeEvidence',
      nowMs: 10_000,
      snapshot: { currentTime: 200 },
      evidence: {
        platform: 'apple-native',
        stallCandidate: true,
        native: {
          severity: 'soft-stall',
          isJitter: true,
          jitterWindowCount: 2,
        },
      },
    });

    // Jitter ≥2 strengthens R2 on the shared tree — never a parallel commander.
    expect(r0.effects.some((effect) => effect.type === 'switchSource')).toBe(
      false
    );
    expect(
      r0.state.recoveryStage === 'R2' || r0.state.recoveryStage === 'R0'
    ).toBe(true);

    const afterObserve =
      r0.state.recoveryStage === 'R0'
        ? reducePlaybackSession(r0.state, {
            type: 'recovery.runtimeEvidence',
            nowMs: 12_600,
            snapshot: { currentTime: 200 },
            evidence: {
              platform: 'apple-native',
              stallCandidate: true,
              native: {
                severity: 'soft-stall',
                isJitter: true,
                jitterWindowCount: 2,
              },
            },
          })
        : r0;

    expect(afterObserve.state.recoveryStage).toBe('R2');
    expect(
      afterObserve.effects.some((effect) => effect.type === 'sameSourceRecover')
    ).toBe(true);
    expect(
      afterObserve.effects.some((effect) => effect.type === 'switchSource')
    ).toBe(false);
  });

  it('switches via R3 hard-failure path using Availability + Session attempted', () => {
    const state = loadPlayableAlts();

    const result = reducePlaybackSession(state, {
      type: 'video.error',
      nowMs: 10_000,
      snapshot: { currentTime: 438.123 },
      errorCode: 3,
    });

    expect(result.effects).toEqual(
      expect.arrayContaining([
        {
          type: 'switchSource',
          sourceKey: 'direct-5',
          source: state.sources[4],
          episodeIndex: 2,
          resumeTime: 433.12,
          reason: 'auto-recovery',
        },
      ])
    );
    expect(result.state.recoveryStage).toBe('R3');
    expect(result.state.recoveryResumeTime).toBe(433.12);
    expect(result.state.recoveredSourceKeys.has('current-1')).toBe(true);
    expect(result.state.recoveredSourceKeys.has('direct-5')).toBe(true);
  });

  it('does not switch while user paused', () => {
    const state = reducePlaybackSession(loadSources(), {
      type: 'user.pause',
    }).state;

    const result = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: 438.123 },
    });

    expect(result.effects).toEqual([
      expect.objectContaining({
        type: 'emitDebugEvent',
        eventType: 'intent.gate.denied',
      }),
    ]);
    expect(result.state.recoveryStage).toBe('idle');
  });

  it('does not switch during manual seek grace', () => {
    const state = reducePlaybackSession(loadSources(), {
      type: 'user.seekStarted',
      nowMs: 10_000,
    }).state;

    const result = reducePlaybackSession(state, {
      type: 'video.stalled',
      nowMs: 12_000,
      snapshot: { currentTime: 438.123 },
    });

    expect(result.effects).toEqual([
      expect.objectContaining({
        type: 'emitDebugEvent',
        eventType: 'intent.gate.denied',
      }),
    ]);
  });

  it('does not switch to a source without the current episode', () => {
    const state = loadSources({
      sourceStatuses: new Map<string, SourceStatus>([
        ['bad-3', { kind: 'unavailable' }],
        ['proxy-4', { kind: 'unavailable' }],
        ['direct-5', { kind: 'unavailable' }],
      ]),
      sourceScores: new Map([['short-2', { score: 999 }]]),
    });

    const result = reducePlaybackSession(state, {
      type: 'video.error',
      nowMs: 10_000,
      snapshot: { currentTime: 438.123 },
      errorCode: 3,
    });

    expect(
      result.effects.filter((effect) => effect.type === 'switchSource')
    ).toEqual([]);
    expect(result.state.recoveryStage).toBe('exhausted');
  });

  it('selects a backend-rescued playable source via Availability, not status-kind alone', () => {
    const state = loadSources({
      sourceStatuses: new Map<string, SourceStatus>([
        ['bad-3', { kind: 'unavailable' }],
        ['proxy-4', { kind: 'proxy' }],
        [
          'direct-5',
          {
            kind: 'unavailable',
            reason: '该源近期在本机不可用',
            fromMemory: true,
          },
        ],
      ]),
      measuredVideoInfo: new Map([
        [
          'direct-5',
          {
            quality: '1080p',
            loadSpeed: '后端 2.4 MB/s · 280ms',
            pingTime: 280,
            speedSource: 'backend',
            speedPending: false,
          },
        ],
      ]),
    });

    const result = reducePlaybackSession(state, {
      type: 'video.error',
      nowMs: 10_000,
      snapshot: { currentTime: 438.123 },
    });

    expect(result.effects).toEqual(
      expect.arrayContaining([
        {
          type: 'switchSource',
          sourceKey: 'direct-5',
          source: state.sources[4],
          episodeIndex: 2,
          resumeTime: 433.12,
          reason: 'auto-recovery',
        },
      ])
    );
  });

  it('does not switch to an already recovered source', () => {
    const state = loadSources({
      recoveredSourceKeys: new Set(['direct-5']),
      sourceStatuses: new Map<string, SourceStatus>([
        ['bad-3', { kind: 'unavailable' }],
        ['proxy-4', { kind: 'unavailable' }],
        ['direct-5', { kind: 'direct' }],
      ]),
      sourceScores: new Map([['direct-5', { score: 999 }]]),
    });

    const result = reducePlaybackSession(state, {
      type: 'video.error',
      nowMs: 10_000,
      snapshot: { currentTime: 438.123 },
    });

    expect(
      result.effects.filter((effect) => effect.type === 'switchSource')
    ).toEqual([]);
  });

  it('skips forward on a later R3 near a recorded stuck point', () => {
    const first = reducePlaybackSession(
      loadSources({
        sourceStatuses: new Map<string, SourceStatus>([
          ['direct-5', { kind: 'direct' }],
          ['proxy-4', { kind: 'direct' }],
        ]),
        sourceScores: new Map([
          ['direct-5', { score: 10 }],
          ['proxy-4', { score: 5 }],
        ]),
      }),
      {
        type: 'video.error',
        nowMs: 10_000,
        snapshot: { currentTime: 438.123 },
      }
    );

    expect(first.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'switchSource',
          resumeTime: 433.12,
        }),
      ])
    );
    expect(first.state.badPoints).toHaveLength(1);

    const afterSwitch = reducePlaybackSession(
      {
        ...first.state,
        currentSourceKey: 'direct-5',
        sourceChangeInFlight: false,
        recoveryStage: 'idle',
        stallEpisodeActive: false,
        recoveryInFlight: null,
      },
      {
        type: 'video.error',
        nowMs: 20_000,
        snapshot: { currentTime: 436.5 },
      }
    );

    expect(afterSwitch.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'switchSource',
          sourceKey: 'proxy-4',
        }),
      ])
    );
    const switchEffect = afterSwitch.effects.find(
      (effect) => effect.type === 'switchSource'
    ) as { resumeTime: number | null };
    expect(switchEffect.resumeTime).toBeGreaterThan(438.123);
  });

  it('ignores stale source change timeout attempts', () => {
    const state = reducePlaybackSession(loadSources(), {
      type: 'sourceChange.started',
      attemptId: 2,
      sourceKey: 'current-1',
    }).state;

    const result = reducePlaybackSession(state, {
      type: 'timer.sourceChangeTimeout',
      attemptId: 1,
      sourceKey: 'current-1',
      nowMs: 25_000,
      snapshot: { currentTime: 0 },
    });

    expect(result.effects).toEqual([]);
    expect(result.state).toBe(state);
  });

  it('switches to another usable source when the active source change times out', () => {
    const state = reducePlaybackSession(
      loadSources({
        sourceStatuses: new Map<string, SourceStatus>([
          ['bad-3', { kind: 'unavailable' }],
          ['proxy-4', { kind: 'proxy' }],
          ['direct-5', { kind: 'direct' }],
        ]),
        sourceScores: new Map([['direct-5', { score: 20 }]]),
      }),
      {
        type: 'sourceChange.started',
        attemptId: 2,
        sourceKey: 'current-1',
      }
    ).state;

    const result = reducePlaybackSession(state, {
      type: 'timer.sourceChangeTimeout',
      attemptId: 2,
      sourceKey: 'current-1',
      nowMs: 25_000,
      snapshot: { currentTime: 438.123 },
    });

    expect(result.effects).toEqual(
      expect.arrayContaining([
        {
          type: 'switchSource',
          sourceKey: 'direct-5',
          source: state.sources[4],
          episodeIndex: 2,
          resumeTime: 433.12,
          reason: 'source-timeout',
        },
      ])
    );
    expect(result.state.sourceChangeInFlight).toBe(false);
    expect(result.state.sourceChangeSourceKey).toBeNull();
    expect(result.state.recoveredSourceKeys.has('current-1')).toBe(true);
    expect(result.state.recoveredSourceKeys.has('direct-5')).toBe(true);
  });

  it('removes a failed recovery target while keeping the previous source excluded', () => {
    const switched = reducePlaybackSession(
      loadSources({
        sourceStatuses: new Map<string, SourceStatus>([
          ['bad-3', { kind: 'unavailable' }],
          ['proxy-4', { kind: 'unavailable' }],
          ['direct-5', { kind: 'direct' }],
        ]),
      }),
      {
        type: 'video.error',
        nowMs: 10_000,
        snapshot: { currentTime: 438.123 },
      }
    ).state;

    const result = reducePlaybackSession(switched, {
      type: 'recovery.switchFailed',
      sourceKey: 'direct-5',
    });

    expect(result.state.recoveredSourceKeys.has('current-1')).toBe(true);
    expect(result.state.recoveredSourceKeys.has('direct-5')).toBe(false);
  });
});

describe('Playback Session Ad Skip Window effects', () => {
  function loadAdWindows() {
    return reducePlaybackSession(createInitialPlaybackSessionState(), {
      type: 'adSkipWindows.loaded',
      windows: [
        {
          startTimeSeconds: 10,
          endTimeSeconds: 20,
          ruleId: 'rule-1',
          confidence: 'high',
          action: 'filter',
        },
      ],
    }).state;
  }

  it('returns a dedicated skipAdWindow effect for playback inside an ad window', () => {
    const loaded = loadAdWindows();

    const result = reducePlaybackSession(loaded, {
      type: 'video.timeupdate',
      nowMs: 10_000,
      platform: 'apple-native',
      snapshot: { currentTime: 12 },
    });

    expect(result.effects).toEqual([
      {
        type: 'skipAdWindow',
        targetTime: 20.35,
        windowKey: 'rule-1:10.000-20.000',
        reason: 'hls-ad-window',
        platform: 'apple-native',
      },
      {
        type: 'showAdSkipUndo',
        windowKey: 'rule-1:10.000-20.000',
        restoreTimeSeconds: 10,
        dismissAfterMs: 5000,
      },
      expect.objectContaining({
        type: 'emitDebugEvent',
        eventType: 'adSkip.emitted',
      }),
    ]);
  });

  it('emits a recoverable undo toast effect with every automatic ad skip', () => {
    const loaded = loadAdWindows();

    const result = reducePlaybackSession(loaded, {
      type: 'video.timeupdate',
      nowMs: 10_000,
      platform: 'hlsjs',
      snapshot: { currentTime: 12 },
    });

    expect(result.effects).toContainEqual({
      type: 'showAdSkipUndo',
      windowKey: 'rule-1:10.000-20.000',
      restoreTimeSeconds: 10,
      dismissAfterMs: 5000,
    });
    expect(result.state.recoverableAdSkip).toEqual({
      windowKey: 'rule-1:10.000-20.000',
      restoreTimeSeconds: 10,
      skippedAtMs: 10_000,
    });
  });

  it('does not repeat the same Ad Skip Window after a skip effect', () => {
    const loaded = loadAdWindows();
    const skipped = reducePlaybackSession(loaded, {
      type: 'video.timeupdate',
      nowMs: 10_000,
      snapshot: { currentTime: 12 },
    }).state;

    const result = reducePlaybackSession(skipped, {
      type: 'video.timeupdate',
      nowMs: 10_100,
      snapshot: { currentTime: 13 },
    });

    expect(result.effects).toEqual([]);
  });

  it('does not skip during manual seek grace', () => {
    const loaded = loadAdWindows();
    const seeking = reducePlaybackSession(loaded, {
      type: 'user.seekStarted',
      nowMs: 10_000,
    }).state;

    const result = reducePlaybackSession(seeking, {
      type: 'video.timeupdate',
      nowMs: 11_000,
      snapshot: { currentTime: 12 },
    });

    expect(result.effects).toEqual([]);
  });

  it('does not skip while user-paused or inside seek-settled short guard', () => {
    const paused = reducePlaybackSession(loadAdWindows(), {
      type: 'user.pause',
    }).state;
    expect(
      reducePlaybackSession(paused, {
        type: 'video.timeupdate',
        nowMs: 10_000,
        snapshot: { currentTime: 12 },
      }).effects
    ).toEqual([]);

    const seeking = reducePlaybackSession(loadAdWindows(), {
      type: 'user.seekStarted',
      nowMs: 10_000,
    }).state;
    const settled = reducePlaybackSession(seeking, {
      type: 'user.seekSettled',
      nowMs: 10_500,
    }).state;

    expect(
      reducePlaybackSession(settled, {
        type: 'video.timeupdate',
        nowMs: 12_000,
        snapshot: { currentTime: 12 },
      }).effects
    ).toEqual([]);

    expect(
      reducePlaybackSession(settled, {
        type: 'video.timeupdate',
        nowMs: 15_000,
        snapshot: { currentTime: 12 },
      }).effects
    ).toEqual([
      {
        type: 'skipAdWindow',
        targetTime: 20.35,
        windowKey: 'rule-1:10.000-20.000',
        reason: 'hls-ad-window',
        platform: 'hlsjs',
      },
      {
        type: 'showAdSkipUndo',
        windowKey: 'rule-1:10.000-20.000',
        restoreTimeSeconds: 10,
        dismissAfterMs: 5000,
      },
      expect.objectContaining({
        type: 'emitDebugEvent',
        eventType: 'adSkip.emitted',
      }),
    ]);
  });

  it('cancels in-flight Ad Skip on explicit pause', () => {
    const loaded = loadAdWindows();
    const withPending = {
      ...loaded,
      adSkipInFlightWindowKey: 'rule-1:10.000-20.000',
    };

    const result = reducePlaybackSession(withPending, { type: 'user.pause' });

    expect(result.state.playbackIntent).toBe('user-paused');
    expect(result.state.adSkipInFlightWindowKey).toBeNull();
    expect(result.effects).toEqual([
      {
        type: 'cancelAdSkip',
        windowKey: 'rule-1:10.000-20.000',
        reason: 'user-paused',
      },
      expect.objectContaining({
        type: 'emitDebugEvent',
        eventType: 'adSkip.cancelled',
      }),
    ]);
  });

  it('suppresses Ad Skip while R1+ recovery is in-flight', () => {
    const loaded = {
      ...loadAdWindows(),
      recoveryStage: 'R1' as const,
      stallEpisodeActive: true,
      recoveryInFlight: 'R1' as const,
    };

    const result = reducePlaybackSession(loaded, {
      type: 'video.timeupdate',
      nowMs: 10_000,
      snapshot: { currentTime: 12 },
    });

    expect(result.effects).toEqual([]);
  });

  it('suppresses Ad Skip while Recovery Resume is pending/in-flight', () => {
    const loaded = {
      ...loadAdWindows(),
      recoveryResumeTime: 55,
      pendingResumeTime: 55,
      recoveryInFlight: 'resume' as const,
    };

    const result = reducePlaybackSession(loaded, {
      type: 'video.timeupdate',
      nowMs: 10_000,
      snapshot: { currentTime: 12 },
    });

    expect(result.effects).toEqual([]);
  });

  it('allows Ad Skip alongside R0 observe when Intent permits', () => {
    const loaded = {
      ...loadAdWindows(),
      recoveryStage: 'R0' as const,
      stallEpisodeActive: true,
      r0EnteredAtMs: 9_000,
      recoveryInFlight: null,
    };

    const result = reducePlaybackSession(loaded, {
      type: 'video.timeupdate',
      nowMs: 10_000,
      snapshot: { currentTime: 12 },
    });

    expect(result.effects).toEqual([
      {
        type: 'skipAdWindow',
        targetTime: 20.35,
        windowKey: 'rule-1:10.000-20.000',
        reason: 'hls-ad-window',
        platform: 'hlsjs',
      },
      {
        type: 'showAdSkipUndo',
        windowKey: 'rule-1:10.000-20.000',
        restoreTimeSeconds: 10,
        dismissAfterMs: 5000,
      },
      expect.objectContaining({
        type: 'emitDebugEvent',
        eventType: 'adSkip.emitted',
      }),
    ]);
  });

  it('allows optional S1 only after resume settles', () => {
    const pending = {
      ...loadAdWindows(),
      recoveryResumeTime: 55,
      pendingResumeTime: 55,
      recoveryInFlight: 'resume' as const,
    };

    expect(
      reducePlaybackSession(pending, {
        type: 'video.timeupdate',
        nowMs: 10_000,
        snapshot: { currentTime: 12 },
      }).effects
    ).toEqual([]);

    const settled = reducePlaybackSession(pending, {
      type: 'recovery.effectSettled',
      kind: 'resume',
      nowMs: 11_000,
    }).state;

    expect(settled.recoveryResumeTime).toBeNull();
    expect(settled.recoveryInFlight).toBeNull();

    expect(
      reducePlaybackSession(settled, {
        type: 'video.timeupdate',
        nowMs: 11_100,
        snapshot: { currentTime: 12 },
      }).effects
    ).toEqual([
      {
        type: 'skipAdWindow',
        targetTime: 20.35,
        windowKey: 'rule-1:10.000-20.000',
        reason: 'hls-ad-window',
        platform: 'hlsjs',
      },
      {
        type: 'showAdSkipUndo',
        windowKey: 'rule-1:10.000-20.000',
        restoreTimeSeconds: 10,
        dismissAfterMs: 5000,
      },
      expect.objectContaining({
        type: 'emitDebugEvent',
        eventType: 'adSkip.emitted',
      }),
    ]);
  });

  it('undo restores to window start, suppresses re-skip, and records confirmation', () => {
    const skipped = reducePlaybackSession(loadAdWindows(), {
      type: 'video.timeupdate',
      nowMs: 10_000,
      snapshot: { currentTime: 12 },
    }).state;

    const undone = reducePlaybackSession(skipped, {
      type: 'user.undoAdSkip',
      windowKey: 'rule-1:10.000-20.000',
      nowMs: 10_500,
    });

    expect(undone.effects).toEqual([
      {
        type: 'restoreAdSkipWindow',
        targetTime: 10,
        windowKey: 'rule-1:10.000-20.000',
      },
      expect.objectContaining({
        type: 'emitDebugEvent',
        eventType: 'adSkip.undone',
        details: expect.objectContaining({
          windowKey: 'rule-1:10.000-20.000',
          restoreTimeSeconds: 10,
          confirmation: 'wrong',
        }),
      }),
    ]);
    expect(undone.state.recoverableAdSkip).toBeNull();
    expect(undone.state.adSkipInFlightWindowKey).toBeNull();
    expect(
      undone.state.suppressedAdSkipWindowKeys.has('rule-1:10.000-20.000')
    ).toBe(true);
    expect(undone.state.lastUserSeekAtMs).toBe(10_500);

    const insideAgain = reducePlaybackSession(undone.state, {
      type: 'video.timeupdate',
      nowMs: 15_000,
      snapshot: { currentTime: 12 },
    });
    expect(insideAgain.effects).toEqual([]);
  });

  it('after undo, a manual seek forward is not immediately re-skipped', () => {
    const skipped = reducePlaybackSession(loadAdWindows(), {
      type: 'video.timeupdate',
      nowMs: 10_000,
      snapshot: { currentTime: 12 },
    }).state;
    const undone = reducePlaybackSession(skipped, {
      type: 'user.undoAdSkip',
      windowKey: 'rule-1:10.000-20.000',
      nowMs: 10_500,
    }).state;

    // Explicit manual seek (not just timeupdate) stamps grace via undo's
    // lastUserSeekAtMs; suppress also blocks after grace expires.
    const seeking = reducePlaybackSession(undone, {
      type: 'user.seekStarted',
      nowMs: 10_600,
    }).state;
    const settled = reducePlaybackSession(seeking, {
      type: 'user.seekSettled',
      nowMs: 10_700,
    }).state;
    const duringGrace = reducePlaybackSession(settled, {
      type: 'video.timeupdate',
      nowMs: 11_000,
      snapshot: { currentTime: 15 },
    });
    expect(duringGrace.effects).toEqual([]);
  });

  it('dismisses recoverable undo state when the toast expires', () => {
    const skipped = reducePlaybackSession(loadAdWindows(), {
      type: 'video.timeupdate',
      nowMs: 10_000,
      snapshot: { currentTime: 12 },
    }).state;

    const dismissed = reducePlaybackSession(skipped, {
      type: 'adSkipUndo.dismissed',
      windowKey: 'rule-1:10.000-20.000',
    });

    expect(dismissed.state.recoverableAdSkip).toBeNull();
    expect(dismissed.effects).toEqual([]);
  });
});

describe('Playback Session progress-save effects', () => {
  it('returns a saveProgress effect without deciding whether the record should be persisted', () => {
    const state = createInitialPlaybackSessionState();

    const result = reducePlaybackSession(state, {
      type: 'progressSave.requested',
      reason: 'resume-sync',
    });

    expect(result.state).toBe(state);
    expect(result.effects).toEqual([
      {
        type: 'saveProgress',
        reason: 'resume-sync',
      },
      {
        type: 'emitDebugEvent',
        eventType: 'progressSave.requested',
        message: 'Progress save requested',
        details: { reason: 'resume-sync' },
      },
    ]);
  });

  it('emits adSkip lifecycle debug events for loaded / emitted / cancelled', () => {
    const withWindows = reducePlaybackSession(loadSources(), {
      type: 'adSkipWindows.loaded',
      windows: [
        {
          startTimeSeconds: 10,
          endTimeSeconds: 20,
          ruleId: 'rule-1',
          confidence: 'high',
          action: 'filter',
        },
      ],
    });

    expect(withWindows.effects).toContainEqual({
      type: 'emitDebugEvent',
      eventType: 'adSkip.loaded',
      message: 'Ad skip windows loaded',
      details: { windowCount: 1 },
    });

    const emitted = reducePlaybackSession(withWindows.state, {
      type: 'video.timeupdate',
      nowMs: 20_000,
      platform: 'hlsjs',
      snapshot: { currentTime: 12 },
    });

    expect(emitted.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'skipAdWindow' }),
        expect.objectContaining({
          type: 'emitDebugEvent',
          eventType: 'adSkip.emitted',
        }),
      ])
    );

    const cancelled = reducePlaybackSession(emitted.state, {
      type: 'user.pause',
    });
    expect(cancelled.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'cancelAdSkip' }),
        expect.objectContaining({
          type: 'emitDebugEvent',
          eventType: 'adSkip.cancelled',
        }),
      ])
    );
  });

  it('emits a previous-episode save intent before switching episodes', () => {
    const state = loadSources({ currentEpisodeIndex: 1 });

    const result = reducePlaybackSession(state, {
      type: 'user.switchEpisode',
      episodeIndex: 2,
      nowMs: 5_000,
    });

    expect(result.state.currentEpisodeIndex).toBe(2);
    expect(result.effects).toContainEqual({
      type: 'saveProgress',
      reason: 'episode-change',
      episodeIndex: 1,
    });
  });

  it('emits a completed save intent before ended→next auto-advance', () => {
    const state = loadSources({ currentEpisodeIndex: 0 });

    const result = reducePlaybackSession(state, {
      type: 'video.ended',
      nextEpisodeIndex: 1,
      nowMs: 9_000,
    });

    expect(result.state.currentEpisodeIndex).toBe(1);
    expect(result.state.playbackIntent).toBe('playing');
    expect(result.effects[0]).toEqual({
      type: 'saveProgress',
      reason: 'episode-ended',
      episodeIndex: 0,
      completed: true,
    });
  });
});

// 预重构验收：全平台统一到 seek 式 Ad Skip Window。分析器高置信候选与
// 已知规则命中作为冷启动种子被载入为 Ad Skip Window，桌面/安卓（hls.js）
// 与 iOS 原生 HLS 均经由 reducer 的 adSkipWindows.loaded + skipAdWindow 以
// seek 跳过，而非物理删除广告分片。
describe('Unified cold-start seed → seek Ad Skip Window (pre-refactor #35)', () => {
  const contentSegments = [
    '#EXTINF:10.0,',
    'content-1.ts',
    '#EXTINF:10.0,',
    'content-2.ts',
    '#EXTINF:10.0,',
    'content-3.ts',
    '#EXTINF:10.0,',
    'content-4.ts',
    '#EXTINF:10.0,',
    'content-5.ts',
    '#EXTINF:10.0,',
    'content-6.ts',
  ];

  function buildCueMarkerPlaylist(): string {
    return [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'content-before.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-CUE-OUT:20',
      '#EXTINF:10,',
      'ad-1.ts',
      '#EXTINF:10,',
      'ad-2.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-CUE-IN',
      '#EXTINF:10,',
      'content-after-1.ts',
      '#EXTINF:10,',
      'content-after-2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
  }

  // 如意 ryplay 22 秒中插广告：稳定 6 片段正片组之间夹一个短变长 6 片段广告组。
  function buildRyplayMidrollPlaylist(): string {
    return [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:12',
      ...contentSegments,
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:6.0,',
      'ad-1.ts',
      '#EXTINF:2.0,',
      'ad-2.ts',
      '#EXTINF:4.0,',
      'ad-3.ts',
      '#EXTINF:4.0,',
      'ad-4.ts',
      '#EXTINF:2.0,',
      'ad-5.ts',
      '#EXTINF:4.0,',
      'ad-6.ts',
      '#EXT-X-DISCONTINUITY',
      ...contentSegments,
      '#EXT-X-ENDLIST',
    ].join('\n');
  }

  function loadSeedWindowsFrom(playlist: string, baseUrl: string) {
    const analysis = analyzeM3U8AdCandidates(playlist, baseUrl);
    const windows = toHlsAdSkipWindows(analysis.candidates);
    const loaded = reducePlaybackSession(createInitialPlaybackSessionState(), {
      type: 'adSkipWindows.loaded',
      windows,
    });
    return { windows, state: loaded.state };
  }

  it.each(['hlsjs', 'apple-native'] as const)(
    'loads analyzer high-confidence candidates as seed windows and seeks past them on %s',
    (platform) => {
      const { windows, state } = loadSeedWindowsFrom(
        buildCueMarkerPlaylist(),
        'https://media.example.com/show/index.m3u8'
      );

      expect(windows).toEqual([
        expect.objectContaining({
          startTimeSeconds: 10,
          endTimeSeconds: 30,
          confidence: 'high',
          action: 'filter',
        }),
      ]);

      const result = reducePlaybackSession(state, {
        type: 'video.timeupdate',
        nowMs: 10_000,
        platform,
        snapshot: { currentTime: 15 },
      });

      expect(result.effects).toContainEqual(
        expect.objectContaining({
          type: 'skipAdWindow',
          targetTime: 30.35,
          reason: 'hls-ad-window',
          platform,
        })
      );
    }
  );

  it('loads known-rule hits as seed windows and unifies the seek skip across platforms', () => {
    const baseUrl = 'https://v.ryplay12.com/20260109/clip/index.m3u8';
    const { windows, state } = loadSeedWindowsFrom(
      buildRyplayMidrollPlaylist(),
      baseUrl
    );

    expect(windows).toEqual([
      expect.objectContaining({
        startTimeSeconds: 60,
        endTimeSeconds: 82,
        ruleId: 'ruyi-ryplay-22s-midroll-v1',
        confidence: 'high',
        action: 'filter',
      }),
    ]);

    for (const platform of ['hlsjs', 'apple-native'] as const) {
      const result = reducePlaybackSession(state, {
        type: 'video.timeupdate',
        nowMs: 10_000,
        platform,
        snapshot: { currentTime: 65 },
      });

      expect(result.effects).toContainEqual(
        expect.objectContaining({
          type: 'skipAdWindow',
          targetTime: 82.35,
          reason: 'hls-ad-window',
          platform,
        })
      );
    }
  });

  it('still honors manual-seek grace and already-skipped guards on the unified path', () => {
    const { state } = loadSeedWindowsFrom(
      buildCueMarkerPlaylist(),
      'https://media.example.com/show/index.m3u8'
    );

    const seeking = reducePlaybackSession(state, {
      type: 'user.seekStarted',
      nowMs: 10_000,
    }).state;
    expect(
      reducePlaybackSession(seeking, {
        type: 'video.timeupdate',
        nowMs: 11_000,
        platform: 'hlsjs',
        snapshot: { currentTime: 15 },
      }).effects
    ).toEqual([]);

    const skipped = reducePlaybackSession(state, {
      type: 'video.timeupdate',
      nowMs: 20_000,
      platform: 'hlsjs',
      snapshot: { currentTime: 15 },
    }).state;
    expect(
      reducePlaybackSession(skipped, {
        type: 'video.timeupdate',
        nowMs: 20_100,
        platform: 'hlsjs',
        snapshot: { currentTime: 16 },
      }).effects
    ).toEqual([]);
  });
});
