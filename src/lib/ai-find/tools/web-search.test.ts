import { webSearchMedia } from './web-search';
import { clearAiFindCache } from '../cache';
import type { AiFindConfig } from '../types';

const baseConfig: AiFindConfig = {
  enabled: true,
  baseUrl: 'https://ai.example/v1',
  apiKey: 'key',
  model: 'model',
  debug: false,
  temperature: 0.2,
  maxToolRounds: 4,
  requestTimeoutMs: 5000,
  maxResults: 5,
  webSearchEnabled: true,
  webSearchProvider: 'generic-http',
  webSearchEndpoint: 'https://search.example.com/query',
  webSearchApiKey: 'search-key',
  dailyLimitPerUser: 20,
  cacheTtlSeconds: 1800,
};

describe('web search media', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    clearAiFindCache();
    jest.restoreAllMocks();
  });

  it('returns an empty list when web search is disabled', async () => {
    const results = await webSearchMedia({
      config: {
        ...baseConfig,
        webSearchEnabled: false,
      },
      query: '隐秘的角落',
      reason: 'verify title',
    });

    expect(results).toEqual([]);
  });

  it('rejects unsupported providers', async () => {
    await expect(
      webSearchMedia({
        config: {
          ...baseConfig,
          webSearchProvider: 'custom-provider',
        },
        query: '隐秘的角落',
        reason: 'verify title',
      })
    ).rejects.toThrow('Unsupported web search provider: custom-provider');
  });

  it('rejects private or localhost endpoints including IPv6 loopback', async () => {
    await expect(
      webSearchMedia({
        config: {
          ...baseConfig,
          webSearchEndpoint: 'http://[::1]/search',
        },
        query: '隐秘的角落',
        reason: 'verify title',
      })
    ).rejects.toThrow('Web search endpoint cannot point to a private host');
  });

  it('normalizes provider results and caches repeated lookups', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            title: '隐秘的角落',
            snippet: '2020 国产悬疑剧',
            url: 'https://example.com/detail',
            source: 'search-provider',
          },
        ],
      }),
    });

    const first = await webSearchMedia({
      config: baseConfig,
      query: '隐秘的角落',
      reason: 'verify title',
    });
    const second = await webSearchMedia({
      config: baseConfig,
      query: '隐秘的角落',
      reason: 'verify title',
    });

    expect(first).toEqual([
      {
        title: '隐秘的角落',
        snippet: '2020 国产悬疑剧',
        url: 'https://example.com/detail',
        source: 'search-provider',
      },
    ]);
    expect(second).toEqual(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
