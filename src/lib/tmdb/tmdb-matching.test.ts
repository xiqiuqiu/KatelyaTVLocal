import { isAllowedTmdbPath, sanitizeTmdbParams } from '@/lib/tmdb/endpoints';
import {
  buildTmdbImageUrl,
  normalizeTmdbTitle,
  pickTmdbMatch,
  toTmdbMatchInput,
} from '@/lib/tmdb/matching';

describe('normalizeTmdbTitle', () => {
  it('drops punctuation, bracketed notes and season suffixes', () => {
    expect(normalizeTmdbTitle('我的有罪之人（2026）')).toBe('我的有罪之人');
    expect(normalizeTmdbTitle("Clarkson's Farm: Season 5")).toBe(
      'clarksonsfarm'
    );
    expect(normalizeTmdbTitle('庆余年 第二季')).toBe('庆余年');
  });
});

describe('pickTmdbMatch', () => {
  it('accepts an exact title with a matching year', () => {
    const match = pickTmdbMatch({ title: '悲惨世界', year: '2026' }, [
      {
        id: 1,
        title: '悲惨世界',
        release_date: '2026-03-01',
        vote_average: 8.1,
      },
    ]);

    expect(match?.result.id).toBe(1);
    expect(match?.confidence).toBe(1);
    expect(match?.year).toBe(2026);
  });

  it('tolerates a one year gap but scores it lower', () => {
    const match = pickTmdbMatch({ title: '悲惨世界', year: '2026' }, [
      { id: 2, title: '悲惨世界', release_date: '2025-11-01' },
    ]);

    expect(match?.result.id).toBe(2);
    expect(match?.confidence).toBeCloseTo(0.85, 5);
  });

  it('rejects results whose year is far off, and prefers the closest title', () => {
    const rejected = pickTmdbMatch({ title: '射雕英雄传', year: '2024' }, [
      { id: 3, title: '射雕英雄传', release_date: '1983-01-01' },
    ]);
    expect(rejected).toBeNull();

    const best = pickTmdbMatch({ title: '射雕英雄传', year: '2024' }, [
      { id: 4, title: '射雕英雄传之东成西就', release_date: '2024-01-05' },
      { id: 5, title: '射雕英雄传', release_date: '2024-02-01' },
    ]);
    expect(best?.result.id).toBe(5);
    expect(best?.confidence).toBe(1);
  });

  it('matches on the original title when the localized title differs', () => {
    const match = pickTmdbMatch(
      { title: '寄生虫', year: '2019', kind: 'movie' },
      [
        {
          id: 6,
          title: 'Parasite',
          original_title: '기생충',
          release_date: '2019-05-30',
        },
      ]
    );
    expect(match).toBeNull();

    const viaOriginal = pickTmdbMatch({ title: '기생충', year: '2019' }, [
      {
        id: 6,
        title: 'Parasite',
        original_title: '기생충',
        release_date: '2019-05-30',
      },
    ]);
    expect(viaOriginal?.result.id).toBe(6);
  });

  it('returns null for empty input', () => {
    expect(pickTmdbMatch({ title: '' }, [{ id: 1, title: 'x' }])).toBeNull();
    expect(pickTmdbMatch({ title: 'x' }, [])).toBeNull();
  });
});

describe('buildTmdbImageUrl', () => {
  it('builds sized image urls and tolerates missing paths', () => {
    expect(buildTmdbImageUrl('/abc.jpg', 'w780')).toBe(
      'https://image.tmdb.org/t/p/w780/abc.jpg'
    );
    expect(buildTmdbImageUrl('abc.jpg')).toBe(
      'https://image.tmdb.org/t/p/w780/abc.jpg'
    );
    expect(buildTmdbImageUrl(null)).toBe('');
  });
});

describe('toTmdbMatchInput', () => {
  it('maps a douban item to match input', () => {
    expect(toTmdbMatchInput({ title: '庆余年', year: '2019' }, 'tv')).toEqual({
      title: '庆余年',
      year: '2019',
      kind: 'tv',
    });
  });
});

describe('tmdb endpoint allowlist', () => {
  it('allows the endpoints we actually use', () => {
    for (const path of [
      'search/movie',
      'search/tv',
      'movie/12345',
      'tv/12345',
      'movie/12345/recommendations',
      'tv/123/season/2',
      'trending/movie/week',
      'discover/tv',
      'genre/movie/list',
    ]) {
      expect(isAllowedTmdbPath(path)).toBe(true);
    }
  });

  it('blocks everything else so the proxy is not an open gateway', () => {
    for (const path of [
      '',
      'account',
      'movie/abc',
      'configuration',
      'trending/movie/month',
      'movie/12345/../../account',
    ]) {
      expect(isAllowedTmdbPath(path)).toBe(false);
    }
  });

  it('keeps the discover-only parameters we rely on', () => {
    const params = sanitizeTmdbParams(
      new URLSearchParams(
        'with_genres=16&with_keywords=9914&vote_count.gte=200&with_origin_country=JP'
      )
    );
    expect(params.get('with_genres')).toBe('16');
    expect(params.get('with_keywords')).toBe('9914');
    expect(params.get('vote_count.gte')).toBe('200');
  });

  it('drops unknown query parameters', () => {
    const params = sanitizeTmdbParams(
      new URLSearchParams('query=庆余年&year=2019&api_key=leak&evil=1')
    );
    expect(params.get('query')).toBe('庆余年');
    expect(params.get('year')).toBe('2019');
    expect(params.get('api_key')).toBeNull();
    expect(params.get('evil')).toBeNull();
  });
});
