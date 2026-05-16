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

export interface WebSearchProviderRequest {
  query: string;
  reason: string;
  locale: string;
}

export interface WebSearchProviderAdapter {
  name: string;
  search(input: WebSearchProviderRequest): Promise<WebSearchResult[]>;
}

function normalizeProviderName(provider: string): string {
  const normalized = provider.trim().toLowerCase();

  if (!normalized) return 'none';
  if (
    normalized === 'generic' ||
    normalized === 'generic-http' ||
    normalized === 'http-json'
  ) {
    return 'generic-http';
  }

  return normalized;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return false;
  }

  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second] = parts;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  if (!normalized.includes(':')) {
    return false;
  }

  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  );
}

export function isPrivateHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    isPrivateIpv4(normalized) ||
    isPrivateIpv6(normalized)
  );
}

export function assertPublicEndpoint(endpoint: string): void {
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

function createGenericHttpAdapter(
  config: AiFindConfig
): WebSearchProviderAdapter {
  if (!config.webSearchEndpoint) {
    throw new Error(
      'AI_WEB_SEARCH_ENDPOINT is required when web search is enabled'
    );
  }

  assertPublicEndpoint(config.webSearchEndpoint);

  return {
    name: 'generic-http',
    async search(input: WebSearchProviderRequest): Promise<WebSearchResult[]> {
      const response = await fetch(config.webSearchEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.webSearchApiKey
            ? { Authorization: `Bearer ${config.webSearchApiKey}` }
            : {}),
        },
        body: JSON.stringify({
          query: input.query,
          reason: input.reason,
          locale: input.locale,
        }),
      });

      if (!response.ok) {
        throw new Error(`Web search failed: ${response.status}`);
      }

      const payload = (await response.json()) as GenericWebSearchPayload;
      return normalizeResults(payload);
    },
  };
}

export function getWebSearchProviderAdapter(
  config: AiFindConfig
): WebSearchProviderAdapter {
  const provider = normalizeProviderName(config.webSearchProvider);

  if (provider === 'generic-http') {
    return createGenericHttpAdapter(config);
  }

  throw new Error(
    `Unsupported web search provider: ${config.webSearchProvider || 'none'}`
  );
}
