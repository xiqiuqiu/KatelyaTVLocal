import type { PlayRecord } from '@/lib/db.client';
import { buildContinueWatchingRecords } from '@/lib/play-records';

function createRecord(overrides: Partial<PlayRecord> = {}): PlayRecord {
  return {
    title: '示例影片',
    source_name: '测试源',
    year: '2026',
    cover: 'https://example.com/poster.jpg',
    index: 3,
    total_episodes: 12,
    play_time: 120,
    total_time: 3600,
    save_time: 1,
    search_title: '示例影片',
    ...overrides,
  };
}

describe('buildContinueWatchingRecords', () => {
  it('groups source-specific records and keeps the most recent source as the entry point', () => {
    const records = {
      'source-a+1': createRecord({
        title: '示例影片',
        save_time: 100,
        search_title: '示例影片',
      }),
      'source-b+99': createRecord({
        title: '示例影片 高清',
        save_time: 300,
        search_title: '示例影片',
      }),
      'source-c+7': createRecord({
        title: '另一部影片',
        year: '2025',
        total_episodes: 1,
        save_time: 200,
        search_title: '另一部影片',
      }),
    };

    const result = buildContinueWatchingRecords(records);

    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('source-b+99');
    expect(result[0].groupedKeys).toEqual(['source-b+99', 'source-a+1']);
    expect(result[1].key).toBe('source-c+7');
  });

  it('can still merge records when one source is missing search_title', () => {
    const records = {
      'source-a+1': createRecord({
        title: '示例影片',
        save_time: 100,
        search_title: '示例影片',
      }),
      'source-b+99': createRecord({
        title: '示例影片',
        save_time: 200,
        search_title: undefined,
      }),
    };

    const result = buildContinueWatchingRecords(records);

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('source-b+99');
    expect(result[0].groupedKeys).toEqual(['source-b+99', 'source-a+1']);
  });
});
