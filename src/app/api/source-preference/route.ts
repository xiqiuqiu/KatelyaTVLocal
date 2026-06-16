import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextResponse } from 'next/server';

import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';
import {
  probeSourcePlaybackWithCache,
} from '@/lib/source-preference';
import { formatSourceSpeedKbps } from '@/lib/source-preference-video-info';
import {
  persistOfflineProbeResult,
  probePlaybackForRanking,
} from '@/lib/source-ranking/probe';
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
const FRESH_PROBE_METRICS_LIMIT = 8;
const FRESH_PROBE_METRICS_CONCURRENCY = 2;
const FRESH_PROBE_SPEED_TTL_MS = 6 * 60 * 60 * 1000;
type RuntimeSource = Record<string, unknown>;
interface FreshProbeEnv {
  DB: {
    prepare: (query: string) => {
      bind: (...values: unknown[]) => {
        run: () => Promise<unknown>;
      };
    };
  };
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

function getFreshProbeEnv(env?: RuntimeSource): FreshProbeEnv | null {
  const db = env?.DB;
  if (
    db &&
    typeof db === 'object' &&
    typeof (db as FreshProbeEnv['DB']).prepare === 'function'
  ) {
    return { DB: db as FreshProbeEnv['DB'] };
  }

  return null;
}

function hasFreshSpeedMetric(
  result: SourcePreferenceResult | undefined,
  now: number
): boolean {
  if (!result) return false;

  const hasSpeed =
    Boolean(result.speedLabel) || typeof result.speedKbps === 'number';
  if (!hasSpeed) return false;

  const updatedAt = result.speedUpdatedAt ?? result.updatedAt;
  if (typeof updatedAt !== 'number') {
    return true;
  }

  return now - updatedAt <= FRESH_PROBE_SPEED_TTL_MS;
}

async function probeFreshMetricsForVisibleSources({
  sources,
  existingResults,
  env,
  origin,
  now,
}: {
  sources: SourcePreferenceRequest['sources'];
  existingResults: Map<string, SourcePreferenceResult>;
  env: RuntimeSource | undefined;
  origin: string;
  now: number;
}): Promise<SourcePreferenceResult[]> {
  const freshProbeEnv = getFreshProbeEnv(env);
  if (!freshProbeEnv) {
    return [];
  }

  const candidates = sources
    .filter(
      (source) =>
        Boolean(source.sourceKey) &&
        Boolean(source.episodeUrl) &&
        !hasFreshSpeedMetric(existingResults.get(source.sourceKey), now)
    )
    .slice(0, FRESH_PROBE_METRICS_LIMIT);

  return mapWithConcurrency(
    candidates,
    FRESH_PROBE_METRICS_CONCURRENCY,
    async (source): Promise<SourcePreferenceResult | null> => {
      try {
        const result = await probePlaybackForRanking(
          source.episodeUrl as string,
          origin
        );
        const measuredAt = Date.now();

        await persistOfflineProbeResult(
          freshProbeEnv,
          `panel-${measuredAt}`,
          {
            sourceKey: source.sourceKey,
            sourceName: source.sourceName || source.sourceKey,
            titleSample: source.titleSample || '',
            episodeUrl: source.episodeUrl as string,
          },
          result,
          measuredAt
        );

        const existing = existingResults.get(source.sourceKey);
        const speedLabel = formatSourceSpeedKbps(
          result.firstSegmentSpeedKbps
        );

        return {
          ...(existing || {}),
          sourceKey: source.sourceKey,
          kind: result.kind,
          reason: result.reason || existing?.reason,
          domain: result.domain || existing?.domain || null,
          upstreamStatus: result.upstreamStatus,
          probeTimeMs: result.probeTimeMs ?? existing?.probeTimeMs,
          qualityLabel:
            result.resolutionLabel ?? existing?.qualityLabel ?? null,
          speedLabel: speedLabel || existing?.speedLabel || null,
          speedSource: speedLabel ? 'backend' : existing?.speedSource || 'none',
          speedUpdatedAt: speedLabel ? measuredAt : existing?.speedUpdatedAt,
          speedPending: !speedLabel,
          pingTimeMs:
            result.firstSegmentLatencyMs ??
            existing?.pingTimeMs ??
            result.probeTimeMs ??
            null,
          latencyMs:
            result.firstSegmentLatencyMs ?? existing?.latencyMs ?? null,
          speedKbps:
            result.firstSegmentSpeedKbps ?? existing?.speedKbps ?? null,
          updatedAt: Math.max(existing?.updatedAt || 0, measuredAt),
          rankingSource: existing?.rankingSource || 'd1',
          rankScore: existing?.rankScore,
        };
      } catch {
        return null;
      }
    }
  ).then((results) =>
    results.filter((result): result is SourcePreferenceResult => result !== null)
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

  if (payload.includeFreshProbeMetrics && runtime.enabled && runtime.hasD1) {
    const freshMetricResults = await probeFreshMetricsForVisibleSources({
      sources: payload.sources,
      existingResults: resultMap,
      env: rankingEnv,
      origin,
      now: Date.now(),
    });

    freshMetricResults.forEach((result) => {
      if (result.sourceKey) {
        resultMap.set(result.sourceKey, result);
      }
    });
  }

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
