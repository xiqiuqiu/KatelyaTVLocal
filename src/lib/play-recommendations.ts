import type { SearchCategory } from '@/lib/search-category';
import type { DoubanItem } from '@/lib/types';

import type { HomeHeroMediaType } from '@/lib/home-hero';

export type PlayRecommendation = {
  item: DoubanItem;
  type: Exclude<HomeHeroMediaType, ''>;
};

export type PlayRecommendationCategory = Exclude<SearchCategory, 'all'>;

export const CATEGORY_TO_TYPE: Record<
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

/**
 * Ranks Related Recommendation candidates for the play page.
 * Also-liked first, then genre fallback; drops poster-less items; excludes the
 * current title and heavily-watched titles; de-duplicates by Douban id /
 * normalized title; caps at limit. Favorites are never excluded here — the
 * caller must keep them out of `watchedTitles`.
 */
export function selectPlayRecommendations({
  alsoLiked,
  genreFallback,
  excludeTitle,
  watchedTitles = [],
  limit = 12,
}: {
  alsoLiked: DoubanItem[];
  genreFallback: DoubanItem[];
  excludeTitle?: string;
  watchedTitles?: string[];
  limit?: number;
}): DoubanItem[] {
  const excludedNormalized = new Set<string>();
  if (excludeTitle?.trim()) {
    excludedNormalized.add(normalizeTitle(excludeTitle));
  }
  for (const watched of watchedTitles) {
    if (watched?.trim()) {
      excludedNormalized.add(normalizeTitle(watched));
    }
  }

  const selected: DoubanItem[] = [];
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();

  for (const entry of [...alsoLiked, ...genreFallback]) {
    if (selected.length >= limit) break;
    if (!hasPoster(entry)) continue;

    const normalized = normalizeTitle(entry.title);
    if (excludedNormalized.has(normalized)) continue;
    if (entry.id && seenIds.has(entry.id)) continue;
    if (seenTitles.has(normalized)) continue;

    if (entry.id) seenIds.add(entry.id);
    seenTitles.add(normalized);
    selected.push(entry);
  }

  return selected;
}
