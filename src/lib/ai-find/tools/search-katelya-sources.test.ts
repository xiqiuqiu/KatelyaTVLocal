import { getAvailableApiSites } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import type { SearchResult } from '@/lib/types';

import {
  aggregateSearchResults,
  buildAiFindResultGroup,
} from './search-katelya-sources';

jest.mock('@/lib/config', () => ({
  getAvailableApiSites: jest.fn(),
}));

jest.mock('@/lib/downstream', () => ({
  searchFromApi: jest.fn(),
}));

function makeResult(override: Partial<SearchResult> = {}): SearchResult {
  return {
    id: '1',
    title: '隐秘的角落',
    poster: '',
    episodes: ['https://example.com/a.m3u8'],
    source: 's1',
    source_name: '源1',
    year: '2020',
    ...override,
  };
}

describe('AI find Katelya source aggregation', () => {
  const mockedGetAvailableApiSites =
    getAvailableApiSites as jest.MockedFunction<typeof getAvailableApiSites>;
  const mockedSearchFromApi = searchFromApi as jest.MockedFunction<
    typeof searchFromApi
  >;

  beforeEach(() => {
    mockedGetAvailableApiSites.mockResolvedValue([
      {
        key: 'test',
        name: '测试源',
        api: 'https://example.com/api.php/provide/vod/',
      },
    ]);
    mockedSearchFromApi.mockReset();
  });

  it('groups source results by normalized title, year, and media type', () => {
    const groups = aggregateSearchResults('隐秘的角落', [
      makeResult({ source: 's1', id: '1' }),
      makeResult({ source: 's2', id: '2' }),
      makeResult({
        title: '隐秘的角落',
        source: 's3',
        id: '3',
        year: '2020',
        episodes: ['a', 'b'],
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].type).toBe('tv');
  });

  it('keeps the requested TV season even when newer movie variants fill the first result page', async () => {
    mockedSearchFromApi.mockResolvedValue([
      ...Array.from({ length: 35 }, (_, index) =>
        makeResult({
          id: `movie-${index}`,
          title:
            index % 2 === 0
              ? '鬼灭之刃 剧场版 无限城篇'
              : '鬼灭之刃 剧场版 无限城篇 第一章 猗窝座再来',
          year: '2025',
          episodes: ['movie.m3u8'],
          douban_id: 36524559,
        })
      ),
      makeResult({
        id: 'tv-2019',
        title: '鬼灭之刃',
        year: '2019',
        episodes: Array.from(
          { length: 26 },
          (_, index) => `episode-${index + 1}.m3u8`
        ),
        douban_id: 30210221,
      }),
    ]);

    const group = await buildAiFindResultGroup({
      candidate: {
        query: '鬼灭之刃',
        reason: '最直接的中文片名，通常默认指TV动画第一季',
        confidence: 'high',
        verifiedTitle: '鬼灭之刃',
        year: '2019',
        type: 'tv',
      },
      maxGroups: 8,
      cacheTtlSeconds: 0,
    });

    expect(group.groups[0]).toMatchObject({
      title: '鬼灭之刃',
      year: '2019',
      type: 'tv',
    });
    expect(group.groups[0].items[0].episodes).toHaveLength(26);
    expect(group.groups.some((item) => item.title.includes('剧场版'))).toBe(
      false
    );
  });
});
