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
  it('orders also-liked before genre fallback', () => {
    const result = selectPlayRecommendations({
      alsoLiked: [item({ id: 'a1', title: '也喜欢甲' })],
      genreFallback: [item({ id: 'g1', title: '同题材乙' })],
    });

    expect(result.map((entry) => entry.title)).toEqual(['也喜欢甲', '同题材乙']);
  });

  it('excludes the current title by normalized match', () => {
    const result = selectPlayRecommendations({
      alsoLiked: [
        item({ id: 'a0', title: '庆余年' }),
        item({ id: 'a1', title: '也喜欢甲' }),
      ],
      genreFallback: [item({ id: 'g1', title: '庆 余 年' })],
      excludeTitle: '庆余年',
    });

    expect(result.map((entry) => entry.title)).toEqual(['也喜欢甲']);
  });

  it('excludes heavily-watched titles', () => {
    const result = selectPlayRecommendations({
      alsoLiked: [
        item({ id: 'a1', title: '已看完的剧' }),
        item({ id: 'a2', title: '新推荐' }),
      ],
      genreFallback: [],
      watchedTitles: ['已看完的剧'],
    });

    expect(result.map((entry) => entry.title)).toEqual(['新推荐']);
  });

  it('does not exclude favorites (caller keeps them out of watchedTitles)', () => {
    const result = selectPlayRecommendations({
      alsoLiked: [item({ id: 'a1', title: '想重看的收藏' })],
      genreFallback: [item({ id: 'g1', title: '同题材' })],
      // Favorites must not be placed in watchedTitles by the caller.
      watchedTitles: ['已看完的无关剧'],
    });

    expect(result.map((entry) => entry.title)).toEqual([
      '想重看的收藏',
      '同题材',
    ]);
  });

  it('drops poster-less items', () => {
    const result = selectPlayRecommendations({
      alsoLiked: [
        item({ id: 'a1', title: '无封面', poster: '  ' }),
        item({ id: 'a2', title: '有封面' }),
      ],
      genreFallback: [],
    });

    expect(result.map((entry) => entry.title)).toEqual(['有封面']);
  });

  it('de-duplicates across tiers by Douban id and normalized title', () => {
    const result = selectPlayRecommendations({
      alsoLiked: [item({ id: 'same', title: '重复片' })],
      genreFallback: [
        item({ id: 'same', title: '重复片（别名）' }),
        item({ id: 'g2', title: '重 复 片' }),
        item({ id: 'g3', title: '另一部' }),
      ],
    });

    expect(result.map((entry) => entry.title)).toEqual(['重复片', '另一部']);
  });

  it('respects limit while preserving relevance-first order', () => {
    const result = selectPlayRecommendations({
      alsoLiked: [
        item({ id: 'a1', title: '也喜欢1' }),
        item({ id: 'a2', title: '也喜欢2' }),
      ],
      genreFallback: [
        item({ id: 'g1', title: '题材1' }),
        item({ id: 'g2', title: '题材2' }),
      ],
      limit: 3,
    });

    expect(result.map((entry) => entry.title)).toEqual([
      '也喜欢1',
      '也喜欢2',
      '题材1',
    ]);
  });

  it('returns empty output for empty input', () => {
    expect(
      selectPlayRecommendations({
        alsoLiked: [],
        genreFallback: [],
      })
    ).toEqual([]);
  });
});
