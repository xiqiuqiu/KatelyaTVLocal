import {
  SourceProbeResult,
  SourceStatusKind,
} from './types';

const SOURCE_PROBE_CACHE_VERSION = 'v1';
const SOURCE_PROBE_POSITIVE_TTL_SECONDS = 10 * 60;
const SOURCE_PROBE_NEGATIVE_TTL_SECONDS = 2 * 60;
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

export interface SourcePreferenceProbeResult extends SourceProbeMetrics {
  sourceKey: string;
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
  headers.set('Accept', '*/*');

  return headers;
}

function isCorsAccessible(response: Response, origin: string): boolean {
  const allowOrigin = response.headers.get('access-control-allow-origin');
  if (!allowOrigin) return false;
  if (allowOrigin === '*') return true;

  return allowOrigin
    .split(',')
    .map((value) => value.trim())
    .includes(origin);
}

function getFirstPlaylistTarget(
  content: string,
  baseUrl: string
): string | null {
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    return buildAbsoluteUrl(line, baseUrl);
  }

  return null;
}

async function probeNestedTarget(
  targetUrl: string,
  origin: string
): Promise<{ ok: boolean; corsAccessible: boolean; status: number }> {
  const isNestedPlaylist = targetUrl.toLowerCase().includes('.m3u8');
  const response = await fetch(targetUrl, {
    headers: buildUpstreamHeaders(
      targetUrl,
      isNestedPlaylist ? null : 'bytes=0-1'
    ),
    redirect: 'follow',
  });

  return {
    ok: response.ok || response.status === 206,
    corsAccessible: isCorsAccessible(response, origin),
    status: response.status,
  };
}

function getCloudflareCache(): Cache | null {
  const cacheApi = (globalThis as { caches?: CacheStorage & { default?: Cache } })
    .caches;

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

function getStatusPriority(kind: SourceStatusKind | SourceProbeResult['kind']): number {
  switch (kind) {
    case 'direct':
      return 0;
    case 'proxy':
      return 1;
    case 'playable':
      return 2;
    case 'unavailable':
      return 3;
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
  origin: string
): Promise<SourceProbeMetrics> {
  const startedAt = Date.now();

  try {
    const upstreamResponse = await fetch(targetUrl, {
      headers: buildUpstreamHeaders(targetUrl),
      redirect: 'follow',
    });

    const probeTimeMs = Date.now() - startedAt;
    const domain = new URL(targetUrl).hostname.toLowerCase();

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      return {
        kind: 'unavailable',
        reason: `上游响应失败: ${upstreamResponse.status}`,
        domain,
        upstreamStatus: upstreamResponse.status,
        probeTimeMs,
      };
    }

    const playlistResponse = isPlaylistResponse(
      targetUrl,
      upstreamResponse.headers.get('content-type')
    );
    const playlistCorsAccessible = isCorsAccessible(upstreamResponse, origin);

    if (!playlistResponse) {
      return {
        kind: playlistCorsAccessible ? 'direct' : 'proxy',
        reason: playlistCorsAccessible
          ? '媒体地址可直接跨域访问'
          : '媒体地址可拉取，但浏览器跨域受限',
        domain,
        upstreamStatus: upstreamResponse.status,
        probeTimeMs,
      };
    }

    const playlistContent = await upstreamResponse.text();
    const nextTarget = getFirstPlaylistTarget(playlistContent, targetUrl);

    if (!nextTarget) {
      return {
        kind: playlistCorsAccessible ? 'direct' : 'proxy',
        reason: playlistCorsAccessible
          ? '播放列表可直接访问'
          : '播放列表缺少跨域头，需走代理',
        domain,
        upstreamStatus: upstreamResponse.status,
        probeTimeMs,
      };
    }

    const nestedProbe = await probeNestedTarget(nextTarget, origin);

    if (!nestedProbe.ok) {
      return {
        kind: 'unavailable',
        reason: `首个媒体片段不可达: ${nestedProbe.status}`,
        domain,
        upstreamStatus: nestedProbe.status,
        probeTimeMs: Date.now() - startedAt,
      };
    }

    const canDirect = playlistCorsAccessible && nestedProbe.corsAccessible;
    return {
      kind: canDirect ? 'direct' : 'proxy',
      reason: canDirect
        ? '播放列表和首个媒体片段都支持浏览器直连'
        : '上游可用，但至少一层缺少浏览器跨域头，建议走代理',
      domain,
      upstreamStatus: upstreamResponse.status,
      probeTimeMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : '探测失败',
      probeTimeMs: Date.now() - startedAt,
    };
  }
}

export async function probeSourcePlaybackWithCache(
  targetUrl: string,
  origin: string
): Promise<SourceProbeMetrics> {
  const cache = getCloudflareCache();
  const cacheRequest = buildProbeCacheRequest(targetUrl, origin);

  if (cache) {
    const cachedResponse = await cache.match(cacheRequest);
    if (cachedResponse) {
      const cachedPayload =
        (await cachedResponse.json().catch(() => null)) as SourceProbeMetrics | null;
      if (cachedPayload) {
        return {
          ...cachedPayload,
          cacheState: 'hit',
        };
      }
    }
  }

  const freshResult = await probeSourcePlaybackUpstream(targetUrl, origin);

  if (cache) {
    const ttl = getProbeCacheTtl(freshResult);
    await cache.put(
      cacheRequest,
      new Response(JSON.stringify(freshResult), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `public, max-age=${ttl}`,
        },
      })
    );
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

export function sortSourcePreferenceResults<T extends SourcePreferenceProbeResult>(
  results: T[]
): T[] {
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
