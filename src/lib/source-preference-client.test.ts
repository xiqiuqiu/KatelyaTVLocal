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
      batchSize: 20,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      requests.map(
        (request) => (request as { sources: unknown[] }).sources.length
      )
    ).toEqual([20, 20, 5]);
    expect(response.results).toHaveLength(45);
    expect(response.orderedSourceKeys).toEqual(
      response.results.map((result) => result.sourceKey)
    );
    expect(response.rankingSource).toBe('live');
  });
});
