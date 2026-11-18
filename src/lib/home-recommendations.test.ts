import {
  buildHomeRecommendations,
  getHomeRecommendationKey,
} from '@/lib/home-recommendations';
import type { DoubanItem } from '@/lib/types';

function movie(id: string, title: string, rate: string, poster = 'p.jpg') {
  return { id, title, rate, poster, year: '2026' } as DoubanItem;
}

describe('buildHomeRecommendations', () => {
  it('ranks by rating without personal signals', () => {
    const result = buildHomeRecommendations({
      movies: [
        movie('1', '低分片', '6.2'),
        movie('2', '高分片', '9.1'),
        movie('3', '中分片', '7.8'),
      ],
    });

    expect(result.map((entry) => entry.item.title)).toEqual([
      '高分片',
      '中分片',
      '低分片',
    ]);
    expect(result[0].reason).toBe('本周口碑高分');
    expect(result[2].reason).toBe('本周电影热榜');
  });

  it('boosts the media type the viewer keeps watching', () => {
    const result = buildHomeRecommendations({
      movies: [movie('1', '热门电影', '8.4')],
      tvShows: [movie('2', '热门剧集', '8.4')],
      playRecords: [
        { title: '已看剧集 A', episodes: 24 },
        { title: '已看剧集 B', episodes: 12 },
        { title: '已看剧集 C', episodes: 36 },
      ],
    });

    expect(result[0].item.title).toBe('热门剧集');
    expect(result[0].reason).toBe('你常看剧集 · 优先推荐');
    expect(result[1].reason).toBe('本周电影热榜');
  });

  it('never recommends what the viewer already watched or favorited', () => {
    const result = buildHomeRecommendations({
      movies: [movie('1', '看过了', '9.5'), movie('2', '没看过', '7.0')],
      tvShows: [movie('3', '收藏过', '9.0')],
      playRecords: [{ title: '看过了', episodes: 1 }],
      favorites: [{ title: '收藏过', episodes: 24 }],
    });

    expect(result.map((entry) => entry.item.title)).toEqual(['没看过']);
  });

  it('caps one media type at three entries so the hero still varies', () => {
    const result = buildHomeRecommendations({
      movies: [
        movie('1', '电影一', '9.6'),
        movie('2', '电影二', '9.5'),
        movie('3', '电影三', '9.4'),
        movie('4', '电影四', '9.3'),
      ],
      tvShows: [
        movie('5', '剧集一', '9.2'),
        movie('6', '剧集二', '9.1'),
        movie('7', '剧集三', '9.0'),
      ],
      limit: 5,
    });

    const titles = result.map((entry) => entry.item.title);
    expect(titles).toHaveLength(5);
    expect(titles.filter((title) => title.startsWith('电影'))).toHaveLength(3);
    expect(titles.filter((title) => title.startsWith('剧集'))).toHaveLength(2);
  });

  it('skips entries without a poster and returns an empty list when nothing is usable', () => {
    expect(
      buildHomeRecommendations({
        movies: [movie('1', '无海报', '9.9', ''), movie('2', '有海报', '7.2')],
      }).map((entry) => entry.item.title)
    ).toEqual(['有海报']);

    expect(buildHomeRecommendations({ movies: [] })).toEqual([]);
  });

  it('exposes a stable key per recommendation', () => {
    const [recommendation] = buildHomeRecommendations({
      movies: [movie('id-9', '有海报', '8.0')],
    });

    expect(getHomeRecommendationKey(recommendation)).toBe('movie:id-9');
  });
});
