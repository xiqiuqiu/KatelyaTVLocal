import {
  createInitialPlaybackSessionState,
  reducePlaybackSession,
} from '@/lib/playback-session';
import type { SearchResult, SourceStatus } from '@/lib/types';

function createSource(
  source: string,
  id: string,
  episodes: string[] = ['ep-1.m3u8', 'ep-2.m3u8']
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

function playingWith(
  sources: SearchResult[],
  statuses: Map<string, SourceStatus>
) {
  const loaded = reducePlaybackSession(createInitialPlaybackSessionState(), {
    type: 'sources.loaded',
    sources,
    currentSourceKey: 'current-1',
    currentEpisodeIndex: 1,
    sourceStatuses: statuses,
  }).state;
  return reducePlaybackSession(loaded, { type: 'user.play' }).state;
}

const midPlayback = { currentTime: 480 };

describe('starvation switches source immediately', () => {
  const current = createSource('current', '1');
  const verified = createSource('verified', '2');
  const unknown = createSource('unknown', '3');

  it('switches to a verified source without same-source recovery', () => {
    const state = playingWith(
      [current, verified],
      new Map<string, SourceStatus>([
        ['verified-2', { kind: 'direct', reason: '浏览器可直接播放' }],
      ])
    );

    const result = reducePlaybackSession(state, {
      type: 'recovery.runtimeEvidence',
      nowMs: 20_000,
      snapshot: midPlayback,
      evidence: {
        platform: 'hlsjs',
        stallCandidate: true,
        starved: true,
      },
    });

    expect(
      result.effects.some((effect) => effect.type === 'sameSourceRecover')
    ).toBe(false);
    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'switchSource',
          sourceKey: 'verified-2',
          reason: 'auto-recovery',
        }),
      ])
    );
  });

  it('may try one unverified source once playback is already underway', () => {
    const state = playingWith(
      [current, unknown],
      new Map<string, SourceStatus>([['unknown-3', { kind: 'idle' }]])
    );

    const result = reducePlaybackSession(state, {
      type: 'recovery.runtimeEvidence',
      nowMs: 20_000,
      snapshot: midPlayback,
      evidence: {
        platform: 'hlsjs',
        stallCandidate: true,
        starved: true,
      },
    });

    expect(
      result.effects.some(
        (effect) =>
          effect.type === 'switchSource' && effect.sourceKey === 'unknown-3'
      )
    ).toBe(true);
  });

  it('prefers a verified source over an unverified one', () => {
    const state = playingWith(
      [current, unknown, verified],
      new Map<string, SourceStatus>([
        ['unknown-3', { kind: 'idle' }],
        ['verified-2', { kind: 'playable', reason: '后端测速可用' }],
      ])
    );

    const result = reducePlaybackSession(state, {
      type: 'recovery.runtimeEvidence',
      nowMs: 20_000,
      snapshot: midPlayback,
      evidence: { platform: 'hlsjs', starved: true },
    });

    expect(
      result.effects.find((effect) => effect.type === 'switchSource')
    ).toEqual(expect.objectContaining({ sourceKey: 'verified-2' }));
  });

  it('lets a mid-playback hard failure try one unverified source', () => {
    const state = playingWith(
      [current, unknown],
      new Map<string, SourceStatus>([['unknown-3', { kind: 'idle' }]])
    );

    const result = reducePlaybackSession(state, {
      type: 'recovery.runtimeEvidence',
      nowMs: 20_000,
      snapshot: midPlayback,
      evidence: {
        platform: 'hlsjs',
        stallCandidate: true,
        hardFailure: true,
      },
    });

    expect(
      result.effects.find((effect) => effect.type === 'switchSource')
    ).toEqual(expect.objectContaining({ sourceKey: 'unknown-3' }));
  });

  it('keeps a single soft stall on the same-source ladder', () => {
    const state = playingWith(
      [current, verified],
      new Map<string, SourceStatus>([['verified-2', { kind: 'direct' }]])
    );

    const result = reducePlaybackSession(state, {
      type: 'video.waiting',
      nowMs: 20_000,
      snapshot: midPlayback,
    });

    expect(
      result.effects.some((effect) => effect.type === 'switchSource')
    ).toBe(false);
    expect(result.state.recoveryStage).toBe('R0');
  });
});
