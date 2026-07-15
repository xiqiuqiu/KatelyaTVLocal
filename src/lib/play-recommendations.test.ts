import type { DoubanItem } from '@/lib/types';

import { selectPlayRecommendations } from '@/lib/play-recommendations';

const item = (
  overrides: Partial<DoubanItem> & Pick<DoubanItem, 'id' | 'title'>
): DoubanItem => ({
  poster: `https://img.example/${overrides.id}.jpg`,
  rate: '8.0',
  year: '2024',
  ...overrides,
});

describe('selectPlayRecommendations', () => {
  it('prefers the matching Douban pool and excludes the current title', () => {
    const result = selectPlayRecommendations({
      excludeTitle: '当前播放',
      preferCategory: 'tv',
      movies: [item({ id: 'm1', title: '热门电影' })],
      tvShows: [
        item({ id: 't0', title: '当前播放' }),
        item({ id: 't1', title: '热门剧集甲' }),
        item({ id: 't2', title: '热门剧集乙' }),
      ],
      varietyShows: [item({ id: 'v1', title: '热门综艺' })],
      limit: 3,
    });

    expect(result.map((entry) => entry.item.title)).toEqual([
      '热门剧集甲',
      '热门剧集乙',
      '热门电影',
    ]);
    expect(result.map((entry) => entry.type)).toEqual(['tv', 'tv', 'movie']);
  });

  it('skips items without posters and does not reuse same-title sources as recommendations', () => {
    const result = selectPlayRecommendations({
      excludeTitle: '庆余年',
      preferCategory: 'movie',
      movies: [
        item({
          id: 'm0',
          title: '庆余年',
          poster: 'https://img.example/m0.jpg',
        }),
        item({ id: 'm1', title: '无封面', poster: '  ' }),
        item({ id: 'm2', title: '有封面电影' }),
      ],
      tvShows: [],
      varietyShows: [],
    });

    expect(result).toEqual([
      {
        item: expect.objectContaining({ id: 'm2', title: '有封面电影' }),
        type: 'movie',
      },
    ]);
  });
});
