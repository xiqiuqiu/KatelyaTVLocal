import {
  buildHomeHeroPlayHref,
  selectHomeHeroCandidate,
} from '@/lib/home-hero';
import type { DoubanItem } from '@/lib/types';

const item = (
  overrides: Partial<DoubanItem> & Pick<DoubanItem, 'id' | 'title'>
): DoubanItem => ({
  poster: 'https://img.example/poster.jpg',
  rate: '8.8',
  year: '2024',
  ...overrides,
});

describe('selectHomeHeroCandidate', () => {
  it('prefers the first movie with a poster from Douban hot lists', () => {
    const result = selectHomeHeroCandidate(
      [
        item({ id: '1', title: '无海报', poster: '  ' }),
        item({ id: '2', title: '庆余年', rate: '9.4' }),
      ],
      [item({ id: '3', title: '剧集候补' })]
    );

    expect(result).toEqual({
      item: item({ id: '2', title: '庆余年', rate: '9.4' }),
      type: 'movie',
    });
  });

  it('falls back to TV then variety when movies lack posters', () => {
    const tv = item({ id: 'tv-1', title: '热门剧集' });
    expect(selectHomeHeroCandidate([], [tv], [])).toEqual({
      item: tv,
      type: 'tv',
    });

    const show = item({ id: 'show-1', title: '热门综艺' });
    expect(selectHomeHeroCandidate([], [], [show])).toEqual({
      item: show,
      type: 'show',
    });
  });

  it('returns null when no Douban poster is available', () => {
    expect(selectHomeHeroCandidate([], [], [])).toBeNull();
    expect(
      selectHomeHeroCandidate([item({ id: '1', title: '空', poster: '' })])
    ).toBeNull();
  });
});

describe('buildHomeHeroPlayHref', () => {
  it('builds the Douban play entry URL from title, year, and type', () => {
    expect(
      buildHomeHeroPlayHref(
        { title: ' 庆余年 ', year: '2024' },
        'movie'
      )
    ).toBe('/play?title=%E5%BA%86%E4%BD%99%E5%B9%B4&year=2024&stype=movie');
  });
});
