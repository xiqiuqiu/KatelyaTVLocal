import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextResponse } from 'next/server';

import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';
import {
  type SourceProbeOptions,
  probeSourcePlaybackWithCache,
  readCachedSourceProbe,
} from '@/lib/source-preference';
import { formatSourceSpeedKbps } from '@/lib/source-preference-video-info';
import {
  isPlatformProbeFailure,
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
/**
 * 免费版 Workers 每次调用最多 50 次子请求。一条冷探测大约要
 * cache.match + 上游 fetch + cache.put，再加嵌套分片。同一请求只实时探测前 6 条。
 */
const MAX_LIVE_PROBES_PER_REQUEST = 6;
const MAX_RANKED_AVAILABILITY_CHECKS = 2;
// Leave 200 ms for request/response overhead within the page's 3 s budget.
const STARTUP_PROBE_DEADLINE_MS = 2800;
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
    case 'unknown':
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
  mapper: (item: T) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const runWorker = async () => {
    while (currentIndex < items.length && !signal?.aborted) {
      const nextIndex = currentIndex;
      currentIndex += 1;
      results[nextIndex] = await mapper(items[nextIndex]);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}

async function untilProbeAborts<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  fallback: T
): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return fallback;
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<T>((resolve) => {
    onAbort = () => resolve(fallback);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function getSourceRankingContext() {
  try {
    return getOptionalRequestContext();
  } catch {
    return undefined;
  }
}

export async function OPTIONS() {
  return handleOptionsRequest();
}

async function probeSourcesLive(
  sources: SourcePreferenceRequest['sources'],
  origin: string,
  startup?: Pick<SourceProbeOptions, 'signal' | 'waitUntil'>
): Promise<{
  results: SourcePreferenceResult[];
  upstreamProbes: number;
}> {
  const probedByEpisodeUrl = new Map<
    string,
    Promise<SourcePreferenceResult | null>
  >();
  const completed: SourcePreferenceResult[] = [];
  let foundDirect: (() => void) | undefined;
  const firstDirect =
    startup &&
    new Promise<void>((resolve) => {
      foundDirect = resolve;
    });
  let upstreamProbes = 0;
  const probe = async (
    source: SourcePreferenceRequest['sources'][number]
  ): Promise<SourcePreferenceResult | null> => {
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

    const shared = probedByEpisodeUrl.get(source.episodeUrl);
    if (shared) {
      const sharedResult = await shared;
      return sharedResult
        ? { ...sharedResult, sourceKey: source.sourceKey }
        : null;
    }

    let resolveProbe: (result: SourcePreferenceResult | null) => void = () =>
      undefined;
    const probePromise = new Promise<SourcePreferenceResult | null>(
      (resolve) => {
        resolveProbe = resolve;
      }
    );
    probedByEpisodeUrl.set(source.episodeUrl, probePromise);

    const reserveUpstreamProbe = () => {
      if (upstreamProbes >= MAX_LIVE_PROBES_PER_REQUEST) {
        return false;
      }
      upstreamProbes += 1;
      return true;
    };
    const upstreamProbeReserved = reserveUpstreamProbe();

    let probeResult: SourcePreferenceResult | null = null;
    try {
      const cached = await readCachedSourceProbe(source.episodeUrl, origin);
      if (startup?.signal?.aborted) {
        probeResult = null;
      } else if (cached) {
        if (upstreamProbeReserved) {
          upstreamProbes -= 1;
        }
        probeResult = {
          sourceKey: source.sourceKey,
          ...cached,
          rankingSource: 'live',
        };
      } else if (!upstreamProbeReserved) {
        probeResult = null;
      } else {
        const probedUpstream = await probeSourcePlaybackWithCache(
          source.episodeUrl,
          origin,
          { skipCacheRead: true, ...startup }
        );
        probeResult = {
          sourceKey: source.sourceKey,
          ...probedUpstream,
          rankingSource: 'live',
        };
      }
    } catch {
      // A platform or transport failure has no verdict about this episode.
    }
    if (
      probeResult &&
      (isPlatformProbeFailure(probeResult) ||
        (probeResult.kind === 'unavailable' &&
          probeResult.upstreamStatus == null))
    )
      probeResult = null;
    resolveProbe(probeResult);
    return probeResult;
  };
  const probed = mapWithConcurrency(
    sources,
    SOURCE_PREFERENCE_CONCURRENCY,
    async (source) => {
      const result = await probe(source);
      if (startup && !startup.signal?.aborted && result) {
        completed.push(result);
        if (result.kind === 'direct') foundDirect?.();
      }
      return result;
    },
    startup?.signal
  );
  if (startup && firstDirect) {
    await untilProbeAborts(
      Promise.race([probed.then(() => undefined), firstDirect]),
      startup.signal,
      undefined
    );
    return { results: completed.slice(), upstreamProbes };
  }
  return {
    results: (await probed).filter(
      (result): result is SourcePreferenceResult => result !== null
    ),
    upstreamProbes,
  };
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
  rankedByKey,
  env,
  origin,
  now,
  upstreamProbesUsed,
}: {
  sources: SourcePreferenceRequest['sources'];
  existingResults: Map<string, SourcePreferenceResult>;
  rankedByKey: Map<string, SourcePreferenceResult>;
  env: RuntimeSource | undefined;
  origin: string;
  now: number;
  upstreamProbesUsed: number;
}): Promise<SourcePreferenceResult[]> {
  const freshProbeEnv = getFreshProbeEnv(env);
  if (!freshProbeEnv) {
    return [];
  }

  const remainingProbeBudget = Math.max(
    0,
    MAX_LIVE_PROBES_PER_REQUEST - upstreamProbesUsed
  );
  const candidates = sources
    .filter(
      (source) =>
        Boolean(source.sourceKey) &&
        Boolean(source.episodeUrl) &&
        !hasFreshSpeedMetric(existingResults.get(source.sourceKey), now) &&
        !hasFreshSpeedMetric(rankedByKey.get(source.sourceKey), now)
    )
    .slice(0, Math.min(FRESH_PROBE_METRICS_LIMIT, remainingProbeBudget));

  return mapWithConcurrency(
    candidates,
    FRESH_PROBE_METRICS_CONCURRENCY,
    async (source): Promise<SourcePreferenceResult | null> => {
      try {
        const result = await probePlaybackForRanking(
          source.episodeUrl as string,
          origin
        );
        if (
          isPlatformProbeFailure(result) ||
          (result.kind === 'unavailable' && result.upstreamStatus == null)
        ) {
          return null;
        }
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
        const speedLabel = formatSourceSpeedKbps(result.firstSegmentSpeedKbps);

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
          rankScoreWithoutCron: existing?.rankScoreWithoutCron,
        };
      } catch {
        return null;
      }
    }
  ).then((results) =>
    results.filter(
      (result): result is SourcePreferenceResult => result !== null
    )
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
  const startup =
    payload.startupProbe === true && !payload.includeFreshProbeMetrics
      ? new AbortController()
      : undefined;
  const abortStartup = () => startup?.abort();
  const timer = startup
    ? setTimeout(abortStartup, STARTUP_PROBE_DEADLINE_MS)
    : undefined;
  if (startup) {
    if (request.signal?.aborted) abortStartup();
    else
      request.signal?.addEventListener('abort', abortStartup, { once: true });
  }
  try {
    const responseBody = await buildSourcePreferenceResponse(
      payload,
      origin,
      startup
    );
    return addCorsHeaders(NextResponse.json(responseBody, { status: 200 }));
  } finally {
    if (startup) {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abortStartup);
      abortStartup();
    }
  }
}

async function buildSourcePreferenceResponse(
  payload: SourcePreferenceRequest,
  origin: string,
  startup: AbortController | undefined
): Promise<SourcePreferenceResponse> {
  const context = getSourceRankingContext();
  const rankingEnv = context?.env as RuntimeSource | undefined;
  const runtime = getSourceRankingRuntime(
    rankingEnv || (process.env as unknown as RuntimeSource)
  );
  const validSourceKeys = payload.sources
    .map((source) => source.sourceKey)
    .filter(Boolean);
  const rankedResults =
    runtime.enabled && runtime.hasD1 && !startup?.signal.aborted
      ? await untilProbeAborts(
          readLatestSourceRanks(rankingEnv, validSourceKeys).catch(() => []),
          startup?.signal,
          []
        )
      : [];

  const rankedByKey = new Map(
    rankedResults.map((result) => [result.sourceKey, result])
  );
  const missingSources = payload.sources.filter(
    (source) => source.sourceKey && !rankedByKey.has(source.sourceKey)
  );
  const rankedCandidateUrls = new Set<string>();
  if (payload.checkRankedAvailability !== false) {
    for (const source of payload.sources
      .filter(
        (source) => source.episodeUrl && rankedByKey.has(source.sourceKey)
      )
      .sort(
        (a, b) =>
          (rankedByKey.get(b.sourceKey)?.rankScore ?? 0) -
          (rankedByKey.get(a.sourceKey)?.rankScore ?? 0)
      )) {
      if (source.episodeUrl) rankedCandidateUrls.add(source.episodeUrl);
      if (rankedCandidateUrls.size >= MAX_RANKED_AVAILABILITY_CHECKS) break;
    }
  }
  const rankedCandidates = payload.sources.filter(
    (source) =>
      source.episodeUrl &&
      rankedCandidateUrls.has(source.episodeUrl) &&
      rankedByKey.has(source.sourceKey)
  );
  const allowLiveProbeFallback =
    payload.allowLiveProbeFallback ?? runtime.fallbackToLive;
  const liveProbe =
    allowLiveProbeFallback && !startup?.signal.aborted
      ? await probeSourcesLive(
          [...rankedCandidates, ...missingSources],
          origin,
          startup && {
            signal: startup.signal,
            waitUntil: (work) => context?.ctx?.waitUntil?.(work),
          }
        )
      : { results: [], upstreamProbes: 0 };
  const liveResults = liveProbe.results;

  const resultMap = new Map<string, SourcePreferenceResult>();
  rankedResults.forEach((result) => {
    if (result.sourceKey) {
      // D1 ranks describe historical samples. They carry no episode + Origin proof.
      resultMap.set(result.sourceKey, {
        ...result,
        kind: 'unknown',
        reason: undefined,
      });
    }
  });
  liveResults.forEach((result) => {
    if (result.sourceKey) {
      const ranked = rankedByKey.get(result.sourceKey);
      resultMap.set(result.sourceKey, {
        ...result,
        rankScore: ranked?.rankScore,
        rankScoreWithoutCron: ranked?.rankScoreWithoutCron,
      });
    }
  });

  if (payload.includeFreshProbeMetrics && runtime.enabled && runtime.hasD1) {
    const freshMetricResults = await probeFreshMetricsForVisibleSources({
      sources: payload.sources,
      existingResults: resultMap,
      rankedByKey,
      env: rankingEnv,
      origin,
      now: Date.now(),
      upstreamProbesUsed: liveProbe.upstreamProbes,
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

  return {
    orderedSourceKeys: orderedResults.map((result) => result.sourceKey),
    results: orderedResults,
    generatedAt: Date.now(),
    rankingSource,
    confidence: rankedResults.length > 0 ? 'medium' : 'low',
  };
}
