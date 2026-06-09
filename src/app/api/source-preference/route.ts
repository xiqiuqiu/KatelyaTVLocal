import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextResponse } from 'next/server';

import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';
import {
  probeSourcePlaybackWithCache,
} from '@/lib/source-preference';
import { readLatestSourceRanks } from '@/lib/source-ranking/read';
import { getSourceRankingRuntime } from '@/lib/source-ranking/runtime';
import {
  SourcePreferenceRequest,
  SourcePreferenceResponse,
  SourcePreferenceResult,
} from '@/lib/types';

export const runtime = 'edge';

const MAX_SOURCE_PREFERENCE_ITEMS = 40;
const SOURCE_PREFERENCE_CONCURRENCY = 6;
type RuntimeSource = Record<string, unknown>;

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

function sortMergedSourcePreferenceResults(
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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const runWorker = async () => {
    while (currentIndex < items.length) {
      const nextIndex = currentIndex;
      currentIndex += 1;
      results[nextIndex] = await mapper(items[nextIndex]);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}

function resolveSourceRankingEnv(): RuntimeSource | undefined {
  try {
    const requestContext = getOptionalRequestContext();
    return requestContext?.env as RuntimeSource | undefined;
  } catch {
    return undefined;
  }
}

export async function OPTIONS() {
  return handleOptionsRequest();
}

async function probeSourcesLive(
  sources: SourcePreferenceRequest['sources'],
  origin: string
): Promise<SourcePreferenceResult[]> {
  return mapWithConcurrency(
    sources,
    SOURCE_PREFERENCE_CONCURRENCY,
    async (source): Promise<SourcePreferenceResult> => {
      if (!source?.sourceKey) {
        return {
          sourceKey: '',
          kind: 'unavailable',
          reason: '缺少播放源标识',
          rankingSource: 'live',
        };
      }

      if (!source.episodeUrl) {
        return {
          sourceKey: source.sourceKey,
          kind: 'unavailable',
          reason: '该播放源没有可用剧集',
          rankingSource: 'live',
        };
      }

      const probeResult = await probeSourcePlaybackWithCache(
        source.episodeUrl,
        origin
      );

      return {
        sourceKey: source.sourceKey,
        ...probeResult,
        rankingSource: 'live',
      };
    }
  );
}

export async function POST(request: Request) {
  let payload: SourcePreferenceRequest | null = null;

  try {
    payload = (await request.json()) as SourcePreferenceRequest;
  } catch {
    const response = NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  if (!payload?.sources || !Array.isArray(payload.sources)) {
    const response = NextResponse.json(
      { error: 'Missing sources payload' },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  if (payload.sources.length > MAX_SOURCE_PREFERENCE_ITEMS) {
    const response = NextResponse.json(
      { error: `Too many sources, max is ${MAX_SOURCE_PREFERENCE_ITEMS}` },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin') || requestUrl.origin;
  const rankingEnv = resolveSourceRankingEnv();
  const runtime = getSourceRankingRuntime(
    rankingEnv || (process.env as unknown as RuntimeSource)
  );
  const validSourceKeys = payload.sources
    .map((source) => source.sourceKey)
    .filter(Boolean);
  const rankedResults =
    runtime.enabled && runtime.hasD1
      ? await readLatestSourceRanks(
          rankingEnv,
          validSourceKeys
        )
      : [];

  const rankedKeys = new Set(rankedResults.map((result) => result.sourceKey));
  const missingSources = payload.sources.filter(
    (source) => source.sourceKey && !rankedKeys.has(source.sourceKey)
  );
  const allowLiveProbeFallback =
    payload.allowLiveProbeFallback ?? runtime.fallbackToLive;
  const shouldFallbackToLive =
    allowLiveProbeFallback &&
    (rankedResults.length === 0 || missingSources.length > 0);
  const liveResults = shouldFallbackToLive
    ? await probeSourcesLive(
        rankedResults.length > 0 ? missingSources : payload.sources,
        origin
      )
    : [];

  const resultMap = new Map<string, SourcePreferenceResult>();
  rankedResults.forEach((result) => {
    if (result.sourceKey) {
      resultMap.set(result.sourceKey, result);
    }
  });
  liveResults.forEach((result) => {
    if (result.sourceKey) {
      resultMap.set(result.sourceKey, result);
    }
  });

  const orderedResults = sortMergedSourcePreferenceResults(
    Array.from(resultMap.values())
  );
  const rankingSource =
    rankedResults.length > 0 && liveResults.length > 0
      ? 'mixed'
      : rankedResults.length > 0
      ? 'd1'
      : liveResults.length > 0
      ? 'live'
      : runtime.enabled && runtime.hasD1
      ? 'd1'
      : 'live';

  const responseBody: SourcePreferenceResponse = {
    orderedSourceKeys: orderedResults.map((result) => result.sourceKey),
    results: orderedResults,
    generatedAt: Date.now(),
    rankingSource,
    confidence: rankedResults.length > 0 ? 'medium' : 'low',
  };

  const response = NextResponse.json(responseBody, { status: 200 });
  return addCorsHeaders(response);
}
