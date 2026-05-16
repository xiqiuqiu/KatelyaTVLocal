import { getAvailableApiSites } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import type { SearchResult } from '@/lib/types';

import { getAiFindCache, setAiFindCache } from '../cache';
import type {
  AiFindAggregatedResult,
  AiFindCandidateQuery,
  AiFindResultGroup,
} from '../types';

function normalizeTitle(title: string): string {
  return title.replaceAll(' ', '').trim();
}

function getSearchResultType(item: SearchResult): string {
  return item.episodes.length === 1 ? 'movie' : 'tv';
}

function getAggregateKey(item: SearchResult): string {
  return `${normalizeTitle(item.title)}-${item.year || 'unknown'}-${getSearchResultType(item)}`;
}

function sortSearchResults(query: string, results: SearchResult[]): SearchResult[] {
  const normalizedQuery = normalizeTitle(query);

  return [...results].sort((a, b) => {
    const aTitle = normalizeTitle(a.title);
    const bTitle = normalizeTitle(b.title);
    const aExactMatch = aTitle.includes(normalizedQuery);
    const bExactMatch = bTitle.includes(normalizedQuery);

    if (aExactMatch && !bExactMatch) return -1;
    if (!aExactMatch && bExactMatch) return 1;

    if (a.year === b.year) {
      return a.title.localeCompare(b.title);
    }

    if (a.year === 'unknown') return 1;
    if (b.year === 'unknown') return -1;

    return parseInt(a.year) > parseInt(b.year) ? -1 : 1;
  });
}

export function aggregateSearchResults(
  query: string,
  results: SearchResult[]
): AiFindAggregatedResult[] {
  const map = new Map<string, SearchResult[]>();

  sortSearchResults(query, results).forEach((item) => {
    const key = getAggregateKey(item);
    const group = map.get(key) || [];
    group.push(item);
    map.set(key, group);
  });

  return Array.from(map.entries()).map(([groupKey, items]) => ({
    groupKey,
    title: items[0].title,
    year: items[0].year || 'unknown',
    type: getSearchResultType(items[0]),
    poster: items[0].poster,
    items,
    playbackHint: 'unknown',
  }));
}

export async function searchKatelyaSources({
  query,
  limit = 30,
  cacheTtlSeconds = 1800,
}: {
  query: string;
  limit?: number;
  cacheTtlSeconds?: number;
}): Promise<SearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const cacheKey = `ai-find:search:${normalizedQuery}:${limit}`;
  const cached = getAiFindCache<SearchResult[]>(cacheKey);
  if (cached) return cached;

  const apiSites = await getAvailableApiSites();
  const results = (await Promise.all(
    apiSites.map((site) => searchFromApi(site, normalizedQuery))
  )).flat();
  const sorted = sortSearchResults(normalizedQuery, results).slice(0, limit);

  setAiFindCache(cacheKey, sorted, cacheTtlSeconds);
  return sorted;
}

export async function buildAiFindResultGroup({
  candidate,
  maxGroups,
  cacheTtlSeconds,
}: {
  candidate: AiFindCandidateQuery;
  maxGroups: number;
  cacheTtlSeconds: number;
}): Promise<AiFindResultGroup> {
  const rawResults = await searchKatelyaSources({
    query: candidate.query,
    limit: 30,
    cacheTtlSeconds,
  });
  const groups = aggregateSearchResults(candidate.query, rawResults).slice(
    0,
    maxGroups
  );

  return {
    query: candidate.query,
    reason: candidate.reason,
    confidence: candidate.confidence,
    rawCount: rawResults.length,
    groupedCount: groups.length,
    groups,
    notFound: groups.length === 0,
  };
}

