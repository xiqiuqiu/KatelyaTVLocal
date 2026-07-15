import type { DoubanItem } from '@/lib/types';

export type HomeHeroMediaType = 'movie' | 'tv' | 'show' | '';

export interface HomeHeroCandidate {
  item: DoubanItem;
  type: HomeHeroMediaType;
}

/**
 * Picks the Design Direction Hero from already-fetched Douban hot lists.
 * Prefers movies, then TV, then variety — first item with a poster wins.
 */
export function selectHomeHeroCandidate(
  movies: DoubanItem[],
  tvShows: DoubanItem[] = [],
  varietyShows: DoubanItem[] = []
): HomeHeroCandidate | null {
  const pools: Array<{ items: DoubanItem[]; type: HomeHeroMediaType }> = [
    { items: movies, type: 'movie' },
    { items: tvShows, type: 'tv' },
    { items: varietyShows, type: 'show' },
  ];

  for (const pool of pools) {
    const item = pool.items.find((entry) => Boolean(entry.poster?.trim()));
    if (item) {
      return { item, type: pool.type };
    }
  }

  return null;
}

/** Same play entry as Douban VideoCard: title search into /play. */
export function buildHomeHeroPlayHref(
  item: Pick<DoubanItem, 'title' | 'year'>,
  type: HomeHeroMediaType = ''
): string {
  const params = new URLSearchParams();
  params.set('title', item.title.trim());
  if (item.year) params.set('year', item.year);
  if (type) params.set('stype', type);
  return `/play?${params.toString()}`;
}
