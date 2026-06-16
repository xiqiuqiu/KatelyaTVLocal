import {
  resolvePlaybackHistoryRecovery,
  type PlaybackHistoryRecord,
} from '@/lib/playback-history-recovery';
import type { SearchResult } from '@/lib/types';

function createSource(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: '1',
    source: 'source-a',
    title: '测试影片',
    year: '2026',
    poster: '',
    episodes: ['https://example.com/1.m3u8', 'https://example.com/2.m3u8'],
    source_name: '测试源',
    ...overrides,
  };
}

function createRecord(
  overrides: Partial<PlaybackHistoryRecord> = {}
): PlaybackHistoryRecord {
  return {
    index: 2,
    play_time: 96,
    ...overrides,
  };
}

describe('resolvePlaybackHistoryRecovery', () => {
  it('keeps the requested source when search results still contain it', () => {
    const requested = createSource({ source: 'old-source', id: 'old-id' });
    const fallback = createSource({ source: 'new-source', id: 'new-id' });

    const result = resolvePlaybackHistoryRecovery({
      currentSource: 'old-source',
      currentId: 'old-id',
      searchResults: [fallback, requested],
      detailResults: [],
      isFromPlayRecord: true,
      historyRecord: createRecord(),
    });

    expect(result.detail).toBe(requested);
    expect(result.sources).toEqual([fallback, requested]);
    expect(result.fellBackFromHistory).toBe(false);
    expect(result.resumeEpisodeIndex).toBe(1);
    expect(result.resumeTime).toBeGreaterThan(0);
  });

  it('falls back to same-title search results for expired play-record source ids', () => {
    const replacement = createSource({ source: 'new-source', id: 'new-id' });

    const result = resolvePlaybackHistoryRecovery({
      currentSource: 'old-source',
      currentId: 'old-id',
      searchResults: [replacement],
      detailResults: [],
      isFromPlayRecord: true,
      historyRecord: createRecord(),
    });

    expect(result.detail).toBe(replacement);
    expect(result.sources).toEqual([replacement]);
    expect(result.fellBackFromHistory).toBe(true);
    expect(result.resumeEpisodeIndex).toBe(1);
    expect(result.resumeTime).toBeGreaterThan(0);
  });

  it('uses detail fallback as the final source list when search results miss', () => {
    const detail = createSource({ source: 'detail-source', id: 'detail-id' });

    const result = resolvePlaybackHistoryRecovery({
      currentSource: 'detail-source',
      currentId: 'detail-id',
      searchResults: [],
      detailResults: [detail],
      isFromPlayRecord: true,
      historyRecord: createRecord(),
    });

    expect(result.detail).toBe(detail);
    expect(result.sources).toEqual([detail]);
    expect(result.fellBackFromHistory).toBe(false);
    expect(result.resumeEpisodeIndex).toBe(1);
    expect(result.resumeTime).toBeGreaterThan(0);
  });

  it('does not fall back to a different source for non-history entry points', () => {
    const replacement = createSource({ source: 'new-source', id: 'new-id' });

    const result = resolvePlaybackHistoryRecovery({
      currentSource: 'old-source',
      currentId: 'old-id',
      searchResults: [replacement],
      detailResults: [],
      isFromPlayRecord: false,
      historyRecord: createRecord(),
    });

    expect(result.detail).toBeNull();
    expect(result.sources).toEqual([]);
    expect(result.error).toBe('未找到匹配结果');
  });

  it('resets to the first episode when the replacement source has fewer episodes', () => {
    const replacement = createSource({
      source: 'new-source',
      id: 'new-id',
      episodes: ['https://example.com/1.m3u8'],
    });

    const result = resolvePlaybackHistoryRecovery({
      currentSource: 'old-source',
      currentId: 'old-id',
      searchResults: [replacement],
      detailResults: [],
      isFromPlayRecord: true,
      historyRecord: createRecord({ index: 4, play_time: 240 }),
    });

    expect(result.detail).toBe(replacement);
    expect(result.fellBackFromHistory).toBe(true);
    expect(result.resumeEpisodeIndex).toBe(0);
    expect(result.resumeTime).toBeNull();
  });
});
