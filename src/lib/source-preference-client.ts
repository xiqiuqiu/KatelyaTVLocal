import {
  SourcePreferenceRequest,
  SourcePreferenceResponse,
  SourcePreferenceResult,
} from './types';

const DEFAULT_SOURCE_PREFERENCE_BATCH_SIZE = 20;

type Fetcher = typeof fetch;

interface FetchSourcePreferencesOptions {
  allowLiveProbeFallback?: boolean;
  fetcher?: Fetcher;
  batchSize?: number;
  endpoint?: string;
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

  for (let start = 0; start < sources.length; start += batchSize) {
    const batch = sources.slice(start, start + batchSize);
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        sources: batch,
        ...(options.allowLiveProbeFallback === undefined
          ? {}
          : { allowLiveProbeFallback: options.allowLiveProbeFallback }),
      }),
    });

    if (!response.ok) {
      throw new Error(`批量探测失败: ${response.status}`);
    }

    responses.push((await response.json()) as SourcePreferenceResponse);
  }

  const resultMap = new Map<string, SourcePreferenceResult>();
  responses.forEach((response) => {
    response.results.forEach((result) => {
      if (result.sourceKey) {
        resultMap.set(result.sourceKey, result);
      }
    });
  });

  const orderedResults = sortPreferenceResults(Array.from(resultMap.values()));

  return {
    orderedSourceKeys: orderedResults.map((result) => result.sourceKey),
    results: orderedResults,
    generatedAt: Date.now(),
    rankingSource: getRankingSource(responses),
    confidence: responses.some((response) => response.confidence === 'medium')
      ? 'medium'
      : 'low',
  };
}
