import type { AiFindConfig, WebSearchResult } from '../types';

interface GenericWebSearchPayload {
  results?: Array<Partial<WebSearchResult>>;
  items?: Array<Partial<WebSearchResult>>;
  webPages?: {
    value?: Array<{
      name?: string;
      snippet?: string;
      url?: string;
    }>;
  };
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function assertPublicEndpoint(endpoint: string): void {
  const url = new URL(endpoint);
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('Web search endpoint must be HTTP or HTTPS');
  }

  if (isPrivateHost(url.hostname)) {
    throw new Error('Web search endpoint cannot point to a private host');
  }
}

function normalizeResults(payload: GenericWebSearchPayload): WebSearchResult[] {
  const rawResults =
    payload.results ||
    payload.items ||
    payload.webPages?.value?.map((item) => ({
      title: item.name || '',
      snippet: item.snippet || '',
      url: item.url || '',
      source: undefined,
    })) ||
    [];

  return rawResults
    .map((item) => ({
      title: item.title || '',
      snippet: item.snippet || '',
      url: item.url || '',
      source: item.source,
    }))
    .filter((item) => item.title && item.url)
    .slice(0, 5);
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

  if (!config.webSearchEndpoint) {
    throw new Error('AI_WEB_SEARCH_ENDPOINT is required when web search is enabled');
  }

  assertPublicEndpoint(config.webSearchEndpoint);

  const response = await fetch(config.webSearchEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.webSearchApiKey
        ? { Authorization: `Bearer ${config.webSearchApiKey}` }
        : {}),
    },
    body: JSON.stringify({
      query,
      reason,
      locale,
    }),
  });

  if (!response.ok) {
    throw new Error(`Web search failed: ${response.status}`);
  }

  const payload = (await response.json()) as GenericWebSearchPayload;
  return normalizeResults(payload);
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
