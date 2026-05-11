/* eslint-disable no-console */

import { db } from '@/lib/db';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import { PlayRecord, SearchResult } from '@/lib/types';

import {
  OfflineProbeResult,
  OfflineProbeTask,
  persistOfflineProbeResult,
  probePlaybackForRanking,
} from './probe';
import { scoreSource } from './scoring';

type SchedulerTriggerType = 'cron' | 'manual' | 'fallback';
type SchedulerStatus =
  | 'skipped'
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => {
    run: () => Promise<unknown>;
    all: <T = unknown>() => Promise<{ results?: T[] }>;
  };
}

interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike;
}

export interface SourceRankingSchedulerEnvLike {
  DB?: D1DatabaseLike;
}

interface RecentPlaySample {
  userName: string;
  source: string;
  id: string;
  record: PlayRecord;
}

interface RecentFeedbackSampleRow {
  sourceKey: string;
  title: string | null;
  recordedAt: number;
}

interface SampledProbeTask extends OfflineProbeTask {
  userName: string;
  sourceId: string;
}

interface AggregationBucket {
  sourceName: string;
  sampleCount: number;
  directCount: number;
  proxyCount: number;
  unavailableCount: number;
  speedSum: number;
  speedCount: number;
  resolutionCounts: Map<string, number>;
  domainCounts: Map<string, number>;
}

export interface SourceRankingSchedulerResult {
  triggered: boolean;
  status: SchedulerStatus;
  runId?: string;
  sampledRecordCount: number;
  taskCount: number;
  probeCount: number;
  snapshotCount: number;
  errorCount: number;
  reason?: string;
  notes?: string;
}

export interface LowFrequencySourceRankingOptions {
  env?: SourceRankingSchedulerEnvLike;
  origin: string;
  triggerType?: SchedulerTriggerType;
  sampleWindowKey?: string;
  now?: () => number;
  idFactory?: () => string;
  getUsers?: () => Promise<string[]>;
  getPlayRecords?: (userName: string) => Promise<Record<string, PlayRecord>>;
  fetchDetail?: (options: {
    source: string;
    id: string;
    fallbackTitle?: string;
  }) => Promise<SearchResult>;
  probePlayback?: (
    episodeUrl: string,
    origin: string
  ) => Promise<OfflineProbeResult>;
  persistProbeResult?: (
    env: { DB: D1DatabaseLike },
    runId: string,
    task: OfflineProbeTask,
    result: OfflineProbeResult,
    measuredAt?: number
  ) => Promise<void>;
}

const MAX_RECENT_RECORDS = 12;
const MAX_TASKS_TOTAL = 12;
const MAX_TASKS_PER_SOURCE = 3;
const MAX_EPISODES_PER_DETAIL = 3;
const DEFAULT_WINDOW_KEY = '24h';

function createId(prefix = 'source-ranking'): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePercent(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Number(((value / total) * 100).toFixed(2));
}

function pickTopLabel(counts: Map<string, number>): string | null {
  let winner: string | null = null;
  let winnerCount = -1;

  counts.forEach((count, label) => {
    if (count > winnerCount) {
      winner = label;
      winnerCount = count;
    }
  });

  return winner;
}

function buildSnapshotId(sourceKey: string, windowKey: string): string {
  return `source-rank-snapshot:${sourceKey}:${windowKey}`;
}

function getDatabaseFromEnv(
  env?: SourceRankingSchedulerEnvLike
): D1DatabaseLike | null {
  const database = env?.DB ?? ((process.env as unknown as { DB?: D1DatabaseLike }).DB || null);
  return database ?? null;
}

function parseRecordKey(key: string): { source: string; id: string } | null {
  const separatorIndex = key.indexOf('+');
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return null;
  }

  return {
    source: key.slice(0, separatorIndex),
    id: key.slice(separatorIndex + 1),
  };
}

function parseSourceIdentityKey(
  key: string
): { source: string; id: string } | null {
  const separatorIndex = key.indexOf('-');
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return null;
  }

  return {
    source: key.slice(0, separatorIndex),
    id: key.slice(separatorIndex + 1),
  };
}

function buildSourceIdentityKey(source: string, id: string): string {
  return `${source}-${id}`;
}

function buildEpisodeCandidates(
  episodes: string[],
  currentEpisodeIndex: number
): string[] {
  const normalizedCurrentIndex = Math.max(0, currentEpisodeIndex - 1);
  const orderedIndexes = [
    normalizedCurrentIndex,
    normalizedCurrentIndex + 1,
    normalizedCurrentIndex - 1,
    0,
    1,
    2,
  ];
  const selected = new Set<string>();

  for (const index of orderedIndexes) {
    const candidate = episodes[index];
    if (!candidate || !/^https?:\/\//i.test(candidate)) {
      continue;
    }

    selected.add(candidate);
    if (selected.size >= MAX_EPISODES_PER_DETAIL) {
      break;
    }
  }

  if (selected.size < MAX_EPISODES_PER_DETAIL) {
    for (const candidate of episodes) {
      if (!candidate || !/^https?:\/\//i.test(candidate)) {
        continue;
      }

      selected.add(candidate);
      if (selected.size >= MAX_EPISODES_PER_DETAIL) {
        break;
      }
    }
  }

  return Array.from(selected);
}

async function loadRecentPlaySamples(
  getUsers: () => Promise<string[]>,
  getPlayRecords: (userName: string) => Promise<Record<string, PlayRecord>>
): Promise<RecentPlaySample[]> {
  const userSet = new Set((await getUsers()).filter(Boolean));
  const fallbackUserName = (process.env.USERNAME || '').trim();
  if (fallbackUserName) {
    userSet.add(fallbackUserName);
  }

  const samples: RecentPlaySample[] = [];

  for (const userName of Array.from(userSet)) {
    try {
      const playRecords = await getPlayRecords(userName);
      Object.entries(playRecords).forEach(([key, record]) => {
        const parsedKey = parseRecordKey(key);
        if (!parsedKey) {
          return;
        }

        samples.push({
          userName,
          source: parsedKey.source,
          id: parsedKey.id,
          record,
        });
      });
    } catch (error) {
      console.error(`source ranking: load play records failed for ${userName}`, error);
    }
  }

  return samples
    .sort((left, right) => right.record.save_time - left.record.save_time)
    .slice(0, MAX_RECENT_RECORDS);
}

async function loadRecentFeedbackSamples(
  database: D1DatabaseLike
): Promise<RecentPlaySample[]> {
  const result = await database
    .prepare(
      `SELECT
         source_key AS sourceKey,
         title,
         recorded_at AS recordedAt
       FROM playback_feedback_events
       WHERE startup_success = 1
       ORDER BY recorded_at DESC
       LIMIT ?`
    )
    .bind(MAX_RECENT_RECORDS)
    .all<RecentFeedbackSampleRow>();

  return (result.results || [])
    .map((row) => {
      const parsed = parseSourceIdentityKey(row.sourceKey);
      if (!parsed) {
        return null;
      }

      return {
        userName: 'feedback-fallback',
        source: parsed.source,
        id: parsed.id,
        record: {
          title: row.title || parsed.id,
          source_name: parsed.source,
          cover: '',
          year: '',
          index: 1,
          total_episodes: 1,
          play_time: 0,
          total_time: 0,
          save_time: row.recordedAt,
          search_title: row.title || parsed.id,
        },
      } satisfies RecentPlaySample;
    })
    .filter((sample): sample is RecentPlaySample => Boolean(sample));
}

async function buildProbeTasksFromRecentPlays(
  samples: RecentPlaySample[],
  fetchDetail: LowFrequencySourceRankingOptions['fetchDetail']
): Promise<SampledProbeTask[]> {
  const tasks: SampledProbeTask[] = [];
  const perSourceCount = new Map<string, number>();
  const seenVideoKeys = new Set<string>();
  const seenEpisodeUrls = new Set<string>();

  for (const sample of samples) {
    if (tasks.length >= MAX_TASKS_TOTAL) {
      break;
    }

    const videoKey = `${sample.source}+${sample.id}`;
    if (seenVideoKeys.has(videoKey)) {
      continue;
    }
    seenVideoKeys.add(videoKey);

    const detail = await fetchDetail?.({
      source: sample.source,
      id: sample.id,
      fallbackTitle: sample.record.search_title || sample.record.title,
    });

    if (!detail || !detail.episodes?.length) {
      continue;
    }

    const normalizedSource = detail.source || sample.source;
    const normalizedId = detail.id || sample.id;
    const sourceKey = buildSourceIdentityKey(normalizedSource, normalizedId);
    const currentSourceCount = perSourceCount.get(sourceKey) || 0;
    if (currentSourceCount >= MAX_TASKS_PER_SOURCE) {
      continue;
    }

    const episodeUrls = buildEpisodeCandidates(
      detail.episodes,
      sample.record.index || 1
    );
    if (episodeUrls.length === 0) {
      continue;
    }

    for (const episodeUrl of episodeUrls) {
      if (tasks.length >= MAX_TASKS_TOTAL) {
        break;
      }

      if ((perSourceCount.get(sourceKey) || 0) >= MAX_TASKS_PER_SOURCE) {
        break;
      }

      if (seenEpisodeUrls.has(episodeUrl)) {
        continue;
      }
      seenEpisodeUrls.add(episodeUrl);

      tasks.push({
        userName: sample.userName,
        sourceKey,
        sourceId: normalizedId,
        sourceName:
          detail.source_name || sample.record.source_name || normalizedSource,
        titleSample: detail.title || sample.record.title,
        episodeUrl,
      });
      perSourceCount.set(sourceKey, (perSourceCount.get(sourceKey) || 0) + 1);
    }
  }

  return tasks;
}

function createAggregationBucket(task: SampledProbeTask): AggregationBucket {
  return {
    sourceName: task.sourceName,
    sampleCount: 0,
    directCount: 0,
    proxyCount: 0,
    unavailableCount: 0,
    speedSum: 0,
    speedCount: 0,
    resolutionCounts: new Map<string, number>(),
    domainCounts: new Map<string, number>(),
  };
}

function appendProbeToBucket(
  bucket: AggregationBucket,
  result: OfflineProbeResult
): void {
  bucket.sampleCount += 1;

  if (result.kind === 'direct') {
    bucket.directCount += 1;
  } else if (result.kind === 'proxy') {
    bucket.proxyCount += 1;
  } else {
    bucket.unavailableCount += 1;
  }

  if (typeof result.firstSegmentSpeedKbps === 'number') {
    bucket.speedSum += result.firstSegmentSpeedKbps;
    bucket.speedCount += 1;
  }

  if (result.resolutionLabel) {
    bucket.resolutionCounts.set(
      result.resolutionLabel,
      (bucket.resolutionCounts.get(result.resolutionLabel) || 0) + 1
    );
  }

  if (result.domain) {
    bucket.domainCounts.set(
      result.domain,
      (bucket.domainCounts.get(result.domain) || 0) + 1
    );
  }
}

async function insertProbeRun(
  database: D1DatabaseLike,
  runId: string,
  triggerType: SchedulerTriggerType,
  startedAt: number
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO source_probe_runs
       (id, trigger_type, started_at, status, notes)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(runId, triggerType, startedAt, 'running', 'low-frequency personal check')
    .run();
}

async function finalizeProbeRun(
  database: D1DatabaseLike,
  runId: string,
  finishedAt: number,
  status: SchedulerStatus,
  notes: string
): Promise<void> {
  await database
    .prepare(
      `UPDATE source_probe_runs
       SET finished_at = ?, status = ?, notes = ?
       WHERE id = ?`
    )
    .bind(finishedAt, status, notes, runId)
    .run();
}

async function upsertSnapshot(
  database: D1DatabaseLike,
  sourceKey: string,
  bucket: AggregationBucket,
  windowKey: string,
  updatedAt: number
): Promise<void> {
  const successRate = normalizePercent(
    bucket.directCount + bucket.proxyCount,
    bucket.sampleCount
  );
  const directRate = normalizePercent(bucket.directCount, bucket.sampleCount);
  const proxyRate = normalizePercent(bucket.proxyCount, bucket.sampleCount);
  const unavailableRate = normalizePercent(
    bucket.unavailableCount,
    bucket.sampleCount
  );
  const avgSpeedKbps =
    bucket.speedCount > 0 ? bucket.speedSum / bucket.speedCount : null;
  const resolutionLabel = pickTopLabel(bucket.resolutionCounts);
  const playbackDomain = pickTopLabel(bucket.domainCounts);
  const score = scoreSource({
    successRate,
    directRate,
    proxyRate,
    unavailableRate,
    avgSpeedKbps,
    resolutionLabel,
  });

  await database
    .prepare(
      `INSERT OR REPLACE INTO source_rank_snapshots
       (id, source_key, playback_domain, window_key, health_score, quality_score, speed_score, stability_score, final_score, success_rate, direct_rate, proxy_rate, unavailable_rate, sample_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      buildSnapshotId(sourceKey, windowKey),
      sourceKey,
      playbackDomain,
      windowKey,
      score.healthScore,
      score.qualityScore,
      score.speedScore,
      successRate,
      score.finalScore,
      successRate,
      directRate,
      proxyRate,
      unavailableRate,
      bucket.sampleCount,
      updatedAt
    )
    .run();
}

export async function runLowFrequencySourceRankingCheck(
  options: LowFrequencySourceRankingOptions
): Promise<SourceRankingSchedulerResult> {
  const {
    origin,
    triggerType = 'manual',
    sampleWindowKey = DEFAULT_WINDOW_KEY,
    now = () => Date.now(),
    idFactory = () => createId('source-probe-run'),
    getUsers = () => db.getAllUsers(),
    getPlayRecords = (userName: string) => db.getAllPlayRecords(userName),
    fetchDetail = fetchVideoDetail,
    probePlayback = probePlaybackForRanking,
    persistProbeResult = persistOfflineProbeResult,
  } = options;
  const database = getDatabaseFromEnv(options.env);

  if (!database) {
    return {
      triggered: false,
      status: 'skipped',
      sampledRecordCount: 0,
      taskCount: 0,
      probeCount: 0,
      snapshotCount: 0,
      errorCount: 0,
      reason: 'missing D1 binding',
    };
  }

  const runId = idFactory();
  const startedAt = now();
  const errors: string[] = [];
  let probeCount = 0;
  let snapshotCount = 0;
  let sampledRecordCount = 0;
  let taskCount = 0;

  await insertProbeRun(database, runId, triggerType, startedAt);

  try {
    let samples = await loadRecentPlaySamples(getUsers, getPlayRecords);
    if (samples.length === 0) {
      samples = await loadRecentFeedbackSamples(database);
    }
    sampledRecordCount = samples.length;

    let tasks: SampledProbeTask[] = [];
    try {
      tasks = await buildProbeTasksFromRecentPlays(samples, fetchDetail);
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : 'build probe tasks failed'
      );
    }
    taskCount = tasks.length;

    if (tasks.length === 0) {
      const notes = JSON.stringify({
        sampledRecordCount,
        taskCount,
        probeCount,
        snapshotCount,
        reason: 'no probe task built from recent play records',
      });

      await finalizeProbeRun(database, runId, now(), 'skipped', notes);

      return {
        triggered: true,
        status: 'skipped',
        runId,
        sampledRecordCount,
        taskCount,
        probeCount,
        snapshotCount,
        errorCount: errors.length,
        reason: 'no probe task built from recent play records',
        notes,
      };
    }

    const buckets = new Map<string, AggregationBucket>();

    for (const task of tasks) {
      try {
        const measuredAt = now();
        const probeResult = await probePlayback(task.episodeUrl, origin);
        probeCount += 1;

        await persistProbeResult(
          { DB: database },
          runId,
          task,
          probeResult,
          measuredAt
        );

        const bucket =
          buckets.get(task.sourceKey) || createAggregationBucket(task);
        appendProbeToBucket(bucket, probeResult);
        buckets.set(task.sourceKey, bucket);
      } catch (error) {
        errors.push(
          error instanceof Error
            ? `${task.sourceKey}: ${error.message}`
            : `${task.sourceKey}: probe failed`
        );
      }
    }

    for (const [sourceKey, bucket] of Array.from(buckets.entries())) {
      try {
        await upsertSnapshot(database, sourceKey, bucket, sampleWindowKey, now());
        snapshotCount += 1;
      } catch (error) {
        errors.push(
          error instanceof Error
            ? `${sourceKey}: snapshot failed - ${error.message}`
            : `${sourceKey}: snapshot failed`
        );
      }
    }

    const status: SchedulerStatus =
      probeCount === 0
        ? 'failed'
        : errors.length > 0
        ? 'completed_with_errors'
        : 'completed';
    const notes = JSON.stringify({
      sampledRecordCount,
      taskCount,
      probeCount,
      snapshotCount,
      errors: errors.slice(0, 5),
    });

    await finalizeProbeRun(database, runId, now(), status, notes);

    return {
      triggered: true,
      status,
      runId,
      sampledRecordCount,
      taskCount,
      probeCount,
      snapshotCount,
      errorCount: errors.length,
      notes,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'source ranking scheduler failed';
    const notes = JSON.stringify({
      sampledRecordCount,
      taskCount,
      probeCount,
      snapshotCount,
      errors: [...errors, message].slice(0, 5),
    });

    await finalizeProbeRun(database, runId, now(), 'failed', notes);

    return {
      triggered: true,
      status: 'failed',
      runId,
      sampledRecordCount,
      taskCount,
      probeCount,
      snapshotCount,
      errorCount: errors.length + 1,
      reason: message,
      notes,
    };
  }
}
