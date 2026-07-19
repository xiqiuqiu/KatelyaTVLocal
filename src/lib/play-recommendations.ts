import type { SearchCategory } from '@/lib/search-category';
import type { DoubanItem } from '@/lib/types';

import type { HomeHeroMediaType } from '@/lib/home-hero';

/** Progress ratio at or above this counts as heavily watched. */
export const HEAVILY_WATCHED_PROGRESS = 0.8;

/** Minimal PlayRecord fields needed for heavily-watched exclusion. */
export type HeavilyWatchedPlayRecord = {
  title: string;
  search_title?: string;
  index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
};

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

function recordDisplayTitle(record: HeavilyWatchedPlayRecord): string {
  return record.search_title?.trim() || record.title?.trim() || '';
}

function isHeavilyWatched(record: HeavilyWatchedPlayRecord): boolean {
  if (
    record.total_time > 0 &&
    record.play_time / record.total_time >= HEAVILY_WATCHED_PROGRESS
  ) {
    return true;
  }
  // Reached the final episode of a series — treat as heavily watched even if
  // the last episode's progress ratio is still low.
  return record.total_episodes > 1 && record.index >= record.total_episodes;
}

/**
 * Builds the heavily-watched exclusion titles from PlayRecord history.
 * Favorites are intentionally not consulted — callers must not merge them in.
 */
export function collectHeavilyWatchedTitles(
  records: Record<string, HeavilyWatchedPlayRecord>
): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();

  for (const record of Object.values(records)) {
    if (!isHeavilyWatched(record)) continue;
    const title = recordDisplayTitle(record);
    if (!title) continue;
    const key = normalizeTitle(title);
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }

  return titles;
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
