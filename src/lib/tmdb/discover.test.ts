import {
  buildDiscoverParams,
  buildYearOptions,
  createDefaultFilters,
  hasActiveFilters,
  mapDiscoverItem,
} from '@/lib/tmdb/discover';

describe('buildDiscoverParams', () => {
  it('sends only the essentials by default', () => {
    const params = buildDiscoverParams(createDefaultFilters('movie'), 1);

    expect(params).toEqual({
      page: '1',
      sort_by: 'popularity.desc',
      language: 'zh-CN',
    });
  });

  it('joins multiple genres and uses release date ranges for movies', () => {
    const params = buildDiscoverParams(
      {
        ...createDefaultFilters('movie'),
        genres: [18, 80],
        yearRange: '2010s',
      },
      3
    );

    expect(params.with_genres).toBe('18,80');
    expect(params['primary_release_date.gte']).toBe('2010-01-01');
    expect(params['primary_release_date.lte']).toBe('2019-12-31');
    expect(params.page).toBe('3');
    expect(params.year).toBeUndefined();
  });

  it('uses first air date keys for tv and adds a vote count floor with rating', () => {
    const params = buildDiscoverParams(
      {
        ...createDefaultFilters('tv'),
        yearRange: '2010s',
        minRating: 8,
        language: 'ko',
      },
      1
    );

    expect(params['first_air_date.gte']).toBe('2010-01-01');
    expect(params['first_air_date.lte']).toBe('2019-12-31');
    expect(params['primary_release_date.gte']).toBeUndefined();
    // 评分排序/筛选必须带票数下限，避免冷门刷分
    expect(params['vote_average.gte']).toBe('8');
    expect(params['vote_count.gte']).toBe('200');
    expect(params.with_original_language).toBe('ko');
  });

  it('clamps page to a positive integer', () => {
    expect(buildDiscoverParams(createDefaultFilters(), 0).page).toBe('1');
    expect(buildDiscoverParams(createDefaultFilters(), -5).page).toBe('1');
  });
});

describe('mapDiscoverItem', () => {
  it('normalizes movie fields', () => {
    expect(
      mapDiscoverItem({
        id: 693134,
        title: '沙丘2',
        release_date: '2024-02-27',
        vote_average: 8.168,
        poster_path: '/abc.jpg',
      })
    ).toEqual({
      id: '693134',
      title: '沙丘2',
      year: '2024',
      rate: '8.2',
      posterPath: '/abc.jpg',
      originalTitle: '',
    });
  });

  it('normalizes tv fields and tolerates missing rating or date', () => {
    expect(
      mapDiscoverItem({ id: 1396, name: '绝命毒师', first_air_date: '' })
    ).toEqual({
      id: '1396',
      title: '绝命毒师',
      year: '',
      rate: '',
      posterPath: '',
      originalTitle: '',
    });
  });
});

it('keeps the original title when it differs from the localized one', () => {
  expect(
    mapDiscoverItem({
      id: 1399,
      name: '权力的游戏',
      original_name: 'Game of Thrones',
      first_air_date: '2011-04-17',
    }).originalTitle
  ).toBe('Game of Thrones');
});

describe('hasActiveFilters', () => {
  it('is false for defaults and true once anything changes', () => {
    expect(hasActiveFilters(createDefaultFilters('movie'))).toBe(false);
    expect(
      hasActiveFilters({ ...createDefaultFilters('movie'), genres: [18] })
    ).toBe(true);
    expect(
      hasActiveFilters({ ...createDefaultFilters('movie'), minRating: 8 })
    ).toBe(true);
    expect(
      hasActiveFilters({
        ...createDefaultFilters('movie'),
        sortBy: 'vote_average.desc',
      })
    ).toBe(true);
  });
});

describe('buildYearOptions', () => {
  it('derives this year / last year from the reference year', () => {
    const options = buildYearOptions(2026);
    const byKey = Object.fromEntries(
      options.map((option) => [option.key, option])
    );

    expect(byKey['this-year'].gte).toBe('2026-01-01');
    expect(byKey['this-year'].lte).toBe('2026-12-31');
    expect(byKey['last-year'].gte).toBe('2025-01-01');
    expect(byKey.recent.label).toBe('2020–2024');
    expect(byKey.recent.gte).toBe('2020-01-01');
    expect(byKey.recent.lte).toBe('2024-12-31');
  });

  it('keeps decades contiguous from 1980 to 2019 without overlaps', () => {
    const options = buildYearOptions(2026).filter((option) =>
      ['2010s', '2000s', '1990s', '1980s'].includes(option.key)
    );
    for (const option of options) {
      const start = Number(option.gte.slice(0, 4));
      const end = Number(option.lte.slice(0, 4));
      expect(end - start).toBe(9);
    }
    for (let index = 1; index < options.length; index += 1) {
      const previousStart = Number(options[index - 1].gte.slice(0, 4));
      const currentStart = Number(options[index].gte.slice(0, 4));
      // 相邻年代正好相差 10 年，不重叠也不留缝
      expect(previousStart - currentStart).toBe(10);
    }
  });

  it('drops the 2020 decade bucket early in the decade', () => {
    const keys = buildYearOptions(2021).map((option) => option.key);
    expect(keys).not.toContain('recent');
  });
});
