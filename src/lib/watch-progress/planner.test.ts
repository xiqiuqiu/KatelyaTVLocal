import type { PlayRecord } from '@/lib/types';

import {
  adaptWatchProgressPlayhead,
  buildWatchProgressStorageKey,
  mergeWatchProgressRecords,
  parseWatchProgressStorageKey,
  planEpisodeChangeSave,
  planLatestWatchProgressForContent,
  planWatchProgressRead,
  planWatchProgressWrite,
} from './planner';

function createRecord(overrides: Partial<PlayRecord> = {}): PlayRecord {
  return {
    title: '测试影片',
    source_name: '测试源',
    year: '2026',
    cover: 'https://example.com/poster.jpg',
    index: 2,
    total_episodes: 12,
    play_time: 120,
    total_time: 3600,
    save_time: 1000,
    search_title: '测试影片',
    ...overrides,
  };
}

describe('Watch Progress storage keys', () => {
  it('builds and parses contentKey+episodeIndex keys', () => {
    const key = buildWatchProgressStorageKey('测试影片::2026', 1);
    expect(key).toBe('wp:测试影片::2026#1');
    expect(parseWatchProgressStorageKey(key)).toEqual({
      contentKey: '测试影片::2026',
      episodeIndex: 1,
    });
  });

  it('rejects legacy source+id keys', () => {
    expect(parseWatchProgressStorageKey('source-a+123')).toBeNull();
  });
});

describe('mergeWatchProgressRecords', () => {
  it('prefers the newer save_time and keeps route preferences from the winner', () => {
    const older = createRecord({
      play_time: 90,
      save_time: 1000,
      route_source: 'source-a',
      route_id: '1',
    });
    const newer = createRecord({
      play_time: 150,
      save_time: 2000,
      route_source: 'source-b',
      route_id: '99',
    });

    expect(mergeWatchProgressRecords([older, newer])).toEqual(newer);
  });

  it('breaks equal save_time ties by larger play_time', () => {
    const left = createRecord({ play_time: 90, save_time: 1000 });
    const right = createRecord({ play_time: 140, save_time: 1000 });
    expect(mergeWatchProgressRecords([left, right])).toEqual(right);
  });
});

describe('planWatchProgressRead', () => {
  const contentKey = '测试影片::2026';
  const episodeIndex = 1;

  it('prefers the contentKey record and can merge a legacy fallback', () => {
    const primary = createRecord({
      play_time: 200,
      save_time: 3000,
      route_source: 'source-b',
      route_id: '99',
    });
    const legacy = createRecord({
      play_time: 120,
      save_time: 1000,
      route_source: 'source-a',
      route_id: '1',
    });

    const result = planWatchProgressRead({
      contentKey,
      episodeIndex,
      records: {
        [buildWatchProgressStorageKey(contentKey, episodeIndex)]: primary,
        'source-a+1': legacy,
      },
      legacyRoute: { source: 'source-a', id: '1' },
      authorityMode: 'content-key',
    });

    expect(result.record).toEqual(primary);
    expect(result.storageKey).toBe(
      buildWatchProgressStorageKey(contentKey, episodeIndex)
    );
    expect(result.mergedFromLegacy).toBe(false);
  });

  it('falls back to legacy source+id when contentKey record is missing', () => {
    const legacy = createRecord({
      index: 2,
      play_time: 180,
      save_time: 1500,
    });

    const result = planWatchProgressRead({
      contentKey,
      episodeIndex,
      records: {
        'source-a+1': legacy,
      },
      legacyRoute: { source: 'source-a', id: '1' },
      authorityMode: 'content-key',
    });

    expect(result.record).toEqual(legacy);
    expect(result.mergedFromLegacy).toBe(true);
    expect(result.storageKey).toBe('source-a+1');
  });

  it('uses only legacy keys when authority is rolled back', () => {
    const primary = createRecord({ play_time: 999, save_time: 9999 });
    const legacy = createRecord({ play_time: 50, save_time: 100 });

    const result = planWatchProgressRead({
      contentKey,
      episodeIndex,
      records: {
        [buildWatchProgressStorageKey(contentKey, episodeIndex)]: primary,
        'source-a+1': legacy,
      },
      legacyRoute: { source: 'source-a', id: '1' },
      authorityMode: 'legacy',
    });

    expect(result.record).toEqual(legacy);
    expect(result.storageKey).toBe('source-a+1');
    expect(result.mergedFromLegacy).toBe(false);
  });
});

describe('planWatchProgressWrite', () => {
  const contentKey = '测试影片::2026';
  const episodeIndex = 1;

  it('writes the contentKey target and dual-writes legacy source+id', () => {
    const plan = planWatchProgressWrite({
      contentKey,
      episodeIndex,
      route: { source: 'source-b', id: '99' },
      authorityMode: 'content-key',
      dualWrite: true,
    });

    expect(plan.primaryKey).toBe(
      buildWatchProgressStorageKey(contentKey, episodeIndex)
    );
    expect(plan.dualWriteKeys).toEqual(['source-b+99']);
  });

  it('can stop dual-write while keeping contentKey as the logical target', () => {
    const plan = planWatchProgressWrite({
      contentKey,
      episodeIndex,
      route: { source: 'source-b', id: '99' },
      authorityMode: 'content-key',
      dualWrite: false,
    });

    expect(plan.primaryKey).toBe(
      buildWatchProgressStorageKey(contentKey, episodeIndex)
    );
    expect(plan.dualWriteKeys).toEqual([]);
  });

  it('rolls back to legacy-only writes without touching contentKey keys', () => {
    const plan = planWatchProgressWrite({
      contentKey,
      episodeIndex,
      route: { source: 'source-a', id: '1' },
      authorityMode: 'legacy',
      dualWrite: true,
    });

    expect(plan.primaryKey).toBe('source-a+1');
    expect(plan.dualWriteKeys).toEqual([]);
  });
});

describe('planLatestWatchProgressForContent', () => {
  it('selects the newest record for a contentKey across episodes and routes', () => {
    const contentKey = '测试影片::2026';
    const result = planLatestWatchProgressForContent({
      contentKey,
      authorityMode: 'content-key',
      legacyRoute: { source: 'source-a', id: '1' },
      records: {
        [buildWatchProgressStorageKey(contentKey, 0)]: createRecord({
          index: 1,
          play_time: 10,
          save_time: 100,
        }),
        [buildWatchProgressStorageKey(contentKey, 2)]: createRecord({
          index: 3,
          play_time: 200,
          save_time: 300,
          route_source: 'source-b',
          route_id: '99',
        }),
        'other-title+9': createRecord({
          title: '另一部',
          search_title: '另一部',
          index: 3,
          play_time: 999,
          save_time: 999,
        }),
      },
    });

    expect(result.record?.index).toBe(3);
    expect(result.storageKey).toBe(buildWatchProgressStorageKey(contentKey, 2));
    expect(result.mergedFromLegacy).toBe(false);
  });
});

describe('adaptWatchProgressPlayhead (A′)', () => {
  it('clamps onto the target duration when timelines are aligned', () => {
    expect(
      adaptWatchProgressPlayhead({
        playTime: 100,
        sourceTotalTime: 3600,
        targetTotalTime: 3600,
      })
    ).toBe(100);
  });

  it('maps proportionally when duration mismatch is large', () => {
    expect(
      adaptWatchProgressPlayhead({
        playTime: 100,
        sourceTotalTime: 1000,
        targetTotalTime: 2000,
      })
    ).toBe(200);
  });

  it('keeps the seed when target duration is unknown', () => {
    expect(
      adaptWatchProgressPlayhead({
        playTime: 88,
        sourceTotalTime: 3600,
        targetTotalTime: 0,
      })
    ).toBe(88);
  });
});

describe('planEpisodeChangeSave', () => {
  it('always requires saving the previous episode before advancing', () => {
    expect(
      planEpisodeChangeSave({
        previousEpisodeIndex: 1,
        nextEpisodeIndex: 2,
        playTime: 240,
        totalTime: 1800,
        reason: 'episode-change',
      })
    ).toEqual({
      mustSavePrevious: true,
      completed: false,
      playTime: 240,
    });
  });

  it('marks ended→next as a completed previous-episode save', () => {
    expect(
      planEpisodeChangeSave({
        previousEpisodeIndex: 1,
        nextEpisodeIndex: 2,
        playTime: 1795,
        totalTime: 1800,
        reason: 'episode-ended',
      })
    ).toEqual({
      mustSavePrevious: true,
      completed: true,
      playTime: 1800,
    });
  });
});
