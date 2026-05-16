import { getWebSearchProviderAdapter } from './web-search-providers';
import { getAiFindCache, setAiFindCache } from '../cache';
import type { AiFindConfig, WebSearchResult } from '../types';

function buildWebSearchCacheKey({
  provider,
  endpoint,
  query,
  reason,
  locale,
}: {
  provider: string;
  endpoint: string;
  query: string;
  reason: string;
  locale: string;
}): string {
  return ['ai-find:web-search', provider, endpoint, query, reason, locale].join(
    ':'
  );
}

export async function webSearchMedia({
  config,
  query,
  reason,
  locale = 'zh-CN',
}: {
  config: AiFindConfig;
  query: string;
  reason: string;
  locale?: string;
}): Promise<WebSearchResult[]> {
  if (!config.webSearchEnabled) {
    return [];
  }

  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const normalizedReason = reason.trim();
  const normalizedLocale = locale.trim() || 'zh-CN';
  const provider = getWebSearchProviderAdapter(config);
  const cacheKey = buildWebSearchCacheKey({
    provider: provider.name,
    endpoint: config.webSearchEndpoint,
    query: normalizedQuery,
    reason: normalizedReason,
    locale: normalizedLocale,
  });
  const cached = getAiFindCache<WebSearchResult[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const results = await provider.search({
    query: normalizedQuery,
    reason: normalizedReason,
    locale: normalizedLocale,
  });
  setAiFindCache(cacheKey, results, config.cacheTtlSeconds);

  return results;
}

export const webSearchMediaToolSchema = {
  type: 'function' as const,
  function: {
    name: 'web_search_media',
    description:
      'Search the web to verify movie, TV, show title, year, alias, actor, or fresh-release facts.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'The media-related search query.',
        },
        reason: {
          type: 'string',
          description: 'Why web verification is needed.',
        },
        locale: {
          type: 'string',
          description: 'Preferred locale for search results.',
        },
      },
      required: ['query', 'reason'],
    },
  },
};
