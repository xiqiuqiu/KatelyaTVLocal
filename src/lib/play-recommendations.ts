import type { SearchCategory } from '@/lib/search-category';
import type { DoubanItem } from '@/lib/types';

import type { HomeHeroMediaType } from '@/lib/home-hero';

export type PlayRecommendation = {
  item: DoubanItem;
  type: Exclude<HomeHeroMediaType, ''>;
};

export type PlayRecommendationCategory = Exclude<SearchCategory, 'all'>;

const CATEGORY_TO_TYPE: Record<
  PlayRecommendationCategory,
  Exclude<HomeHeroMediaType, ''>
> = {
  movie: 'movie',
  tv: 'tv',
  variety: 'show',
};

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/[·・:：\-_[\]【】()（）]/g, '');
}

function hasPoster(item: DoubanItem): boolean {
  return Boolean(item.poster?.trim());
}

function isExcludedTitle(item: DoubanItem, excludeTitle?: string): boolean {
  if (!excludeTitle?.trim()) return false;
  return normalizeTitle(item.title) === normalizeTitle(excludeTitle);
}

/**
 * Builds a “猜你喜欢” row from already-fetched Douban hot lists.
 * Prefers the current title’s category pool, then fills from the others.
 * Excludes the playing title and poster-less items — never the same-title source list.
 */
export function selectPlayRecommendations({
  excludeTitle,
  preferCategory = 'movie',
  movies,
  tvShows,
  varietyShows,
  limit = 12,
}: {
  excludeTitle?: string;
  preferCategory?: PlayRecommendationCategory;
  movies: DoubanItem[];
  tvShows: DoubanItem[];
  varietyShows: DoubanItem[];
  limit?: number;
}): PlayRecommendation[] {
  const pools: Array<{
    items: DoubanItem[];
    type: Exclude<HomeHeroMediaType, ''>;
    category: PlayRecommendationCategory;
  }> = [
    { items: movies, type: 'movie', category: 'movie' },
    { items: tvShows, type: 'tv', category: 'tv' },
    { items: varietyShows, type: 'show', category: 'variety' },
  ];

  const preferredType = CATEGORY_TO_TYPE[preferCategory];
  const ordered = [
    ...pools.filter((pool) => pool.type === preferredType),
    ...pools.filter((pool) => pool.type !== preferredType),
  ];

  const selected: PlayRecommendation[] = [];
  const seen = new Set<string>();

  for (const pool of ordered) {
    for (const entry of pool.items) {
      if (selected.length >= limit) return selected;
      if (!hasPoster(entry) || isExcludedTitle(entry, excludeTitle)) continue;
      const key = entry.id || normalizeTitle(entry.title);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push({ item: entry, type: pool.type });
    }
  }

  return selected;
}
