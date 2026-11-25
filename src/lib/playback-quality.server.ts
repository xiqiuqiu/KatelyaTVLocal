import type { D1DatabaseLike } from '@/lib/d1';
import { getD1Database } from '@/lib/d1';
import type { PlaybackQualitySample } from '@/lib/playback-quality';
import {
  type SourceRankingExperimentPolicy,
  SOURCE_RANKING_EXPERIMENT_POLICIES,
} from '@/lib/source-ranking/experiment';

const DAY_MS = 86_400_000;
const DAILY_ROW_LIMIT = 2000;

export function playbackQualityDayKey(now: number): string {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const PLAYBACK_QUALITY_UPSERT_SQL = `
INSERT INTO playback_quality (
  owner, session_id, round_id, root_round_id, row_kind, attempt_id, seq,
  status, outcome, content_key, episode_index, source_key, platform, runtime, entry_kind,
  round_reason, source_reason, release_id, policy_version, elapsed_ms, active_wait_ms,
  click_to_frame_ms, page_to_frame_ms, source_to_frame_ms, frame_evidence,
  had_hidden, autoplay_blocked, prompt_choice, next_round_id, day_key, received_at, updated_at, test_session
)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
WHERE (SELECT COUNT(*) FROM playback_quality WHERE owner = ? AND day_key = ?) < ?
   OR EXISTS (SELECT 1 FROM playback_quality
              WHERE owner = ? AND session_id = ? AND round_id = ? AND row_kind = ? AND attempt_id = ?)
ON CONFLICT(owner, session_id, round_id, row_kind, attempt_id) DO UPDATE SET
  seq = excluded.seq,
  status = CASE WHEN playback_quality.status = 'terminal' THEN playback_quality.status ELSE excluded.status END,
  outcome = CASE WHEN playback_quality.status = 'terminal' THEN playback_quality.outcome ELSE excluded.outcome END,
  content_key = CASE WHEN playback_quality.status = 'terminal' THEN playback_quality.content_key ELSE excluded.content_key END,
  episode_index = CASE WHEN playback_quality.status = 'terminal' THEN playback_quality.episode_index ELSE excluded.episode_index END,
  source_key = CASE WHEN playback_quality.status = 'terminal' THEN playback_quality.source_key ELSE excluded.source_key END,
  elapsed_ms = CASE WHEN playback_quality.status = 'terminal' THEN playback_quality.elapsed_ms ELSE excluded.elapsed_ms END,
  active_wait_ms = CASE WHEN playback_quality.status = 'terminal' THEN playback_quality.active_wait_ms ELSE excluded.active_wait_ms END,
  click_to_frame_ms = CASE WHEN playback_quality.status = 'terminal' THEN playback_quality.click_to_frame_ms ELSE excluded.click_to_frame_ms END,
  page_to_frame_ms = CASE WHEN playback_quality.status = 'terminal' THEN playback_quality.page_to_frame_ms ELSE excluded.page_to_frame_ms END,
  source_to_frame_ms = CASE WHEN playback_quality.status = 'terminal' THEN playback_quality.source_to_frame_ms ELSE excluded.source_to_frame_ms END,
  frame_evidence = CASE WHEN playback_quality.status = 'terminal' THEN playback_quality.frame_evidence ELSE excluded.frame_evidence END,
  had_hidden = MAX(playback_quality.had_hidden, excluded.had_hidden),
  autoplay_blocked = MAX(playback_quality.autoplay_blocked, excluded.autoplay_blocked),
  prompt_choice = excluded.prompt_choice,
  next_round_id = excluded.next_round_id,
  updated_at = excluded.updated_at
WHERE excluded.seq > playback_quality.seq
  AND excluded.root_round_id = playback_quality.root_round_id
  AND (playback_quality.row_kind = 'round' OR excluded.episode_index = playback_quality.episode_index)
  AND excluded.test_session = playback_quality.test_session
  AND excluded.platform = playback_quality.platform
  AND excluded.runtime = playback_quality.runtime
  AND excluded.entry_kind = playback_quality.entry_kind
  AND excluded.round_reason = playback_quality.round_reason
  AND excluded.source_reason IS playback_quality.source_reason
  AND excluded.release_id = playback_quality.release_id
  AND excluded.policy_version = playback_quality.policy_version
  AND (playback_quality.row_kind = 'round' OR excluded.source_key IS playback_quality.source_key)
  AND ((playback_quality.status = 'pending'
        AND excluded.elapsed_ms >= playback_quality.elapsed_ms
        AND excluded.active_wait_ms >= playback_quality.active_wait_ms)
    OR (playback_quality.status = 'terminal' AND excluded.status = 'terminal'
        AND excluded.outcome = playback_quality.outcome
        AND playback_quality.row_kind = 'round' AND playback_quality.outcome = 'budget-exhausted'
        AND excluded.prompt_choice IN ('continue', 'manual', 'leave')
        AND (excluded.next_round_id IS NULL
          OR (excluded.prompt_choice IN ('continue', 'manual') AND excluded.next_round_id > playback_quality.round_id))
        AND ((playback_quality.prompt_choice IS NULL AND playback_quality.next_round_id IS NULL)
          OR (playback_quality.prompt_choice = excluded.prompt_choice
            AND playback_quality.next_round_id IS NULL AND excluded.next_round_id IS NOT NULL))
        AND excluded.elapsed_ms = playback_quality.elapsed_ms
        AND excluded.active_wait_ms = playback_quality.active_wait_ms
        AND excluded.click_to_frame_ms IS playback_quality.click_to_frame_ms
        AND excluded.page_to_frame_ms IS playback_quality.page_to_frame_ms
        AND excluded.source_to_frame_ms IS playback_quality.source_to_frame_ms
        AND excluded.frame_evidence IS playback_quality.frame_evidence))
RETURNING seq`;

export const PLAYBACK_QOE_UPSERT_SQL = `
INSERT INTO playback_qoe (
  owner, session_id, visit, seq, test_session, uninterrupted, recovered, failed,
  day_key, received_at
)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
WHERE (SELECT COUNT(*) FROM playback_qoe WHERE owner = ? AND day_key = ?) < ?
   OR EXISTS (SELECT 1 FROM playback_qoe WHERE owner = ? AND session_id = ? AND visit = ?)
ON CONFLICT(owner, session_id, visit) DO UPDATE SET
  seq = excluded.seq,
  uninterrupted = COALESCE(playback_qoe.uninterrupted, excluded.uninterrupted),
  recovered = excluded.recovered,
  failed = excluded.failed
WHERE excluded.seq > playback_qoe.seq
  AND excluded.test_session = playback_qoe.test_session
  AND (playback_qoe.uninterrupted IS NULL OR excluded.uninterrupted IS playback_qoe.uninterrupted)
  AND excluded.recovered >= playback_qoe.recovered
  AND excluded.failed >= playback_qoe.failed
RETURNING seq`;

// Each stage implies its predecessors, including when keepalive requests arrive out of order.
export const HOME_BANNER_UPSERT_SQL = `
INSERT INTO home_banner_visits(day_key, test_session, owner, session_id, stage)
SELECT ?1, ?2, ?3, ?4, ?5
WHERE EXISTS (SELECT 1 FROM home_banner_visits
  WHERE day_key=?1 AND test_session=?2 AND owner=?3 AND session_id=?4)
OR NOT EXISTS (SELECT 1 FROM home_banner_visits WHERE day_key=?1 AND test_session=?2 LIMIT 1 OFFSET 499)
ON CONFLICT(day_key, test_session, owner, session_id) DO UPDATE SET stage=excluded.stage
WHERE excluded.stage > home_banner_visits.stage`;

export const HOME_BANNER_COUNTS_SQL = `
SELECT COUNT(*) AS impressions, COUNT(CASE WHEN stage >= 2 THEN 1 END) AS clicks,
  COUNT(CASE WHEN stage = 3 THEN 1 END) AS watched
FROM home_banner_visits WHERE day_key >= ? AND test_session = ?`;

export async function savePlaybackQuality(
  env: Record<string, unknown>,
  owner: string,
  records: PlaybackQualitySample[],
  now = Date.now()
): Promise<'saved' | 'no-d1' | 'quota'> {
  const db = getD1Database(env);
  if (!db) return 'no-d1';
  const dayKey = playbackQualityDayKey(now);
  for (const record of records) {
    if (record.rowKind === 'banner') {
      if (record.startedAt < now - DAY_MS || record.startedAt > now + 300_000)
        continue;
      await db
        .prepare(HOME_BANNER_UPSERT_SQL)
        .bind(
          playbackQualityDayKey(record.startedAt),
          Number(record.testSession),
          owner,
          record.sessionId,
          record.seq
        )
        .run();
      continue;
    }
    if (record.rowKind === 'qoe') {
      const result = await db
        .prepare(PLAYBACK_QOE_UPSERT_SQL)
        .bind(
          owner,
          record.sessionId,
          record.visit,
          record.seq,
          Number(record.testSession),
          record.uninterrupted === null ? null : Number(record.uninterrupted),
          record.recovered,
          record.failed,
          dayKey,
          now,
          owner,
          dayKey,
          DAILY_ROW_LIMIT,
          owner,
          record.sessionId,
          record.visit
        )
        .first();
      if (!result) {
        const existing = await db
          .prepare(
            'SELECT 1 FROM playback_qoe WHERE owner = ? AND session_id = ? AND visit = ?'
          )
          .bind(owner, record.sessionId, record.visit)
          .first();
        if (!existing) return 'quota';
      }
      continue;
    }
    const result = await db
      .prepare(PLAYBACK_QUALITY_UPSERT_SQL)
      .bind(
        owner,
        record.sessionId,
        record.roundId,
        record.rootRoundId,
        record.rowKind,
        record.attemptId,
        record.seq,
        record.status,
        record.outcome,
        record.contentKey,
        record.episodeIndex,
        record.sourceKey,
        record.platform,
        record.runtime,
        record.entryKind,
        record.roundReason,
        record.sourceReason,
        record.releaseId,
        record.policyVersion,
        record.elapsedMs,
        record.activeWaitMs,
        record.clickToFrameMs,
        record.pageToFrameMs,
        record.sourceToFrameMs,
        record.frameEvidence,
        Number(record.hadHidden),
        Number(record.autoplayBlocked),
        record.promptChoice,
        record.nextRoundId,
        dayKey,
        now,
        now,
        Number(record.testSession ?? false),
        owner,
        dayKey,
        DAILY_ROW_LIMIT,
        owner,
        record.sessionId,
        record.roundId,
        record.rowKind,
        record.attemptId
      )
      .first<{ seq: number }>();
    if (!result) {
      const existing = await db
        .prepare(
          'SELECT 1 AS present FROM playback_quality WHERE owner = ? AND session_id = ? AND round_id = ? AND row_kind = ? AND attempt_id = ?'
        )
        .bind(
          owner,
          record.sessionId,
          record.roundId,
          record.rowKind,
          record.attemptId
        )
        .first();
      if (!existing) return 'quota';
    }
  }
  return 'saved';
}

export const PLAYBACK_QUALITY_COUNTS_SQL = `
WITH roots AS (
  SELECT r.*,
    EXISTS (SELECT 1 FROM playback_quality s WHERE s.owner = r.owner
      AND s.session_id = r.session_id AND s.root_round_id = r.round_id AND s.test_session = r.test_session
      AND s.row_kind = 'round' AND s.outcome = 'frame-ready') AS chain_success,
    (SELECT s.outcome FROM playback_quality s WHERE s.owner = r.owner
      AND s.session_id = r.session_id AND s.root_round_id = r.round_id AND s.test_session = r.test_session
      AND s.row_kind = 'round' ORDER BY s.round_id DESC LIMIT 1) AS latest_outcome,
    (SELECT s.prompt_choice FROM playback_quality s WHERE s.owner = r.owner
      AND s.session_id = r.session_id AND s.root_round_id = r.round_id AND s.test_session = r.test_session
      AND s.row_kind = 'round' ORDER BY s.round_id DESC LIMIT 1) AS latest_choice
  FROM playback_quality r WHERE r.row_kind = 'round' AND r.round_id = r.root_round_id AND r.day_key >= ? AND r.test_session = ?
)
SELECT day_key AS dayKey, release_id AS releaseId, platform, entry_kind AS entryKind,
  policy_version AS policyVersion, COUNT(*) AS starts,
  SUM(status = 'terminal') AS completed,
  SUM(COALESCE(outcome = 'frame-ready' AND active_wait_ms <= 30000, 0)) AS within30,
  SUM(COALESCE(outcome = 'frame-ready', 0)) AS firstRoundSuccess,
  SUM(COALESCE(outcome = 'budget-exhausted', 0)) AS budgetExhausted,
  SUM(COALESCE(outcome = 'abandoned', 0)) AS abandoned,
  SUM(COALESCE(outcome = 'user-intervened', 0)) AS userIntervened,
  SUM(COALESCE(outcome = 'failed', 0)) AS failed,
  SUM(COALESCE(prompt_choice = 'continue', 0)) AS choseContinue,
  SUM(COALESCE(prompt_choice = 'manual', 0)) AS choseManual,
  SUM(COALESCE(prompt_choice = 'leave', 0)) AS choseLeave,
  SUM(status = 'pending' AND updated_at >= ?) AS pending,
  SUM(status = 'pending' AND updated_at < ?) AS unobserved,
  SUM(chain_success) AS successfulChains,
  SUM(COALESCE(chain_success OR latest_outcome IN ('failed', 'abandoned', 'user-intervened') OR latest_choice = 'leave', 0)) AS completedChains
FROM roots GROUP BY day_key, release_id, platform, entry_kind, policy_version
ORDER BY day_key DESC, release_id, platform, entry_kind`;

export const PLAYBACK_QUALITY_LATENCY_SQL = `
WITH successes AS (
  SELECT r.day_key, r.release_id, r.platform, r.entry_kind, r.policy_version, s.*
  FROM playback_quality r JOIN playback_quality s ON s.owner = r.owner
    AND s.session_id = r.session_id AND s.root_round_id = r.round_id AND s.test_session = r.test_session AND s.row_kind = 'round'
  WHERE r.row_kind = 'round' AND r.round_id = r.root_round_id AND r.day_key >= ? AND r.test_session = ?
    AND s.outcome = 'frame-ready' AND s.had_hidden = 0 AND s.autoplay_blocked = 0
    AND s.round_id = (SELECT MIN(t.round_id) FROM playback_quality t WHERE t.owner = r.owner
      AND t.session_id = r.session_id AND t.root_round_id = r.round_id AND t.test_session = r.test_session AND t.row_kind = 'round'
      AND t.outcome = 'frame-ready')
), samples AS (
  SELECT day_key, release_id, platform, entry_kind, policy_version, frame_evidence,
    'clickToFrameMs' AS metric, click_to_frame_ms AS value FROM successes WHERE click_to_frame_ms IS NOT NULL
  UNION ALL SELECT day_key, release_id, platform, entry_kind, policy_version, frame_evidence,
    'pageToFrameMs', page_to_frame_ms FROM successes WHERE page_to_frame_ms IS NOT NULL
  UNION ALL SELECT day_key, release_id, platform, entry_kind, policy_version, frame_evidence,
    'activeWaitMs', active_wait_ms FROM successes
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY day_key, release_id, platform, entry_kind, policy_version, frame_evidence, metric ORDER BY value) AS rn,
    COUNT(*) OVER (PARTITION BY day_key, release_id, platform, entry_kind, policy_version, frame_evidence, metric) AS n FROM samples
)
SELECT day_key AS dayKey, release_id AS releaseId, platform, entry_kind AS entryKind,
  policy_version AS policyVersion, frame_evidence AS frameEvidence, metric, MAX(n) AS samples,
  MAX(CASE WHEN rn = (n * 50 + 99) / 100 THEN value END) AS p50,
  MAX(CASE WHEN rn = (n * 95 + 99) / 100 THEN value END) AS p95
FROM ranked GROUP BY day_key, release_id, platform, entry_kind, policy_version, frame_evidence, metric`;

export const PLAYBACK_QUALITY_SOURCES_SQL = `
SELECT day_key AS dayKey, release_id AS releaseId, platform, policy_version AS policyVersion,
  source_reason AS sourceReason, outcome, COUNT(*) AS attempts
FROM playback_quality WHERE row_kind = 'source' AND day_key >= ? AND test_session = ?
GROUP BY day_key, release_id, platform, policy_version, source_reason, outcome`;

export const PLAYBACK_QOE_COUNTS_SQL = `
SELECT COUNT(uninterrupted) AS observedVisits,
  COALESCE(SUM(uninterrupted), 0) AS uninterruptedVisits,
  COALESCE(SUM(recovered), 0) AS recovered,
  COALESCE(SUM(failed), 0) AS failed
FROM playback_qoe WHERE day_key >= ? AND test_session = ?`;

// Only the first automatically selected source carries an experiment policy.
export const SOURCE_RANKING_EXPERIMENT_SQL = `
WITH starts AS (
  SELECT s.owner, s.policy_version, s.outcome,
    (s.outcome IN ('frame-ready', 'source-timeout', 'network-error', 'media-error', 'failed')
      OR (s.outcome = 'cancelled' AND r.outcome IN ('budget-exhausted', 'failed'))) AS decided,
    CASE WHEN r.outcome = 'frame-ready' AND r.had_hidden = 0 AND r.autoplay_blocked = 0
      THEN r.click_to_frame_ms END AS click_ms,
    q.uninterrupted, COALESCE(q.recovered, 0) AS recovered, COALESCE(q.failed, 0) AS failed
  FROM playback_quality s
  LEFT JOIN playback_quality r ON r.owner = s.owner AND r.session_id = s.session_id
    AND r.round_id = s.round_id AND r.row_kind = 'round' AND r.attempt_id = 0
    AND r.test_session = s.test_session
  LEFT JOIN playback_qoe q ON q.owner = s.owner AND q.session_id = s.session_id
    AND q.visit = 1 AND q.test_session = s.test_session
  WHERE s.day_key >= ? AND s.test_session = ? AND s.policy_version IN (?, ?)
    AND s.row_kind = 'source' AND s.source_reason = 'initial' AND s.round_id = 1 AND s.root_round_id = 1
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY policy_version ORDER BY click_ms IS NULL, click_ms) AS rn,
    COUNT(click_ms) OVER (PARTITION BY policy_version) AS click_samples
  FROM starts
)
SELECT policy_version AS policyVersion, COUNT(*) AS starts, COUNT(DISTINCT owner) AS accounts,
  COUNT(CASE WHEN decided THEN 1 END) AS decidedStarts,
  COUNT(CASE WHEN outcome = 'frame-ready' THEN 1 END) AS firstSourceSuccesses,
  MAX(click_samples) AS clickSamples,
  MAX(CASE WHEN rn = (click_samples * 95 + 99) / 100 THEN click_ms END) AS clickP95Ms,
  COUNT(uninterrupted) AS observedVisits, COUNT(CASE WHEN uninterrupted = 1 THEN 1 END) AS uninterruptedVisits,
  SUM(recovered) AS recovered, SUM(failed) AS failed
FROM ranked GROUP BY policy_version`;

export async function readSourceRankingExperiment(
  env: Record<string, unknown>,
  days: number,
  now: number,
  testSession: boolean
) {
  const db = getD1Database(env);
  if (!db) return null;
  const cutoff = playbackQualityDayKey(now - (days - 1) * DAY_MS);
  const { results } = await db
    .prepare(SOURCE_RANKING_EXPERIMENT_SQL)
    .bind(
      cutoff,
      Number(testSession),
      SOURCE_RANKING_EXPERIMENT_POLICIES.control,
      SOURCE_RANKING_EXPERIMENT_POLICIES.ranking
    )
    .all<{
      policyVersion: SourceRankingExperimentPolicy;
      starts: number;
      accounts: number;
      decidedStarts: number;
      firstSourceSuccesses: number;
      clickSamples: number;
      clickP95Ms: number | null;
      observedVisits: number;
      uninterruptedVisits: number;
      recovered: number;
      failed: number;
    }>();
  return { experiment: results ?? [] };
}

interface QoeCounts {
  observedVisits: number;
  uninterruptedVisits: number;
  recovered: number;
  failed: number;
}

interface CountRow {
  completed: number;
  within30: number;
  completedChains: number;
  successfulChains: number;
}

async function readQualityMetrics(
  db: D1DatabaseLike,
  cutoff: string,
  cohort: number
) {
  const [qoeCounts, banner] = await Promise.all([
    db.prepare(PLAYBACK_QOE_COUNTS_SQL).bind(cutoff, cohort).first<QoeCounts>(),
    db
      .prepare(HOME_BANNER_COUNTS_SQL)
      .bind(cutoff, cohort)
      .first<{ impressions: number; clicks: number; watched: number }>(),
  ]);
  return {
    banner,
    qoe: qoeCounts && {
      ...qoeCounts,
      uninterruptedRate: qoeCounts.observedVisits
        ? qoeCounts.uninterruptedVisits / qoeCounts.observedVisits
        : null,
      recoverySuccessRate:
        qoeCounts.recovered + qoeCounts.failed
          ? qoeCounts.recovered / (qoeCounts.recovered + qoeCounts.failed)
          : null,
    },
  };
}

// A continuation or source retry belongs to the original playback start.
export const PLAYBACK_DASHBOARD_VISITS_SQL = `
WITH recent AS (
SELECT r.owner, r.session_id, r.round_id, r.test_session, r.rowid AS rootRow, r.received_at AS startedAt, COALESCE(s.content_key,r.content_key) AS contentKey,
  COALESCE(s.episode_index,r.episode_index) AS episodeIndex, s.source_key AS sourceKey,
  (s.rowid IS NOT NULL) AS started, COUNT(*) OVER () AS total,
  COUNT(s.rowid) OVER () AS successful
FROM playback_quality r
LEFT JOIN playback_quality s ON s.rowid = (
  SELECT a.rowid FROM playback_quality a
  WHERE a.owner=r.owner AND a.session_id=r.session_id AND a.root_round_id=r.round_id
    AND a.row_kind='round' AND a.test_session=r.test_session AND a.outcome='frame-ready'
  ORDER BY a.round_id LIMIT 1
)
WHERE r.day_key >= ? AND r.test_session=? AND r.row_kind='round' AND r.round_id=r.root_round_id
ORDER BY r.received_at DESC,r.rowid DESC LIMIT 30
)
SELECT recent.*, CASE WHEN started THEN 'started' ELSE (
  SELECT CASE
    WHEN a.status='pending' AND a.updated_at >= ?3 THEN 'waiting'
    WHEN a.outcome='failed' THEN 'failed'
    WHEN a.outcome IN ('abandoned','user-intervened') OR a.prompt_choice='leave' THEN 'ended'
    ELSE 'unconfirmed' END
  FROM playback_quality a
  WHERE a.owner=recent.owner AND a.session_id=recent.session_id AND a.root_round_id=recent.round_id
    AND a.row_kind='round' AND a.test_session=recent.test_session
  ORDER BY a.round_id DESC LIMIT 1
) END AS startupStatus FROM recent ORDER BY startedAt DESC,rootRow DESC`;

interface DashboardVisit {
  owner: string;
  startedAt: number;
  contentKey: string | null;
  episodeIndex: number;
  sourceKey: string | null;
  started: number;
  startupStatus: 'started' | 'waiting' | 'failed' | 'ended' | 'unconfirmed';
}

export async function readPlaybackDashboard(
  env: Record<string, unknown>,
  days: number,
  now: number,
  testSession: boolean
) {
  const db = getD1Database(env);
  if (!db) return null;
  const cutoff = playbackQualityDayKey(now - (days - 1) * DAY_MS);
  const cohort = Number(testSession);
  const [metrics, rows] = await Promise.all([
    readQualityMetrics(db, cutoff, cohort),
    db
      .prepare(PLAYBACK_DASHBOARD_VISITS_SQL)
      .bind(cutoff, cohort, now - DAY_MS)
      .all<DashboardVisit & { total: number; successful: number }>(),
  ]);
  const visits = rows.results ?? [];
  return {
    ...metrics,
    playback: {
      total: visits[0]?.total ?? 0,
      successful: visits[0]?.successful ?? 0,
      visits: visits.map(
        ({
          owner,
          startedAt,
          contentKey,
          episodeIndex,
          sourceKey,
          started,
          startupStatus,
        }) => ({
          owner,
          startedAt,
          contentKey,
          episodeIndex,
          sourceKey,
          started,
          startupStatus,
        })
      ),
    },
  };
}

export async function readPlaybackQualitySummary(
  env: Record<string, unknown>,
  days: number,
  now = Date.now(),
  testSession = false
) {
  const db = getD1Database(env);
  if (!db) return null;
  const cutoff = playbackQualityDayKey(now - (days - 1) * DAY_MS);
  const cohort = Number(testSession);
  const [counts, latency, sources, metrics] = await Promise.all([
    db
      .prepare(PLAYBACK_QUALITY_COUNTS_SQL)
      .bind(cutoff, cohort, now - DAY_MS, now - DAY_MS)
      .all<CountRow>(),
    db.prepare(PLAYBACK_QUALITY_LATENCY_SQL).bind(cutoff, cohort).all(),
    db.prepare(PLAYBACK_QUALITY_SOURCES_SQL).bind(cutoff, cohort).all(),
    readQualityMetrics(db, cutoff, cohort),
  ]);
  return {
    ...metrics,
    days,
    cohort: testSession ? 'test' : 'regular',
    timeZone: 'Asia/Taipei',
    groups: (counts.results || []).map((row) => ({
      ...row,
      firstRoundWithin30Rate: row.completed
        ? row.within30 / row.completed
        : null,
      finalSuccessRate: row.completedChains
        ? row.successfulChains / row.completedChains
        : null,
    })),
    latency: latency.results || [],
    sources: sources.results || [],
  };
}

export async function cleanupPlaybackQuality(
  env: Record<string, unknown>,
  now = Date.now()
): Promise<void> {
  const db = getD1Database(env);
  if (!db) return;
  await Promise.all([
    db
      .prepare(
        `DELETE FROM home_banner_visits WHERE (day_key,test_session,owner,session_id) IN
      (SELECT day_key,test_session,owner,session_id FROM home_banner_visits WHERE day_key < ? LIMIT 2000)`
      )
      .bind(playbackQualityDayKey(now - 29 * DAY_MS))
      .run(),
    ...['playback_quality', 'playback_qoe'].map((table) =>
      db
        .prepare(
          `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE received_at < ? LIMIT 2000)`
        )
        .bind(now - 30 * DAY_MS)
        .run()
    ),
  ]);
}
