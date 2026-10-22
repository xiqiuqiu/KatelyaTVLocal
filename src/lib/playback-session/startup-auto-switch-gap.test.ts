import {
  createInitialPlaybackSessionState,
  reducePlaybackSession,
} from '@/lib/playback-session';
import type { SearchResult, SourceStatus } from '@/lib/types';

/**
 * Feedback loop for startup hang: bad collection source selected, playback
 * never starts, designed auto-switch must still fire.
 *
 * Two production gaps this suite locks down:
 * 1) Session R3 evaluated without sources.loaded (adapter must sync first)
 * 2) At t≈0 only idle/unknown alts exist — verified-only eligibility exhausts
 */
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

function playingState() {
  return reducePlaybackSession(createInitialPlaybackSessionState(), {
    type: 'user.play',
  }).state;
}

const startupHardFailure = {
  type: 'recovery.runtimeEvidence' as const,
  nowMs: 10_000,
  snapshot: { currentTime: 0 },
  evidence: {
    platform: 'hlsjs' as const,
    hardFailure: true,
    stallCandidate: true,
  },
};

describe('startup hang auto-switch feedback loop', () => {
  const current = createSource('bad', '1');
  const alt = createSource('good', '2');

  it('control: synced session with direct alt switches on startup hard failure', () => {
    const synced = reducePlaybackSession(playingState(), {
      type: 'sources.loaded',
      sources: [current, alt],
      currentSourceKey: 'bad-1',
      currentEpisodeIndex: 0,
      sourceStatuses: new Map<string, SourceStatus>([
        ['bad-1', { kind: 'playable', reason: '后端优选命中但实际起播失败' }],
        ['good-2', { kind: 'direct', reason: '浏览器可直接播放' }],
      ]),
    }).state;

    const result = reducePlaybackSession(synced, startupHardFailure);

    expect(
      result.effects.some(
        (effect) =>
          effect.type === 'switchSource' && effect.sourceKey === 'good-2'
      )
    ).toBe(true);
  });

  it('startup: synced session with only idle alts still switches (unverified fallback)', () => {
    const synced = reducePlaybackSession(playingState(), {
      type: 'sources.loaded',
      sources: [current, alt],
      currentSourceKey: 'bad-1',
      currentEpisodeIndex: 0,
      sourceStatuses: new Map<string, SourceStatus>([
        ['bad-1', { kind: 'unavailable', reason: '起播失败' }],
        ['good-2', { kind: 'idle' }],
      ]),
    }).state;

    const result = reducePlaybackSession(synced, startupHardFailure);

    expect(
      result.effects.some(
        (effect) =>
          effect.type === 'switchSource' && effect.sourceKey === 'good-2'
      )
    ).toBe(true);
  });

  it('source-change timeout with only idle alts switches after sources are synced', () => {
    const synced = reducePlaybackSession(playingState(), {
      type: 'sources.loaded',
      sources: [current, alt],
      currentSourceKey: 'bad-1',
      currentEpisodeIndex: 0,
      sourceStatuses: new Map<string, SourceStatus>([
        ['good-2', { kind: 'idle' }],
      ]),
    }).state;

    const started = reducePlaybackSession(synced, {
      type: 'sourceChange.started',
      attemptId: 1,
      sourceKey: 'bad-1',
    }).state;

    const result = reducePlaybackSession(started, {
      type: 'timer.sourceChangeTimeout',
      attemptId: 1,
      sourceKey: 'bad-1',
      nowMs: 25_000,
      snapshot: { currentTime: 0 },
    });

    expect(
      result.effects.some(
        (effect) =>
          effect.type === 'switchSource' && effect.sourceKey === 'good-2'
      )
    ).toBe(true);
  });

  it('source-change timeout while intent is paused shows the failure panel', () => {
    const synced = reducePlaybackSession(playingState(), {
      type: 'sources.loaded',
      sources: [current, alt],
      currentSourceKey: 'bad-1',
      currentEpisodeIndex: 0,
      sourceStatuses: new Map<string, SourceStatus>([
        ['good-2', { kind: 'direct' }],
      ]),
    }).state;
    const started = reducePlaybackSession(synced, {
      type: 'sourceChange.started',
      attemptId: 1,
      sourceKey: 'bad-1',
    }).state;
    const paused = reducePlaybackSession(started, { type: 'user.pause' }).state;

    const result = reducePlaybackSession(paused, {
      type: 'timer.sourceChangeTimeout',
      attemptId: 1,
      sourceKey: 'bad-1',
      nowMs: 25_000,
      snapshot: { currentTime: 36 },
    });

    expect(
      result.effects.some((effect) => effect.type === 'switchSource')
    ).toBe(false);
    expect(
      result.effects.some((effect) => effect.type === 'showInPlayerFailure')
    ).toBe(true);
    expect(result.state.recoveryStage).toBe('exhausted');
  });

  it('repro guard: unsynced empty session still cannot invent candidates', () => {
    const result = reducePlaybackSession(playingState(), startupHardFailure);

    expect(
      result.effects.some((effect) => effect.type === 'switchSource')
    ).toBe(false);
    expect(result.state.recoveryStage).toBe('exhausted');
  });

  it('a skipped recovery target moves on to the next candidate', () => {
    const third = createSource('third', '3');
    const synced = reducePlaybackSession(playingState(), {
      type: 'sources.loaded',
      sources: [current, alt, third],
      currentSourceKey: 'bad-1',
      currentEpisodeIndex: 0,
      sourceStatuses: new Map<string, SourceStatus>([
        ['good-2', { kind: 'direct' }],
        ['third-3', { kind: 'direct' }],
      ]),
    }).state;
    const first = reducePlaybackSession(synced, startupHardFailure);
    const firstTarget = first.effects.find(
      (effect) => effect.type === 'switchSource'
    );
    expect(firstTarget).toMatchObject({ sourceKey: 'good-2' });

    const skipped = reducePlaybackSession(first.state, {
      type: 'recovery.switchSkipped',
      sourceKey: 'good-2',
      reason: 'auto-recovery',
      nowMs: 10_100,
      snapshot: { currentTime: 0 },
    });

    expect(skipped.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'switchSource',
          sourceKey: 'third-3',
        }),
      ])
    );
    expect(skipped.state.recoveredSourceKeys.has('good-2')).toBe(true);

    const exhausted = reducePlaybackSession(skipped.state, {
      type: 'recovery.switchSkipped',
      sourceKey: 'third-3',
      reason: 'auto-recovery',
      nowMs: 10_200,
      snapshot: { currentTime: 0 },
    });
    expect(
      exhausted.effects.some((effect) => effect.type === 'switchSource')
    ).toBe(false);
    expect(exhausted.state.recoveryStage).toBe('exhausted');
    expect(
      exhausted.effects.some((effect) => effect.type === 'showInPlayerFailure')
    ).toBe(true);
  });

  it('caps blind startup switches on a cold title', () => {
    const sources = [
      current,
      ...['a', 'b', 'c', 'd'].map((s) => createSource(s, '9')),
    ];
    let state = reducePlaybackSession(playingState(), {
      type: 'sources.loaded',
      sources,
      currentSourceKey: 'bad-1',
      currentEpisodeIndex: 0,
    }).state;
    const tried: string[] = [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = reducePlaybackSession(state, {
        ...startupHardFailure,
        nowMs: 10_000 + attempt * 30_000,
      });
      const target = result.effects.find(
        (effect) => effect.type === 'switchSource'
      );
      if (!target || target.type !== 'switchSource') {
        expect(result.state.recoveryStage).toBe('exhausted');
        break;
      }
      tried.push(target.sourceKey);
      state = reducePlaybackSession(result.state, {
        type: 'sources.loaded',
        sources,
        currentSourceKey: target.sourceKey,
        currentEpisodeIndex: 0,
        recoveredSourceKeys: result.state.recoveredSourceKeys,
      }).state;
    }

    expect(tried).toEqual(['a-9', 'b-9']);
  });

  it('mid-playback hard failure tries one unverified source before exhausting', () => {
    const synced = reducePlaybackSession(playingState(), {
      type: 'sources.loaded',
      sources: [current, alt],
      currentSourceKey: 'bad-1',
      currentEpisodeIndex: 0,
      sourceStatuses: new Map<string, SourceStatus>([
        ['good-2', { kind: 'idle' }],
      ]),
    }).state;

    const result = reducePlaybackSession(synced, {
      type: 'recovery.runtimeEvidence',
      nowMs: 60_000,
      snapshot: { currentTime: 120 },
      evidence: {
        platform: 'hlsjs',
        hardFailure: true,
        stallCandidate: true,
      },
    });

    expect(
      result.effects.some(
        (effect) =>
          effect.type === 'switchSource' && effect.sourceKey === 'good-2'
      )
    ).toBe(true);

    const switched = reducePlaybackSession(result.state, {
      type: 'sources.loaded',
      sources: [current, alt],
      currentSourceKey: 'good-2',
      currentEpisodeIndex: 0,
      sourceStatuses: new Map<string, SourceStatus>([
        ['good-2', { kind: 'unavailable', reason: '未知线路起播失败' }],
      ]),
      recoveredSourceKeys: result.state.recoveredSourceKeys,
    }).state;
    const secondFailure = reducePlaybackSession(switched, {
      type: 'recovery.runtimeEvidence',
      nowMs: 70_000,
      snapshot: { currentTime: 120 },
      evidence: {
        platform: 'hlsjs',
        hardFailure: true,
        stallCandidate: true,
      },
    });

    expect(
      secondFailure.effects.some((effect) => effect.type === 'switchSource')
    ).toBe(false);
    expect(secondFailure.state.recoveryStage).toBe('exhausted');
  });
});
