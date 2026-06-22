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

function loadSources({
  sourceStatuses = new Map<string, SourceStatus>(),
  sourceScores = new Map<string, { score: number }>(),
  recoveredSourceKeys = new Set<string>(),
}: {
  sourceStatuses?: Map<string, SourceStatus>;
  sourceScores?: Map<string, { score: number }>;
  recoveredSourceKeys?: Set<string>;
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
    currentEpisodeIndex: 2,
    sourceStatuses,
    sourceScores,
    recoveredSourceKeys,
  }).state;
}

describe('Playback Session automatic recovery', () => {
  it('switches to the highest scored unrecovered playable source on recovery', () => {
    const state = loadSources({
      sourceStatuses: new Map<string, SourceStatus>([
        ['bad-3', { kind: 'unavailable' }],
        ['proxy-4', { kind: 'proxy' }],
        ['direct-5', { kind: 'direct' }],
      ]),
      sourceScores: new Map([
        ['proxy-4', { score: 99 }],
        ['direct-5', { score: 10 }],
      ]),
    });

    const result = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: 438.123 },
    });

    expect(result.effects).toEqual([
      {
        type: 'switchSource',
        sourceKey: 'direct-5',
        source: state.sources[4],
        episodeIndex: 2,
        resumeTime: 433.12,
        reason: 'auto-recovery',
      },
    ]);
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

    expect(result.effects).toEqual([]);
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

    expect(result.effects).toEqual([]);
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

    expect(result.effects).toEqual([]);
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
      type: 'video.waiting',
      nowMs: 10_000,
      snapshot: { currentTime: 438.123 },
    });

    expect(result.effects).toEqual([]);
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

    expect(result.effects).toEqual([
      {
        type: 'switchSource',
        sourceKey: 'direct-5',
        source: state.sources[4],
        episodeIndex: 2,
        resumeTime: 433.12,
        reason: 'source-timeout',
      },
    ]);
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
        type: 'video.waiting',
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
  it('returns a dedicated skipAdWindow effect for playback inside an ad window', () => {
    const loaded = reducePlaybackSession(createInitialPlaybackSessionState(), {
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
    ]);
  });

  it('does not repeat the same Ad Skip Window after a skip effect', () => {
    const loaded = reducePlaybackSession(createInitialPlaybackSessionState(), {
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
    const loaded = reducePlaybackSession(createInitialPlaybackSessionState(), {
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
    ]);
  });
});
