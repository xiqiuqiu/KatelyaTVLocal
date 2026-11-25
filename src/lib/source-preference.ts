import {
  fetchWithValidatedRedirects,
  validateProxyTargetUrl,
} from './proxy-url-policy';
import {
  SOURCE_CORS_BLOCKED_REASON,
  SourcePreferenceResult,
  SourceProbeResult,
  SourceStatusKind,
} from './types';

const SOURCE_PROBE_CACHE_VERSION = 'v3';
const SOURCE_PROBE_POSITIVE_TTL_SECONDS = 10 * 60;
const SOURCE_PROBE_NEGATIVE_TTL_SECONDS = 2 * 60;
const SOURCE_PROBE_FETCH_TIMEOUT_MS = 5000;
const SOURCE_PROBE_MAX_NESTED_REQUESTS = 3;
const FIRST_SEGMENT_SAMPLE_BYTES = 256 * 1024;
const PLAYLIST_CONTENT_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
];

export interface SourceProbeMetrics extends SourceProbeResult {
  probeTimeMs?: number;
  cacheState?: 'hit' | 'miss';
}

interface HlsProbeMetrics {
  resolutionHeight: number | null;
  firstSegmentLatencyMs: number | null;
  firstSegmentSpeedKbps: number | null;
}

interface UpstreamProbeOptions extends SourceProbeOptions {
  measureHls?: boolean;
}

export interface SourcePreferenceProbeResult extends SourceProbeMetrics {
  sourceKey: string;
}

export interface SourceProbeOptions {
  timeoutMs?: number;
  skipCacheRead?: boolean;
  signal?: AbortSignal;
  waitUntil?: (work: Promise<void>) => void;
}

function normalizeProbeTimeoutMs(timeoutMs?: number): number {
  if (!Number.isFinite(timeoutMs)) {
    return SOURCE_PROBE_FETCH_TIMEOUT_MS;
  }

  return Math.min(10000, Math.max(1000, Math.floor(timeoutMs as number)));
}

async function fetchValidatedProbeTarget(
  targetUrl: string,
  init: RequestInit,
  options?: SourceProbeOptions
): Promise<Response> {
  const validation = validateProxyTargetUrl(targetUrl);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const controller = options?.signal ? null : new AbortController();
  const signal = options?.signal ?? controller?.signal;
  const timeoutId = controller
    ? setTimeout(
        () => controller.abort(),
        normalizeProbeTimeoutMs(options?.timeoutMs)
      )
    : undefined;
  try {
    if (signal?.aborted) throw new Error('探测已取消');
    return await fetchWithValidatedRedirects(
      validation.url.href,
      { ...init, redirect: 'manual', signal },
      { maxRedirects: 2 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function isPlaylistResponse(
  targetUrl: string,
  contentType: string | null
): boolean {
  const normalizedContentType = contentType?.toLowerCase() || '';

  return (
    PLAYLIST_CONTENT_TYPES.some((item) =>
      normalizedContentType.includes(item)
    ) || targetUrl.toLowerCase().includes('.m3u8')
  );
}

function buildAbsoluteUrl(input: string, baseUrl: string): string {
  return new URL(input, baseUrl).toString();
}

function buildUpstreamHeaders(
  targetUrl: string,
  origin: string,
  rangeHeader?: string | null
): Headers {
  const headers = new Headers();

  if (rangeHeader) {
    headers.set('Range', rangeHeader);
  }

  headers.set(
    'User-Agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
  );
  headers.set('Referer', new URL(targetUrl).origin);
  headers.set('Origin', origin);
  headers.set('Accept', '*/*');

  return headers;
}

function isCorsAccessible(
  response: Response,
  targetUrl: string,
  origin: string
): boolean {
  const allowedOrigin = response.headers
    .get('access-control-allow-origin')
    ?.trim();
  return (
    new URL(response.url || targetUrl).origin === origin ||
    allowedOrigin === '*' ||
    allowedOrigin === origin
  );
}

function getFirstPlaylistTarget(
  content: string,
  baseUrl: string
): { url: string; resolutionHeight: number | null } | null {
  let resolutionHeight = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const resolution = line.match(/RESOLUTION=\d+x(\d+)/i);
      resolutionHeight = resolution ? Number(resolution[1]) : null;
    }
    if (!line || line.startsWith('#')) {
      continue;
    }

    return { url: buildAbsoluteUrl(line, baseUrl), resolutionHeight };
  }

  return null;
}

async function measureFirstSegment(
  response: Response,
  startedAt: number,
  timeoutMs: number
): Promise<Pick<
  HlsProbeMetrics,
  'firstSegmentLatencyMs' | 'firstSegmentSpeedKbps'
> | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  let bytes = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, Math.max(0, timeoutMs - (Date.now() - startedAt)));
  try {
    while (bytes < FIRST_SEGMENT_SAMPLE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += Math.min(value.byteLength, FIRST_SEGMENT_SAMPLE_BYTES - bytes);
    }
    if (timedOut || !bytes) return null;
    const elapsed = Math.max(1, Date.now() - startedAt);
    return {
      firstSegmentLatencyMs: elapsed,
      firstSegmentSpeedKbps: Number(((bytes / elapsed) * 8).toFixed(2)),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

async function probeNestedTarget(
  target: NonNullable<ReturnType<typeof getFirstPlaylistTarget>>,
  rootUrl: string,
  origin: string,
  options?: UpstreamProbeOptions
): Promise<{
  ok: boolean;
  status?: number;
  reason?: string;
  hlsMetrics?: HlsProbeMetrics;
  mediaReadyAt?: number;
}> {
  const rootValidation = validateProxyTargetUrl(rootUrl);
  const visited = new Set(rootValidation.ok ? [rootValidation.url.href] : []);
  let currentUrl = target.url;
  let resolutionHeight = target.resolutionHeight;

  for (
    let requestCount = 0;
    requestCount < SOURCE_PROBE_MAX_NESTED_REQUESTS;
    requestCount += 1
  ) {
    const validation = validateProxyTargetUrl(currentUrl);
    if (!validation.ok) {
      return {
        ok: false,
        reason: validation.reason,
      };
    }

    currentUrl = validation.url.href;
    if (visited.has(currentUrl)) {
      return {
        ok: false,
        reason: '播放列表存在循环引用',
      };
    }
    visited.add(currentUrl);

    const fetchTarget = (range: string | null) =>
      fetchValidatedProbeTarget(
        currentUrl,
        { headers: buildUpstreamHeaders(currentUrl, origin, range) },
        options
      );
    const isPlaylistUrl = isPlaylistResponse(currentUrl, null);
    let sampleSegment = Boolean(options?.measureHls) && !isPlaylistUrl;
    const startedAt = Date.now();
    let response = await fetchTarget(
      isPlaylistUrl
        ? null
        : sampleSegment
        ? `bytes=0-${FIRST_SEGMENT_SAMPLE_BYTES - 1}`
        : 'bytes=0-1'
    );
    if (sampleSegment && response.status === 416) {
      void response.body?.cancel().catch(() => undefined);
      sampleSegment = false;
      response = await fetchTarget('bytes=0-1');
    }
    const ok = response.ok || response.status === 206;

    if (!ok) {
      void response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        status: response.status,
        reason: `HLS 播放目标不可达: ${response.status}`,
      };
    }

    if (!isCorsAccessible(response, currentUrl, origin)) {
      void response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        status: response.status,
        reason: SOURCE_CORS_BLOCKED_REASON,
      };
    }

    if (!isPlaylistResponse(currentUrl, response.headers.get('content-type'))) {
      if (!options?.measureHls) {
        void response.body?.cancel().catch(() => undefined);
        return { ok: true, status: response.status };
      }
      const mediaReadyAt = Date.now();
      const measurement = sampleSegment
        ? await measureFirstSegment(
            response,
            startedAt,
            normalizeProbeTimeoutMs(options.timeoutMs)
          )
        : null;
      return {
        ok: true,
        status: response.status,
        mediaReadyAt,
        hlsMetrics: {
          resolutionHeight,
          firstSegmentLatencyMs: measurement?.firstSegmentLatencyMs ?? null,
          firstSegmentSpeedKbps: measurement?.firstSegmentSpeedKbps ?? null,
        },
      };
    }

    if (requestCount === SOURCE_PROBE_MAX_NESTED_REQUESTS - 1) {
      void response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        status: response.status,
        reason: '播放列表嵌套超过探测上限',
      };
    }

    const nextTarget = getFirstPlaylistTarget(
      await response.text(),
      response.url || currentUrl
    );
    if (!nextTarget) {
      return {
        ok: false,
        status: response.status,
        reason: '播放列表未包含可探测的媒体对象',
      };
    }
    currentUrl = nextTarget.url;
    resolutionHeight = nextTarget.resolutionHeight ?? resolutionHeight;
  }

  return {
    ok: false,
    reason: '播放列表嵌套超过探测上限',
  };
}

function getCloudflareCache(): Cache | null {
  const cacheApi = (
    globalThis as { caches?: CacheStorage & { default?: Cache } }
  ).caches;

  if (cacheApi?.default) {
    return cacheApi.default;
  }

  return null;
}

function buildProbeCacheRequest(targetUrl: string, origin: string): Request {
  const cacheUrl = new URL('https://source-probe-cache.invalid/edge-prefer');
  cacheUrl.searchParams.set('v', SOURCE_PROBE_CACHE_VERSION);
  cacheUrl.searchParams.set('url', targetUrl);
  cacheUrl.searchParams.set('origin', origin);
  return new Request(cacheUrl.toString(), { method: 'GET' });
}

function getStatusPriority(
  kind: SourceStatusKind | SourcePreferenceResult['kind']
): number {
  switch (kind) {
    case 'direct':
      return 0;
    case 'playable':
      return 1;
    case 'unavailable':
      return 2;
    default:
      return 4;
  }
}

function getProbeCacheTtl(result: SourceProbeResult): number {
  return result.kind === 'unavailable'
    ? SOURCE_PROBE_NEGATIVE_TTL_SECONDS
    : SOURCE_PROBE_POSITIVE_TTL_SECONDS;
}

export async function probeSourcePlaybackUpstream(
  targetUrl: string,
  origin: string,
  options?: UpstreamProbeOptions
): Promise<SourceProbeMetrics & { hlsMetrics?: HlsProbeMetrics }> {
  const startedAt = Date.now();

  try {
    const upstreamResponse = await fetchValidatedProbeTarget(
      targetUrl,
      {
        headers: buildUpstreamHeaders(targetUrl, origin),
      },
      options
    );

    const probeTimeMs = Date.now() - startedAt;
    const domain = new URL(targetUrl).hostname.toLowerCase();

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      void upstreamResponse.body?.cancel().catch(() => undefined);
      return {
        kind: 'unavailable',
        reason: `上游响应失败: ${upstreamResponse.status}`,
        domain,
        upstreamStatus: upstreamResponse.status,
        probeTimeMs,
      };
    }

    if (!isCorsAccessible(upstreamResponse, targetUrl, origin)) {
      void upstreamResponse.body?.cancel().catch(() => undefined);
      return {
        kind: 'unavailable',
        reason: SOURCE_CORS_BLOCKED_REASON,
        domain,
        upstreamStatus: upstreamResponse.status,
        probeTimeMs,
      };
    }

    const playlistResponse = isPlaylistResponse(
      targetUrl,
      upstreamResponse.headers.get('content-type')
    );

    if (!playlistResponse) {
      void upstreamResponse.body?.cancel().catch(() => undefined);
      return {
        kind: 'direct',
        reason: '媒体地址可直接访问',
        domain,
        upstreamStatus: upstreamResponse.status,
        probeTimeMs,
      };
    }

    const playlistContent = await upstreamResponse.text();
    const playlistUrl = upstreamResponse.url || targetUrl;
    const nextTarget = getFirstPlaylistTarget(playlistContent, playlistUrl);

    if (!nextTarget) {
      return {
        kind: 'unavailable',
        reason: '播放列表未包含可探测的媒体对象',
        domain,
        upstreamStatus: upstreamResponse.status,
        probeTimeMs,
      };
    }

    const nestedProbe = await probeNestedTarget(
      nextTarget,
      playlistUrl,
      origin,
      options
    );

    if (!nestedProbe.ok) {
      return {
        kind: 'unavailable',
        reason: nestedProbe.reason || '首个媒体对象不可达',
        domain,
        upstreamStatus: nestedProbe.status,
        probeTimeMs: Date.now() - startedAt,
      };
    }

    return {
      kind: 'direct',
      reason: '播放列表和首个媒体片段可访问',
      domain,
      upstreamStatus: upstreamResponse.status,
      probeTimeMs: (nestedProbe.mediaReadyAt ?? Date.now()) - startedAt,
      ...(nestedProbe.hlsMetrics && { hlsMetrics: nestedProbe.hlsMetrics }),
    };
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : '探测失败',
      probeTimeMs: Date.now() - startedAt,
    };
  }
}

export async function readCachedSourceProbe(
  targetUrl: string,
  origin: string
): Promise<SourceProbeMetrics | null> {
  const cache = getCloudflareCache();
  if (!cache) {
    return null;
  }
  try {
    const cachedResponse = await cache.match(
      buildProbeCacheRequest(targetUrl, origin)
    );
    if (!cachedResponse) {
      return null;
    }
    const cachedPayload = (await cachedResponse
      .json()
      .catch(() => null)) as SourceProbeMetrics | null;
    if (
      cachedPayload?.kind !== 'direct' &&
      cachedPayload?.kind !== 'unavailable'
    ) {
      return null;
    }
    return {
      ...cachedPayload,
      cacheState: 'hit',
    };
  } catch {
    // Cache API 子请求超额时不能让整批优选变成 500。
    return null;
  }
}

export async function probeSourcePlaybackWithCache(
  targetUrl: string,
  origin: string,
  options?: SourceProbeOptions
): Promise<SourceProbeMetrics> {
  const cached = options?.skipCacheRead
    ? null
    : await readCachedSourceProbe(targetUrl, origin);
  if (cached) {
    return cached;
  }

  const cache = getCloudflareCache();
  const cacheRequest = buildProbeCacheRequest(targetUrl, origin);
  const freshResult = await probeSourcePlaybackUpstream(
    targetUrl,
    origin,
    options
  );

  if (cache && !options?.signal?.aborted) {
    const ttl = getProbeCacheTtl(freshResult);
    try {
      const write = cache
        .put(
          cacheRequest,
          new Response(JSON.stringify(freshResult), {
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': `public, max-age=${ttl}`,
            },
          })
        )
        .catch(() => undefined);
      if (options?.waitUntil) options.waitUntil(write);
      else await write;
    } catch {
      // 写缓存失败仍返回这次探测结果。
    }
  }

  return {
    ...freshResult,
    cacheState: 'miss',
  };
}

export function getBrowserProbeBudget(totalCandidates: number): number {
  if (totalCandidates <= 0) return 0;
  if (totalCandidates <= 3) return totalCandidates;
  if (totalCandidates <= 8) return 3;
  if (totalCandidates <= 15) return 4;
  return 5;
}

export function sortSourcePreferenceResults<
  T extends Pick<SourcePreferenceResult, 'kind' | 'sourceKey' | 'probeTimeMs'>
>(results: T[]): T[] {
  return [...results].sort((a, b) => {
    const priorityGap = getStatusPriority(a.kind) - getStatusPriority(b.kind);
    if (priorityGap !== 0) {
      return priorityGap;
    }

    const probeTimeA = a.probeTimeMs ?? Number.MAX_SAFE_INTEGER;
    const probeTimeB = b.probeTimeMs ?? Number.MAX_SAFE_INTEGER;
    if (probeTimeA !== probeTimeB) {
      return probeTimeA - probeTimeB;
    }

    return a.sourceKey.localeCompare(b.sourceKey);
  });
}
