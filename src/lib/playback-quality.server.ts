import { getD1Database } from '@/lib/d1';
import type { PlaybackQualityRecord } from '@/lib/playback-quality';

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
  had_hidden, autoplay_blocked, prompt_choice, next_round_id, day_key, received_at, updated_at
)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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

export async function savePlaybackQuality(
  env: Record<string, unknown>,
  owner: string,
  records: PlaybackQualityRecord[],
  now = Date.now()
): Promise<'saved' | 'no-d1' | 'quota'> {
  const db = getD1Database(env);
  if (!db) return 'no-d1';
  const dayKey = playbackQualityDayKey(now);
  for (const record of records) {
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
      AND s.session_id = r.session_id AND s.root_round_id = r.round_id
      AND s.row_kind = 'round' AND s.outcome = 'frame-ready') AS chain_success,
    (SELECT s.outcome FROM playback_quality s WHERE s.owner = r.owner
      AND s.session_id = r.session_id AND s.root_round_id = r.round_id
      AND s.row_kind = 'round' ORDER BY s.round_id DESC LIMIT 1) AS latest_outcome,
    (SELECT s.prompt_choice FROM playback_quality s WHERE s.owner = r.owner
      AND s.session_id = r.session_id AND s.root_round_id = r.round_id
      AND s.row_kind = 'round' ORDER BY s.round_id DESC LIMIT 1) AS latest_choice
  FROM playback_quality r WHERE r.row_kind = 'round' AND r.round_id = r.root_round_id AND r.day_key >= ?
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
    AND s.session_id = r.session_id AND s.root_round_id = r.round_id AND s.row_kind = 'round'
  WHERE r.row_kind = 'round' AND r.round_id = r.root_round_id AND r.day_key >= ?
    AND s.outcome = 'frame-ready' AND s.had_hidden = 0 AND s.autoplay_blocked = 0
    AND s.round_id = (SELECT MIN(t.round_id) FROM playback_quality t WHERE t.owner = r.owner
      AND t.session_id = r.session_id AND t.root_round_id = r.round_id AND t.row_kind = 'round'
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
FROM playback_quality WHERE row_kind = 'source' AND day_key >= ?
GROUP BY day_key, release_id, platform, policy_version, source_reason, outcome`;

interface CountRow {
  completed: number;
  within30: number;
  completedChains: number;
  successfulChains: number;
}

export async function readPlaybackQualitySummary(
  env: Record<string, unknown>,
  days: number,
  now = Date.now()
) {
  const db = getD1Database(env);
  if (!db) return null;
  const cutoff = playbackQualityDayKey(now - (days - 1) * DAY_MS);
  const [counts, latency, sources] = await Promise.all([
    db
      .prepare(PLAYBACK_QUALITY_COUNTS_SQL)
      .bind(cutoff, now - DAY_MS, now - DAY_MS)
      .all<CountRow>(),
    db.prepare(PLAYBACK_QUALITY_LATENCY_SQL).bind(cutoff).all(),
    db.prepare(PLAYBACK_QUALITY_SOURCES_SQL).bind(cutoff).all(),
  ]);
  return {
    days,
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
  await db
    .prepare(
      'DELETE FROM playback_quality WHERE rowid IN (SELECT rowid FROM playback_quality WHERE received_at < ? LIMIT 2000)'
    )
    .bind(now - 30 * DAY_MS)
    .run();
}
