import { buildTopRated, getTopRatedKey } from '@/lib/top-rated';
import type { DoubanItem } from '@/lib/types';

function item(title: string, rate: string, poster = 'p.jpg'): DoubanItem {
  return { id: title, title, rate, poster, year: '2026' };
}

describe('buildTopRated', () => {
  it('merges all three lists and ranks by douban rating', () => {
    const result = buildTopRated({
      movies: [item('电影甲', '8.1'), item('电影乙', '9.2')],
      tvShows: [item('剧集甲', '8.8')],
      varietyShows: [item('综艺甲', '7.4')],
    });

    expect(result.map((entry) => [entry.rank, entry.item.title])).toEqual([
      [1, '电影乙'],
      [2, '剧集甲'],
      [3, '电影甲'],
      [4, '综艺甲'],
    ]);
    expect(result[0].type).toBe('movie');
    expect(result[1].type).toBe('tv');
    expect(result[3].type).toBe('show');
  });

  it('drops duplicates across lists, entries without poster and entries without rating', () => {
    const result = buildTopRated({
      movies: [
        item('重复片', '9.0'),
        item('无海报', '9.5', ''),
        item('无评分', ''),
      ],
      tvShows: [item('重复片', '9.0')],
    });

    expect(result.map((entry) => entry.item.title)).toEqual(['重复片']);
  });

  it('caps the list at the requested limit', () => {
    const movies = Array.from({ length: 14 }, (_, index) =>
      item(`影片${index}`, String(9.5 - index * 0.1))
    );

    const result = buildTopRated({ movies, limit: 10 });

    expect(result).toHaveLength(10);
    expect(result[9].rank).toBe(10);
  });

  it('exposes a stable key per entry', () => {
    const [entry] = buildTopRated({ movies: [item('单片', '8.0')] });

    expect(getTopRatedKey(entry)).toBe('movie:单片');
  });
});
