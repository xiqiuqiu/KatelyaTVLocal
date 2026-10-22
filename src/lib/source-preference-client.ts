import {
  SourcePreferenceRequest,
  SourcePreferenceResponse,
  SourcePreferenceResult,
} from './types';

const DEFAULT_SOURCE_PREFERENCE_BATCH_SIZE = 6;

type Fetcher = typeof fetch;

interface FetchSourcePreferencesOptions {
  allowLiveProbeFallback?: boolean;
  includeFreshProbeMetrics?: boolean;
  fetcher?: Fetcher;
  batchSize?: number;
  endpoint?: string;
  signal?: AbortSignal;
  /** Called with the merged results so far after each successful batch. */
  onBatch?: (response: SourcePreferenceResponse) => void;
}

function getStatusPriority(kind: SourcePreferenceResult['kind']): number {
  switch (kind) {
    case 'direct':
      return 0;
    case 'proxy':
      return 1;
    case 'unavailable':
    default:
      return 2;
  }
}

function sortPreferenceResults(
  results: SourcePreferenceResult[]
): SourcePreferenceResult[] {
  return [...results].sort((a, b) => {
    const priorityGap = getStatusPriority(a.kind) - getStatusPriority(b.kind);
    if (priorityGap !== 0) {
      return priorityGap;
    }

    const rankScoreA = a.rankScore ?? Number.NEGATIVE_INFINITY;
    const rankScoreB = b.rankScore ?? Number.NEGATIVE_INFINITY;
    if (rankScoreA !== rankScoreB) {
      return rankScoreB - rankScoreA;
    }

    const pingA = a.pingTimeMs ?? a.probeTimeMs ?? Number.MAX_SAFE_INTEGER;
    const pingB = b.pingTimeMs ?? b.probeTimeMs ?? Number.MAX_SAFE_INTEGER;
    if (pingA !== pingB) {
      return pingA - pingB;
    }

    return a.sourceKey.localeCompare(b.sourceKey);
  });
}

function getRankingSource(
  responses: SourcePreferenceResponse[]
): SourcePreferenceResponse['rankingSource'] {
  const sources = new Set(responses.map((response) => response.rankingSource));
  if (sources.has('mixed')) {
    return 'mixed';
  }

  if (sources.has('d1') && sources.has('live')) {
    return 'mixed';
  }

  if (sources.has('d1')) {
    return 'd1';
  }

  return 'live';
}

export async function fetchSourcePreferencesInBatches(
  sources: SourcePreferenceRequest['sources'],
  options: FetchSourcePreferencesOptions = {}
): Promise<SourcePreferenceResponse> {
  const fetcher = options.fetcher || fetch;
  const endpoint = options.endpoint || '/api/source-preference';
  const batchSize = Math.max(
    1,
    Math.floor(options.batchSize || DEFAULT_SOURCE_PREFERENCE_BATCH_SIZE)
  );
  const responses: SourcePreferenceResponse[] = [];

  const mergedResponse = (): SourcePreferenceResponse => {
    const resultMap = new Map<string, SourcePreferenceResult>();
    responses.forEach((response) => {
      response.results.forEach((result) => {
        if (result.sourceKey) {
          resultMap.set(result.sourceKey, result);
        }
      });
    });
    const orderedResults = sortPreferenceResults(
      Array.from(resultMap.values())
    );
    return {
      orderedSourceKeys: orderedResults.map((result) => result.sourceKey),
      results: orderedResults,
      generatedAt: Date.now(),
      rankingSource: getRankingSource(responses),
      confidence: responses.some((response) => response.confidence === 'medium')
        ? 'medium'
        : 'low',
    };
  };

  for (let start = 0; start < sources.length; start += batchSize) {
    if (options.signal?.aborted) {
      break;
    }
    const batch = sources.slice(start, start + batchSize);
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        signal: options.signal,
        body: JSON.stringify({
          sources: batch,
          ...(options.allowLiveProbeFallback === undefined
            ? {}
            : { allowLiveProbeFallback: options.allowLiveProbeFallback }),
          ...(options.includeFreshProbeMetrics === undefined
            ? {}
            : { includeFreshProbeMetrics: options.includeFreshProbeMetrics }),
        }),
      });
    } catch (error) {
      if (options.signal?.aborted) {
        break;
      }
      throw error;
    }

    if (!response.ok) {
      continue;
    }

    responses.push((await response.json()) as SourcePreferenceResponse);
    options.onBatch?.(mergedResponse());
  }

  if (responses.length === 0) {
    throw new Error('批量探测失败');
  }

  return mergedResponse();
}
