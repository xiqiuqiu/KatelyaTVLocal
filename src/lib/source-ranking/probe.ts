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

function createProbeResultId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `probe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function probePlaybackForRanking(
  episodeUrl: string,
  origin: string
): Promise<OfflineProbeResult> {
  const result = await probeSourcePlaybackUpstream(episodeUrl, origin);

  return {
    kind: result.kind,
    reason: result.reason,
    domain: result.domain,
    upstreamStatus: result.upstreamStatus,
    probeTimeMs: result.probeTimeMs,
    resolutionLabel: null,
    firstSegmentLatencyMs: null,
    firstSegmentSpeedKbps: null,
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
