import { probeSourcePlaybackUpstream } from '@/lib/source-preference';

export interface OfflineProbeResult {
  kind: 'direct' | 'proxy' | 'unavailable';
  reason?: string;
  domain?: string | null;
  upstreamStatus?: number;
  probeTimeMs?: number;
  resolutionLabel?: string | null;
  firstSegmentLatencyMs?: number | null;
  firstSegmentSpeedKbps?: number | null;
}

export interface OfflineProbeTask {
  sourceKey: string;
  sourceName: string;
  titleSample: string;
  episodeUrl: string;
}

interface D1Statement {
  bind: (...values: unknown[]) => {
    run: () => Promise<unknown>;
  };
}

interface D1DatabaseLike {
  prepare: (query: string) => D1Statement;
}

interface SourceProbeEnvLike {
  DB: D1DatabaseLike;
}

interface HlsVariantCandidate {
  uri: string;
  resolutionHeight: number | null;
}

interface HlsProbeMetrics {
  resolutionLabel: string | null;
  firstSegmentLatencyMs: number | null;
  firstSegmentSpeedKbps: number | null;
}

const DEFAULT_HLS_PROBE_TIMEOUT_MS = 4000;
const FIRST_SEGMENT_RANGE_BYTES = 256 * 1024;

function createProbeResultId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `probe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortController === 'undefined') {
    return undefined;
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

function getRemainingTimeout(deadline: number): number {
  return Math.max(250, deadline - Date.now());
}

function buildProbeHeaders(url: string, range?: string): HeadersInit {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  };

  try {
    headers.Referer = new URL(url).origin;
  } catch {
    // Keep the request usable even when the upstream URL is malformed.
  }

  if (range) {
    headers.Range = range;
  }

  return headers;
}

function resolvePlaylistUrl(uri: string, baseUrl: string): string | null {
  try {
    return new URL(uri, baseUrl).toString();
  } catch {
    return null;
  }
}

function parseResolutionHeight(attributes: string): number | null {
  const match = attributes.match(/RESOLUTION=(\d+)x(\d+)/i);
  if (!match) {
    return null;
  }

  const height = Number(match[2]);
  return Number.isFinite(height) ? height : null;
}

function getResolutionLabel(height: number | null): string | null {
  if (!height) {
    return null;
  }

  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  return 'SD';
}

function parseMasterPlaylist(
  content: string,
  baseUrl: string
): HlsVariantCandidate | null {
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const variants: HlsVariantCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('#EXT-X-STREAM-INF')) {
      continue;
    }

    const resolutionHeight = parseResolutionHeight(line);
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const uri = lines[nextIndex];
      if (!uri || uri.startsWith('#')) {
        continue;
      }

      const resolved = resolvePlaylistUrl(uri, baseUrl);
      if (resolved) {
        variants.push({ uri: resolved, resolutionHeight });
      }
      break;
    }
  }

  if (variants.length === 0) {
    return null;
  }

  return variants.sort(
    (left, right) =>
      (right.resolutionHeight || 0) - (left.resolutionHeight || 0)
  )[0];
}

function parseFirstMediaSegment(content: string, baseUrl: string): string | null {
  const lines = content.split(/\r?\n/).map((line) => line.trim());

  for (const line of lines) {
    if (!line || line.startsWith('#')) {
      continue;
    }

    return resolvePlaylistUrl(line, baseUrl);
  }

  return null;
}

async function fetchTextWithDeadline(
  url: string,
  deadline: number
): Promise<string | null> {
  const response = await fetch(url, {
    headers: buildProbeHeaders(url),
    redirect: 'follow',
    signal: createTimeoutSignal(getRemainingTimeout(deadline)),
  });

  if (!response.ok) {
    return null;
  }

  return response.text();
}

async function probeFirstSegment(
  segmentUrl: string,
  deadline: number
): Promise<Pick<
  HlsProbeMetrics,
  'firstSegmentLatencyMs' | 'firstSegmentSpeedKbps'
> | null> {
  const startedAt = Date.now();
  const response = await fetch(segmentUrl, {
    headers: buildProbeHeaders(
      segmentUrl,
      `bytes=0-${FIRST_SEGMENT_RANGE_BYTES - 1}`
    ),
    redirect: 'follow',
    signal: createTimeoutSignal(getRemainingTimeout(deadline)),
  });

  if (!response.ok) {
    return null;
  }

  const buffer = await response.arrayBuffer();
  const latencyMs = Math.max(1, Date.now() - startedAt);
  const speedKbps = Number(
    (((buffer.byteLength * 8) / latencyMs) * 1000 / 1000).toFixed(2)
  );

  return {
    firstSegmentLatencyMs: latencyMs,
    firstSegmentSpeedKbps: speedKbps,
  };
}

async function probeHlsMetrics(
  episodeUrl: string,
  timeoutMs = DEFAULT_HLS_PROBE_TIMEOUT_MS
): Promise<HlsProbeMetrics> {
  const emptyMetrics: HlsProbeMetrics = {
    resolutionLabel: null,
    firstSegmentLatencyMs: null,
    firstSegmentSpeedKbps: null,
  };
  const deadline = Date.now() + timeoutMs;

  try {
    const playlist = await fetchTextWithDeadline(episodeUrl, deadline);
    if (!playlist) {
      return emptyMetrics;
    }

    const variant = parseMasterPlaylist(playlist, episodeUrl);
    const mediaPlaylistUrl = variant?.uri || episodeUrl;
    const mediaPlaylist = variant
      ? await fetchTextWithDeadline(mediaPlaylistUrl, deadline)
      : playlist;
    if (!mediaPlaylist) {
      return {
        ...emptyMetrics,
        resolutionLabel: getResolutionLabel(variant?.resolutionHeight || null),
      };
    }

    const segmentUrl = parseFirstMediaSegment(mediaPlaylist, mediaPlaylistUrl);
    if (!segmentUrl) {
      return {
        ...emptyMetrics,
        resolutionLabel: getResolutionLabel(variant?.resolutionHeight || null),
      };
    }

    const segmentMetrics = await probeFirstSegment(segmentUrl, deadline);
    return {
      resolutionLabel: getResolutionLabel(variant?.resolutionHeight || null),
      firstSegmentLatencyMs: segmentMetrics?.firstSegmentLatencyMs ?? null,
      firstSegmentSpeedKbps: segmentMetrics?.firstSegmentSpeedKbps ?? null,
    };
  } catch {
    return emptyMetrics;
  }
}

export async function probePlaybackForRanking(
  episodeUrl: string,
  origin: string
): Promise<OfflineProbeResult> {
  const result = await probeSourcePlaybackUpstream(episodeUrl, origin);
  const hlsMetrics =
    result.kind === 'unavailable'
      ? {
          resolutionLabel: null,
          firstSegmentLatencyMs: null,
          firstSegmentSpeedKbps: null,
        }
      : await probeHlsMetrics(episodeUrl);

  return {
    kind: result.kind,
    reason: result.reason,
    domain: result.domain,
    upstreamStatus: result.upstreamStatus,
    probeTimeMs: result.probeTimeMs,
    resolutionLabel: hlsMetrics.resolutionLabel,
    firstSegmentLatencyMs: hlsMetrics.firstSegmentLatencyMs,
    firstSegmentSpeedKbps: hlsMetrics.firstSegmentSpeedKbps,
  };
}

export async function persistOfflineProbeResult(
  env: SourceProbeEnvLike,
  runId: string,
  task: OfflineProbeTask,
  result: OfflineProbeResult,
  measuredAt = Date.now()
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO source_probe_results
     (id, run_id, source_key, source_name, title_sample, episode_url, playback_domain, probe_kind, probe_reason, upstream_status, probe_time_ms, resolution_label, first_segment_latency_ms, first_segment_speed_kbps, measured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      createProbeResultId(),
      runId,
      task.sourceKey,
      task.sourceName,
      task.titleSample,
      task.episodeUrl,
      result.domain ?? null,
      result.kind,
      result.reason ?? null,
      result.upstreamStatus ?? null,
      result.probeTimeMs ?? null,
      result.resolutionLabel ?? null,
      result.firstSegmentLatencyMs ?? null,
      result.firstSegmentSpeedKbps ?? null,
      measuredAt
    )
    .run();
}
