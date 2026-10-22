import { fetchSourcePreferencesInBatches } from './source-preference-client';

describe('source preference client batching', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('splits large source preference requests and returns a merged order', async () => {
    const requests: unknown[] = [];
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      const body = JSON.parse(String(init?.body)) as {
        sources: Array<{ sourceKey: string }>;
      };

      return {
        ok: true,
        status: 200,
        json: async () => ({
          orderedSourceKeys: body.sources
            .map((source) => source.sourceKey)
            .reverse(),
          results: body.sources.map((source, index) => ({
            sourceKey: source.sourceKey,
            kind: index % 2 === 0 ? 'direct' : 'proxy',
            reason: 'batched',
            probeTimeMs: 100 + index,
            rankingSource: 'live',
          })),
          generatedAt: 1710000000000,
          rankingSource: 'live',
          confidence: 'low',
        }),
      };
    });

    const sources = Array.from({ length: 45 }, (_, index) => ({
      sourceKey: `source-${index}`,
      episodeUrl: `https://example.com/${index}.m3u8`,
    }));

    const response = await fetchSourcePreferencesInBatches(sources, {
      fetcher: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(
      requests.map(
        (request) => (request as { sources: unknown[] }).sources.length
      )
    ).toEqual([6, 6, 6, 6, 6, 6, 6, 3]);
    expect(response.results).toHaveLength(45);
    expect(response.orderedSourceKeys).toEqual(
      response.results.map((result) => result.sourceKey)
    );
    expect(response.rankingSource).toBe('live');
  });

  it('keeps later batches when one batch fails', async () => {
    let call = 0;
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      call += 1;
      const body = JSON.parse(String(init?.body)) as {
        sources: Array<{ sourceKey: string }>;
      };
      if (call === 1) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          orderedSourceKeys: body.sources.map((source) => source.sourceKey),
          results: body.sources.map((source) => ({
            sourceKey: source.sourceKey,
            kind: 'direct',
            reason: 'ok',
            rankingSource: 'live',
          })),
          generatedAt: 1710000000000,
          rankingSource: 'live',
          confidence: 'low',
        }),
      };
    });
    const sources = Array.from({ length: 4 }, (_, index) => ({
      sourceKey: `source-${index}`,
      episodeUrl: `https://example.com/${index}.m3u8`,
    }));

    const response = await fetchSourcePreferencesInBatches(sources, {
      fetcher: fetchMock as unknown as typeof fetch,
      batchSize: 2,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.results.map((result) => result.sourceKey)).toEqual([
      'source-2',
      'source-3',
    ]);
  });

  it('passes the live fallback preference to every batch request', async () => {
    const requests: unknown[] = [];
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));

      return {
        ok: true,
        status: 200,
        json: async () => ({
          orderedSourceKeys: [],
          results: [],
          generatedAt: 1710000000000,
          rankingSource: 'd1',
          confidence: 'medium',
        }),
      };
    });

    const sources = Array.from({ length: 3 }, (_, index) => ({
      sourceKey: `source-${index}`,
      episodeUrl: `https://example.com/${index}.m3u8`,
    }));

    await fetchSourcePreferencesInBatches(sources, {
      fetcher: fetchMock as unknown as typeof fetch,
      batchSize: 2,
      allowLiveProbeFallback: false,
    });

    expect(requests).toEqual([
      {
        sources: sources.slice(0, 2),
        allowLiveProbeFallback: false,
      },
      {
        sources: sources.slice(2),
        allowLiveProbeFallback: false,
      },
    ]);
  });
});
