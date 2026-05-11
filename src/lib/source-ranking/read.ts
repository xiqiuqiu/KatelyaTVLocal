import { SourcePreferenceResult } from '@/lib/types';

interface D1QueryResult<T> {
  results?: T[];
}

interface D1Statement {
  bind: (...values: unknown[]) => {
    all: <T = unknown>() => Promise<D1QueryResult<T>>;
  };
}

interface D1DatabaseLike {
  prepare: (query: string) => D1Statement;
}

type RuntimeSource = Record<string, unknown>;

interface SourceRankSnapshotRow {
  sourceKey: string;
  playbackDomain: string | null;
  finalScore: number;
  successRate: number;
  directRate: number;
  proxyRate: number;
  unavailableRate: number;
  updatedAt: number;
}

interface SourceProbeRow {
  sourceKey: string;
  domain: string | null;
  kind: 'direct' | 'proxy' | 'unavailable';
  reason: string | null;
  probeTimeMs: number | null;
  resolutionLabel: string | null;
  firstSegmentLatencyMs: number | null;
  firstSegmentSpeedKbps: number | null;
  measuredAt: number;
}

interface PlaybackFeedbackRow {
  sourceKey: string;
  playbackDomain: string | null;
  browserQuality: string | null;
  browserPingMs: number | null;
  browserSpeedLabel: string | null;
  recordedAt: number;
}

function getSourceRankingDatabase(
  env?: RuntimeSource
): D1DatabaseLike | null {
  const source = env || (process.env as unknown as RuntimeSource);
  const db = source.DB;

  if (
    db &&
    typeof db === 'object' &&
    typeof (db as D1DatabaseLike).prepare === 'function'
  ) {
    return db as D1DatabaseLike;
  }

  return null;
}

function buildPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function dedupeLatestByKey<T extends { sourceKey: string }>(
  rows: T[]
): Map<string, T> {
  const latestByKey = new Map<string, T>();

  rows.forEach((row) => {
    if (!latestByKey.has(row.sourceKey)) {
      latestByKey.set(row.sourceKey, row);
    }
  });

  return latestByKey;
}

function inferKindFromSnapshot(
  snapshot: SourceRankSnapshotRow
): SourcePreferenceResult['kind'] {
  if (snapshot.unavailableRate >= 100) {
    return 'unavailable';
  }

  if (snapshot.directRate >= snapshot.proxyRate) {
    return 'direct';
  }

  return 'proxy';
}

function getDefaultReason(
  kind: SourcePreferenceResult['kind'],
  snapshot: SourceRankSnapshotRow
): string {
  switch (kind) {
    case 'direct':
      return `近期成功率 ${snapshot.successRate.toFixed(0)}%，优先直连`;
    case 'proxy':
      return `近期成功率 ${snapshot.successRate.toFixed(0)}%，更适合代理`;
    case 'unavailable':
    default:
      return `近期不可用率 ${snapshot.unavailableRate.toFixed(0)}%`;
  }
}

export async function readLatestSourceRanks(
  env: RuntimeSource | undefined,
  sourceKeys: string[],
  windowKey = '24h',
  now = Date.now()
): Promise<SourcePreferenceResult[]> {
  if (sourceKeys.length === 0) {
    return [];
  }

  const db = getSourceRankingDatabase(env);
  if (!db) {
    return [];
  }

  const placeholders = buildPlaceholders(sourceKeys.length);
  const cutoffTime = now - 24 * 60 * 60 * 1000;
  const snapshotRows =
    (
      await db
        .prepare(
          `SELECT
             source_key AS sourceKey,
             playback_domain AS playbackDomain,
             final_score AS finalScore,
             success_rate AS successRate,
             direct_rate AS directRate,
             proxy_rate AS proxyRate,
             unavailable_rate AS unavailableRate,
             updated_at AS updatedAt
           FROM source_rank_snapshots
           WHERE window_key = ?
             AND updated_at >= ?
             AND source_key IN (${placeholders})
           ORDER BY final_score DESC, updated_at DESC`
        )
        .bind(windowKey, cutoffTime, ...sourceKeys)
        .all<SourceRankSnapshotRow>()
    ).results || [];

  if (snapshotRows.length === 0) {
    return [];
  }

  const probeRows =
    (
      await db
        .prepare(
          `SELECT
             source_key AS sourceKey,
             playback_domain AS domain,
             probe_kind AS kind,
             probe_reason AS reason,
             probe_time_ms AS probeTimeMs,
             resolution_label AS resolutionLabel,
             first_segment_latency_ms AS firstSegmentLatencyMs,
             first_segment_speed_kbps AS firstSegmentSpeedKbps,
             measured_at AS measuredAt
           FROM source_probe_results
           WHERE source_key IN (${placeholders})
             AND measured_at >= ?
           ORDER BY measured_at DESC`
        )
        .bind(...sourceKeys, cutoffTime)
        .all<SourceProbeRow>()
    ).results || [];

  const feedbackRows =
    (
      await db
        .prepare(
          `SELECT
             source_key AS sourceKey,
             playback_domain AS playbackDomain,
             browser_quality AS browserQuality,
             browser_ping_ms AS browserPingMs,
             browser_speed_label AS browserSpeedLabel,
             recorded_at AS recordedAt
           FROM playback_feedback_events
           WHERE source_key IN (${placeholders})
             AND startup_success = 1
             AND recorded_at >= ?
           ORDER BY recorded_at DESC`
        )
        .bind(...sourceKeys, cutoffTime)
        .all<PlaybackFeedbackRow>()
    ).results || [];

  const latestProbeByKey = dedupeLatestByKey(probeRows);
  const latestFeedbackByKey = dedupeLatestByKey(feedbackRows);
  const seenKeys = new Set<string>();

  return snapshotRows
    .filter((row) => {
      if (seenKeys.has(row.sourceKey)) {
        return false;
      }

      seenKeys.add(row.sourceKey);
      return true;
    })
    .map((snapshot) => {
      const probe = latestProbeByKey.get(snapshot.sourceKey);
      const feedback = latestFeedbackByKey.get(snapshot.sourceKey);
      const kind = probe?.kind || inferKindFromSnapshot(snapshot);

      return {
        sourceKey: snapshot.sourceKey,
        kind,
        reason: probe?.reason || getDefaultReason(kind, snapshot),
        domain:
          probe?.domain || feedback?.playbackDomain || snapshot.playbackDomain,
        probeTimeMs: probe?.probeTimeMs ?? undefined,
        qualityLabel:
          feedback?.browserQuality || probe?.resolutionLabel || null,
        speedLabel: feedback?.browserSpeedLabel || null,
        pingTimeMs: feedback?.browserPingMs ?? null,
        latencyMs: probe?.firstSegmentLatencyMs ?? null,
        speedKbps: probe?.firstSegmentSpeedKbps ?? null,
        updatedAt: Math.max(
          snapshot.updatedAt,
          probe?.measuredAt || 0,
          feedback?.recordedAt || 0
        ),
        rankingSource: 'd1',
        rankScore: snapshot.finalScore,
      } satisfies SourcePreferenceResult;
    });
}
