import { getAvailableApiSites } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import type { SearchResult } from '@/lib/types';

import { rankSearchResultGroupItems } from './rank-playable-results';
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
  return `${normalizeTitle(item.title)}-${
    item.year || 'unknown'
  }-${getSearchResultType(item)}`;
}

function matchesRequestedType(
  item: SearchResult,
  type: 'movie' | 'tv' | 'show' | 'unknown' | undefined
): boolean {
  if (!type || type === 'unknown') return true;
  if (type === 'movie') return getSearchResultType(item) === 'movie';
  return getSearchResultType(item) === 'tv';
}

function matchesRequestedYear(item: SearchResult, year?: string): boolean {
  if (!year) return true;
  return item.year === year;
}

function filterSearchResults(
  results: SearchResult[],
  {
    type,
    year,
  }: {
    type?: 'movie' | 'tv' | 'show' | 'unknown';
    year?: string;
  }
): SearchResult[] {
  return results.filter(
    (item) =>
      matchesRequestedType(item, type) && matchesRequestedYear(item, year)
  );
}

function sortSearchResults(
  query: string,
  results: SearchResult[]
): SearchResult[] {
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
  const results = (
    await Promise.all(
      apiSites.map((site) => searchFromApi(site, normalizedQuery))
    )
  ).flat();
  const sorted = sortSearchResults(normalizedQuery, results).slice(0, limit);

  setAiFindCache(cacheKey, sorted, cacheTtlSeconds);
  return sorted;
}

export async function searchKatelyaSourcesTool({
  query,
  type = 'unknown',
  year,
  limit = 20,
  cacheTtlSeconds = 1800,
}: {
  query: string;
  type?: 'movie' | 'tv' | 'show' | 'unknown';
  year?: string;
  limit?: number;
  cacheTtlSeconds?: number;
}): Promise<
  Array<{
    sourceKey: string;
    sourceName: string;
    id: string;
    title: string;
    year: string;
    type: string;
    poster: string;
    episodeCount: number;
    firstEpisodeUrl: string | null;
  }>
> {
  const rawResults = await searchKatelyaSources({
    query,
    limit: Math.min(Math.max(limit, 1), 30),
    cacheTtlSeconds,
  });

  return filterSearchResults(rawResults, { type, year })
    .slice(0, limit)
    .map((item) => ({
      sourceKey: item.source,
      sourceName: item.source_name,
      id: item.id,
      title: item.title,
      year: item.year || 'unknown',
      type: getSearchResultType(item),
      poster: item.poster,
      episodeCount: item.episodes.length,
      firstEpisodeUrl: item.episodes[0] || null,
    }));
}

export const searchKatelyaSourcesToolSchema = {
  type: 'function' as const,
  function: {
    name: 'search_katelya_sources',
    description:
      'Search KatelyaTV configured sources for a single candidate title or phrase and return compact, searchable source results.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description:
            'The candidate title or phrase to search inside KatelyaTV sources.',
        },
        type: {
          type: 'string',
          enum: ['movie', 'tv', 'show', 'unknown'],
          description: 'Expected media type when known.',
        },
        year: {
          type: 'string',
          description: 'Expected release year when known.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of source results to return.',
        },
      },
      required: ['query'],
    },
  },
};

export async function buildAiFindResultGroup({
  candidate,
  maxGroups,
  cacheTtlSeconds,
  requestOrigin,
  prefer,
}: {
  candidate: AiFindCandidateQuery;
  maxGroups: number;
  cacheTtlSeconds: number;
  requestOrigin?: string;
  prefer?: 'stable' | 'fast' | 'quality';
}): Promise<AiFindResultGroup> {
  const rawResults = await searchKatelyaSources({
    query: candidate.query,
    limit: 30,
    cacheTtlSeconds,
  });
  const aggregatedGroups = aggregateSearchResults(
    candidate.query,
    rawResults
  ).slice(0, maxGroups);
  const groups = requestOrigin
    ? await Promise.all(
        aggregatedGroups.map(async (group) => {
          const rankedGroup = await rankSearchResultGroupItems({
            items: group.items,
            origin: requestOrigin,
            prefer,
          });

          return {
            ...group,
            items: rankedGroup.items,
            playbackHint: rankedGroup.playbackHint,
          };
        })
      )
    : aggregatedGroups;

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
