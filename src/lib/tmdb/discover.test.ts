import {
  buildDiscoverParams,
  createDefaultFilters,
  hasActiveFilters,
  mapDiscoverItem,
  YEAR_OPTIONS,
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
        yearRange: '2020s',
      },
      3
    );

    expect(params.with_genres).toBe('18,80');
    expect(params['primary_release_date.gte']).toBe('2020-01-01');
    expect(params['primary_release_date.lte']).toBe('2029-12-31');
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

describe('YEAR_OPTIONS', () => {
  it('covers contiguous decades without gaps between 1950 and 2029', () => {
    const ranges = [...YEAR_OPTIONS].sort((a, b) => a.gte.localeCompare(b.gte));
    for (let index = 1; index < ranges.length; index += 1) {
      const previous = Number(ranges[index - 1].lte.slice(0, 4));
      const current = Number(ranges[index].gte.slice(0, 4));
      expect(current).toBe(previous + 1);
    }
  });
});
