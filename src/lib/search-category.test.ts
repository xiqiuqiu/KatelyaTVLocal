import {
  buildSearchCategoryTabs,
  classifySearchResult,
  filterSearchResultsByCategory,
  getSearchCardMeta,
} from '@/lib/search-category';
import type { SearchResult } from '@/lib/types';

const result = (
  overrides: Partial<SearchResult> & Pick<SearchResult, 'id' | 'title'>
): SearchResult => ({
  poster: 'https://img.example/poster.jpg',
  episodes: ['ep1'],
  source: 'demo',
  source_name: '演示源',
  year: '2024',
  ...overrides,
});

describe('classifySearchResult', () => {
  it('classifies from type_name / class keywords before episode count', () => {
    expect(
      classifySearchResult(
        result({
          id: '1',
          title: '某综艺',
          type_name: '综艺',
          episodes: ['1', '2', '3'],
        })
      )
    ).toBe('variety');

    expect(
      classifySearchResult(
        result({
          id: '2',
          title: '某电影',
          class: '动作电影',
          episodes: ['1', '2'],
        })
      )
    ).toBe('movie');

    expect(
      classifySearchResult(
        result({
          id: '3',
          title: '某剧集',
          type_name: '国产剧',
          episodes: ['1'],
        })
      )
    ).toBe('tv');
  });

  it('falls back to episode count when type fields are ambiguous', () => {
    expect(
      classifySearchResult(result({ id: 'm', title: '单集', episodes: ['1'] }))
    ).toBe('movie');
    expect(
      classifySearchResult(
        result({ id: 't', title: '多集', episodes: ['1', '2', '3'] })
      )
    ).toBe('tv');
  });

  it('does not classify from title keywords alone', () => {
    expect(
      classifySearchResult(
        result({
          id: 'named',
          title: '电影解说合集',
          episodes: ['1', '2', '3'],
        })
      )
    ).toBe('tv');
  });
});

describe('buildSearchCategoryTabs / filterSearchResultsByCategory', () => {
  const loaded = [
    result({ id: '1', title: '电影甲', type_name: '电影' }),
    result({ id: '2', title: '剧集乙', type_name: '电视剧', episodes: ['1', '2'] }),
    result({
      id: '3',
      title: '综艺丙',
      class: '真人秀',
      episodes: ['1', '2', '3'],
    }),
    result({ id: '4', title: '电影丁', type_name: '电影' }),
  ];

  it('builds honest tab counts from the already-loaded result set', () => {
    expect(buildSearchCategoryTabs(loaded)).toEqual([
      { value: 'all', label: '全部', count: 4 },
      { value: 'movie', label: '电影', count: 2 },
      { value: 'tv', label: '剧集', count: 1 },
      { value: 'variety', label: '综艺', count: 1 },
    ]);
  });

  it('filters already-loaded results without changing identity', () => {
    expect(filterSearchResultsByCategory(loaded, 'all')).toEqual(loaded);
    expect(filterSearchResultsByCategory(loaded, 'movie').map((r) => r.id)).toEqual(
      ['1', '4']
    );
    expect(filterSearchResultsByCategory(loaded, 'variety').map((r) => r.id)).toEqual(
      ['3']
    );
  });
});

describe('getSearchCardMeta', () => {
  it('surfaces existing type/year/episode cues without inventing fields', () => {
    expect(
      getSearchCardMeta(
        result({
          id: '1',
          title: '庆余年',
          type_name: '国产剧',
          year: '2024',
          episodes: Array.from({ length: 36 }, (_, i) => String(i + 1)),
        })
      )
    ).toEqual({
      typeChip: '国产剧',
      year: '2024',
      statusText: '共36集',
    });

    expect(
      getSearchCardMeta(
        result({
          id: '2',
          title: '单片',
          class: '动作',
          year: '2023',
          episodes: ['1'],
        })
      )
    ).toEqual({
      typeChip: '动作',
      year: '2023',
      statusText: undefined,
    });
  });
});
