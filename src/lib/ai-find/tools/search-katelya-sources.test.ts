import type { SearchResult } from '@/lib/types';

import { aggregateSearchResults } from './search-katelya-sources';

function makeResult(
  override: Partial<SearchResult> = {}
): SearchResult {
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
});

