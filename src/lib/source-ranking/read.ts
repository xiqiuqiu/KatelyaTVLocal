import { formatSourceSpeedKbps } from '@/lib/source-preference-video-info';
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
  startupSuccess: number;
  startupTimeMs: number | null;
  switchedToProxy: number;
  browserQuality: string | null;
  browserPingMs: number | null;
  browserSpeedLabel: string | null;
  sessionError: string | null;
  recordedAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_LOOKBACK_MS = 7 * DAY_MS;
const FEEDBACK_ONLY_BASE_RANK_SCORE = 50;

function getSourceRankingDatabase(env?: RuntimeSource): D1DatabaseLike | null {
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

function getFeedbackRankAdjustment(rows: PlaybackFeedbackRow[]): number {
  return rows.reduce((score, row) => {
    let next = score;
    if (row.startupSuccess) {
      next += 4;
    } else {
      next -= 14;
    }

    if (typeof row.startupTimeMs === 'number') {
      if (row.startupSuccess && row.startupTimeMs < 2500) {
        next += 4;
      }

      if (row.startupTimeMs > 5000) {
        next -= 6;
      }
    }

    if (row.switchedToProxy) {
      next -= 4;
    }

    return next;
  }, 0);
}

function getFreshnessRankAdjustment(updatedAt: number, now: number): number {
  const ageDays = Math.max(0, (now - updatedAt) / DAY_MS);
  if (ageDays <= 1) {
    return 0;
  }

  return -Number(Math.min(8, (ageDays - 1) * 1.5).toFixed(2));
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

function inferKindFromFeedback(
  feedback: PlaybackFeedbackRow
): SourcePreferenceResult['kind'] {
  if (!feedback.startupSuccess) {
    return 'unavailable';
  }

  return feedback.switchedToProxy ? 'proxy' : 'direct';
}

function getFeedbackOnlyReason(feedback: PlaybackFeedbackRow): string {
  if (!feedback.startupSuccess) {
    return feedback.sessionError || '近期本机播放失败';
  }

  return feedback.switchedToProxy
    ? '近期本机播放成功，更适合代理'
    : '近期本机播放成功，优先直连';
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
  const cutoffTime = now - SNAPSHOT_LOOKBACK_MS;
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
             startup_success AS startupSuccess,
             startup_time_ms AS startupTimeMs,
             switched_to_proxy AS switchedToProxy,
             browser_quality AS browserQuality,
             browser_ping_ms AS browserPingMs,
             browser_speed_label AS browserSpeedLabel,
             session_error AS sessionError,
             recorded_at AS recordedAt
           FROM playback_feedback_events
           WHERE source_key IN (${placeholders})
             AND recorded_at >= ?
           ORDER BY recorded_at DESC`
        )
        .bind(...sourceKeys, cutoffTime)
        .all<PlaybackFeedbackRow>()
    ).results || [];

  const latestProbeByKey = dedupeLatestByKey(probeRows);
  const latestAnyFeedbackByKey = dedupeLatestByKey(feedbackRows);
  const latestFeedbackByKey = dedupeLatestByKey(
    feedbackRows.filter((row) => Boolean(row.startupSuccess))
  );
  const feedbackRowsByKey = new Map<string, PlaybackFeedbackRow[]>();
  feedbackRows.forEach((row) => {
    const rows = feedbackRowsByKey.get(row.sourceKey) || [];
    rows.push(row);
    feedbackRowsByKey.set(row.sourceKey, rows);
  });
  const seenKeys = new Set<string>();

  const snapshotResults = snapshotRows
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
      const feedbackAdjustment = getFeedbackRankAdjustment(
        feedbackRowsByKey.get(snapshot.sourceKey) || []
      );
      const freshnessAdjustment = getFreshnessRankAdjustment(
        snapshot.updatedAt,
        now
      );

      return {
        sourceKey: snapshot.sourceKey,
        kind,
        reason: probe?.reason || getDefaultReason(kind, snapshot),
        domain:
          probe?.domain || feedback?.playbackDomain || snapshot.playbackDomain,
        probeTimeMs: probe?.probeTimeMs ?? undefined,
        qualityLabel:
          feedback?.browserQuality || probe?.resolutionLabel || null,
        speedLabel:
          feedback?.browserSpeedLabel ||
          formatSourceSpeedKbps(probe?.firstSegmentSpeedKbps) ||
          null,
        pingTimeMs:
          feedback?.browserPingMs ??
          probe?.firstSegmentLatencyMs ??
          probe?.probeTimeMs ??
          null,
        latencyMs: probe?.firstSegmentLatencyMs ?? null,
        speedKbps: probe?.firstSegmentSpeedKbps ?? null,
        updatedAt: Math.max(
          snapshot.updatedAt,
          probe?.measuredAt || 0,
          feedbackRowsByKey.get(snapshot.sourceKey)?.[0]?.recordedAt || 0
        ),
        rankingSource: 'd1',
        rankScore: Number(
          (
            snapshot.finalScore +
            feedbackAdjustment +
            freshnessAdjustment
          ).toFixed(2)
        ),
      } satisfies SourcePreferenceResult;
    });

  const feedbackOnlyResults = sourceKeys
    .filter((sourceKey) => !seenKeys.has(sourceKey))
    .map((sourceKey): SourcePreferenceResult | null => {
      const latestFeedback = latestAnyFeedbackByKey.get(sourceKey);
      if (!latestFeedback) {
        return null;
      }

      const successfulFeedback = latestFeedback.startupSuccess
        ? latestFeedback
        : latestFeedbackByKey.get(sourceKey);
      const rows = feedbackRowsByKey.get(sourceKey) || [];
      const kind = inferKindFromFeedback(latestFeedback);
      const feedbackAdjustment = getFeedbackRankAdjustment(rows);
      const freshnessAdjustment = getFreshnessRankAdjustment(
        latestFeedback.recordedAt,
        now
      );

      return {
        sourceKey,
        kind,
        reason: getFeedbackOnlyReason(latestFeedback),
        domain:
          latestFeedback.playbackDomain ||
          successfulFeedback?.playbackDomain ||
          null,
        probeTimeMs: undefined,
        qualityLabel:
          latestFeedback.startupSuccess && successfulFeedback
            ? successfulFeedback.browserQuality || null
            : null,
        speedLabel:
          latestFeedback.startupSuccess && successfulFeedback
            ? successfulFeedback.browserSpeedLabel || null
            : null,
        pingTimeMs:
          latestFeedback.startupSuccess && successfulFeedback
            ? successfulFeedback.browserPingMs ?? null
            : null,
        latencyMs: null,
        speedKbps: null,
        updatedAt: latestFeedback.recordedAt,
        rankingSource: 'd1',
        rankScore: Number(
          (
            FEEDBACK_ONLY_BASE_RANK_SCORE +
            feedbackAdjustment +
            freshnessAdjustment
          ).toFixed(2)
        ),
      } satisfies SourcePreferenceResult;
    })
    .filter((result): result is SourcePreferenceResult => result !== null);

  return [...snapshotResults, ...feedbackOnlyResults];
}
