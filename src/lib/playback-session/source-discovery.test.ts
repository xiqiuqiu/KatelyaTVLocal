import {
  createInitialPlaybackSessionState,
  reducePlaybackSession,
} from './reducer';
import type { PlaybackSessionEvent, PlaybackSessionState } from './types';
import type { SearchResult } from '../types';

const source = (key: string): SearchResult => ({
  source: key,
  id: '1',
  title: '测试影片',
  year: '2026',
  poster: '',
  source_name: key,
  episodes: ['https://example.com/episode.m3u8'],
});
const current = source('current');
const alternate = source('alternate');
const finished = {
  type: 'sources.discoveryFinished',
  discoveryId: 1,
  snapshot: { currentTime: 0 },
  nowMs: 11_000,
} as const;

function load(state: PlaybackSessionState, sources = [current]) {
  return reducePlaybackSession(state, {
    type: 'sources.loaded',
    sources,
    currentSourceKey: 'current-1',
    currentEpisodeIndex: 0,
    contentKey: '测试影片::2026',
    sourceStatuses: new Map(
      sources.map((item) => [`${item.source}-1`, { kind: 'direct' }])
    ),
  }).state;
}

function starting() {
  const state = load(createInitialPlaybackSessionState());
  const discovery = reducePlaybackSession(state, {
    type: 'sources.discoveryStarted',
    discoveryId: 1,
  }).state;
  return reducePlaybackSession(discovery, {
    type: 'sourceChange.started',
    attemptId: 1,
    sourceKey: 'current-1',
  }).state;
}

function failed(
  state = starting(),
  kind: 'timeout' | 'runtime' = 'timeout',
  currentTime = 0
) {
  return reducePlaybackSession(
    state,
    kind === 'timeout'
      ? {
          type: 'timer.sourceChangeTimeout',
          attemptId: 1,
          sourceKey: 'current-1',
          nowMs: 10_000,
          snapshot: { currentTime },
        }
      : {
          type: 'recovery.runtimeEvidence',
          nowMs: 10_000,
          snapshot: { currentTime },
          evidence: {
            platform: 'hlsjs',
            hardFailure: true,
            stallCandidate: true,
          },
        }
  );
}

describe('source discovery and deferred startup recovery', () => {
  it.each(['timeout', 'runtime'] as const)(
    'defers %s failure until pending discovery delivers a candidate',
    (kind) => {
      const waiting = failed(starting(), kind);
      expect(waiting.state.recoveryStage).not.toBe('exhausted');
      expect(waiting.state.deferredSourceRecovery?.sourceKey).toBe('current-1');
      expect(
        waiting.effects.some((effect) => effect.type === 'showInPlayerFailure')
      ).toBe(false);

      const result = reducePlaybackSession(
        load(waiting.state, [current, alternate]),
        finished
      );
      expect(result.state.sourceDiscoveryPending).toBe(false);
      expect(result.state.deferredSourceRecovery).toBeNull();
      expect(result.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'switchSource',
            sourceKey: 'alternate-1',
          }),
        ])
      );
    }
  );

  it('only declares exhaustion after discovery completes with no alternate', () => {
    const result = reducePlaybackSession(failed().state, finished);
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

  it('retains the failure playhead while waiting for discovery even if media time collapses', () => {
    const waiting = failed(starting(), 'timeout', 33).state;
    const result = reducePlaybackSession(
      load(waiting, [current, alternate]),
      finished
    );
    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'switchSource',
          sourceKey: 'alternate-1',
          resumeTime: 31.5,
        }),
      ])
    );
    expect(result.state.badPoints).toEqual([]);
  });

  it('does not let an older discovery finish or its deferred failure consume a new search', () => {
    const newer = reducePlaybackSession(failed().state, {
      type: 'sources.discoveryStarted',
      discoveryId: 2,
    });
    expect(newer.state.deferredSourceRecovery).toBeNull();
    const old = reducePlaybackSession(newer.state, finished);
    expect(old.state).toBe(newer.state);
    expect(old.state.sourceDiscoveryPending).toBe(true);
    expect(old.effects).toEqual([]);
    const done = reducePlaybackSession(old.state, {
      ...finished,
      discoveryId: 2,
    });
    expect(done.state.sourceDiscoveryPending).toBe(false);
    expect(done.effects).toEqual([]);
  });

  it('ignores duplicate or older discovery starts without dropping a deferred failure', () => {
    const waiting = failed().state;
    for (const discoveryId of [0, 1]) {
      const result = reducePlaybackSession(waiting, {
        type: 'sources.discoveryStarted',
        discoveryId,
      });
      expect(result.state).toBe(waiting);
      expect(result.state.deferredSourceRecovery).not.toBeNull();
    }
  });

  it.each<PlaybackSessionEvent>([
    { type: 'user.pause' },
    { type: 'user.seekStarted', nowMs: 10_100 },
    { type: 'user.switchSource', sourceKey: 'alternate-1', nowMs: 10_100 },
    { type: 'user.switchEpisode', episodeIndex: 1, nowMs: 10_100 },
    { type: 'recovery.cancel' },
    { type: 'sourceChange.started', attemptId: 2, sourceKey: 'current-1' },
    {
      type: 'recovery.progressHealthy',
      snapshot: { currentTime: 1 },
      nowMs: 10_100,
    },
  ])('cancels deferred recovery on $type', (event) => {
    const waiting = load(failed().state, [current, alternate]);
    const changed = reducePlaybackSession(waiting, event);
    expect(changed.state.deferredSourceRecovery).toBeNull();
    const result = reducePlaybackSession(changed.state, finished);
    expect(
      result.effects.some((effect) => effect.type === 'switchSource')
    ).toBe(false);
  });

  it('clears deferred failure when the actual source eventually becomes playable', () => {
    const waiting = failed().state;
    const completed = reducePlaybackSession(waiting, {
      type: 'sourceChange.completed',
      attemptId: 1,
      sourceKey: 'current-1',
      automatic: false,
      nowMs: 10_100,
    });
    expect(completed.state.deferredSourceRecovery).toBeNull();
    const result = reducePlaybackSession(
      load(completed.state, [current, alternate]),
      finished
    );
    expect(result.effects).toEqual([]);
  });

  it('does not let an unrelated canplay erase the deferred failure', () => {
    const waiting = failed().state;
    const completed = reducePlaybackSession(waiting, {
      type: 'sourceChange.completed',
      attemptId: 2,
      sourceKey: 'current-1',
      automatic: false,
      nowMs: 10_100,
    });
    expect(completed.state).toBe(waiting);
  });

  it('clears the deferred failure when content changes', () => {
    const result = reducePlaybackSession(failed().state, {
      type: 'sources.loaded',
      sources: [current, alternate],
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
      contentKey: '另一部片::2026',
    });
    expect(result.state.deferredSourceRecovery).toBeNull();
    expect(reducePlaybackSession(result.state, finished).effects).toEqual([]);
  });

  it('does not let a paused timeout bypass the intent gate while discovery is pending', () => {
    const paused = reducePlaybackSession(starting(), {
      type: 'user.pause',
    }).state;
    const waiting = failed(paused);
    expect(waiting.state.recoveryStage).not.toBe('exhausted');
    expect(
      waiting.effects.some((effect) => effect.type === 'showInPlayerFailure')
    ).toBe(false);
    const result = reducePlaybackSession(
      load(waiting.state, [current, alternate]),
      finished
    );
    expect(result.effects).toEqual([]);
    expect(result.state.playbackIntent).toBe('user-paused');
  });
});
