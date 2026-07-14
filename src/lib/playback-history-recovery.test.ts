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

  it('restores episode from the play record when the URL omits episode', () => {
    const requested = createSource({
      episodes: [
        'https://example.com/1.m3u8',
        'https://example.com/2.m3u8',
        'https://example.com/3.m3u8',
      ],
    });

    const result = resolvePlaybackHistoryRecovery({
      currentSource: 'source-a',
      currentId: '1',
      searchResults: [requested],
      detailResults: [],
      isFromPlayRecord: false,
      urlEpisodeIndex: null,
      historyRecord: createRecord({ index: 3, play_time: 180 }),
    });

    expect(result.resumeEpisodeIndex).toBe(2);
    expect(result.resumeTime).toBeGreaterThan(0);
    expect(result.contentKey).toBe('测试影片::2026');
  });

  it('does not invent episode one when a play record already has progress', () => {
    const requested = createSource();

    const result = resolvePlaybackHistoryRecovery({
      currentSource: 'source-a',
      currentId: '1',
      searchResults: [requested],
      detailResults: [],
      isFromPlayRecord: true,
      urlEpisodeIndex: null,
      historyRecord: createRecord({ index: 2, play_time: 96 }),
    });

    expect(result.resumeEpisodeIndex).not.toBe(0);
    expect(result.resumeEpisodeIndex).toBe(1);
  });

  it('lets an explicit URL episode win over the play-record episode', () => {
    const requested = createSource({
      episodes: [
        'https://example.com/1.m3u8',
        'https://example.com/2.m3u8',
        'https://example.com/3.m3u8',
      ],
    });

    const result = resolvePlaybackHistoryRecovery({
      currentSource: 'source-a',
      currentId: '1',
      searchResults: [requested],
      detailResults: [],
      isFromPlayRecord: false,
      urlEpisodeIndex: 0,
      historyRecord: createRecord({ index: 3, play_time: 180 }),
    });

    expect(result.resumeEpisodeIndex).toBe(0);
    expect(result.resumeTime).toBeNull();
  });
});
