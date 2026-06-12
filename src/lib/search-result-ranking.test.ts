import type { SearchResult } from '@/lib/types';

import {
  shouldSuggestAiFind,
  sortSearchResultGroupsByRanking,
  sortSearchResultsByRanking,
} from './search-result-ranking';

function makeResult(override: Partial<SearchResult>): SearchResult {
  return {
    id: override.id || 'id',
    title: override.title || '鬼灭之刃',
    poster: override.poster || '',
    episodes: override.episodes || ['1.m3u8'],
    source: override.source || 'test',
    source_name: override.source_name || '测试源',
    year: override.year || '2019',
    douban_id: override.douban_id,
    class: override.class,
    type_name: override.type_name,
  };
}

describe('search result ranking', () => {
  it('prioritizes the main TV season over commentary, dubbed, preview, and movie variants', () => {
    const ranked = sortSearchResultsByRanking('鬼灭之刃', [
      makeResult({
        id: 'movie',
        title: '鬼灭之刃 剧场版 无限列车篇',
        episodes: ['1.m3u8'],
        douban_id: 1,
      }),
      makeResult({
        id: 'commentary',
        title: '鬼灭之刃 电影解说',
        episodes: ['1.m3u8'],
      }),
      makeResult({
        id: 'tv',
        title: '鬼灭之刃',
        episodes: Array.from({ length: 26 }, (_, index) => `${index}.m3u8`),
        douban_id: 2,
      }),
      makeResult({
        id: 'dubbed',
        title: '鬼灭之刃 国语版',
        episodes: Array.from({ length: 26 }, (_, index) => `${index}.m3u8`),
      }),
    ]);

    expect(ranked[0].id).toBe('tv');
    expect(ranked.map((item) => item.id).slice(-2)).toEqual([
      'dubbed',
      'commentary',
    ]);
  });

  it('sorts aggregated groups by their strongest main-series signal', () => {
    const tv = [
      makeResult({
        id: 'tv-a',
        title: '鬼灭之刃',
        source: 'a',
        episodes: Array.from({ length: 26 }, (_, index) => `${index}.m3u8`),
      }),
      makeResult({
        id: 'tv-b',
        title: '鬼灭之刃',
        source: 'b',
        episodes: Array.from({ length: 26 }, (_, index) => `${index}.m3u8`),
      }),
    ];
    const movie = [
      makeResult({
        id: 'movie',
        title: '鬼灭之刃 剧场版',
        episodes: ['1.m3u8'],
      }),
    ];

    const groups = sortSearchResultGroupsByRanking('鬼灭之刃', [
      ['movie', movie],
      ['tv', tv],
    ]);

    expect(groups[0][0]).toBe('tv');
  });

  it('suggests AI find when the ordinary result set is crowded or noisy', () => {
    const crowded = Array.from({ length: 31 }, (_, index) =>
      makeResult({ id: `result-${index}`, title: `鬼灭之刃 ${index}` })
    );
    const noisy = Array.from({ length: 12 }, (_, index) =>
      makeResult({
        id: `noisy-${index}`,
        title: index < 5 ? `鬼灭之刃 解说 ${index}` : `鬼灭之刃 ${index}`,
      })
    );

    expect(shouldSuggestAiFind('鬼灭之刃', crowded)).toBe(true);
    expect(shouldSuggestAiFind('鬼灭之刃', noisy)).toBe(true);
  });
});
