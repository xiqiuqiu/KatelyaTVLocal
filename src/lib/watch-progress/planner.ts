import type { PlayRecord } from '@/lib/types';

import type { WatchProgressAuthorityMode } from './authority';
import { buildWatchProgressContentKey } from './content-key';

const WATCH_PROGRESS_KEY_PREFIX = 'wp:';
const WATCH_PROGRESS_EPISODE_SEPARATOR = '#';
/** Relative duration delta that triggers proportional remapping (A′). */
export const WATCH_PROGRESS_DURATION_MISMATCH_RATIO = 0.15;
const END_GUARD_SECONDS = 2;

export interface WatchProgressIdentity {
  contentKey: string;
  /** 0-based episode index — matches Playback Session. */
  episodeIndex: number;
}

export interface WatchProgressRoute {
  source: string;
  id: string;
}

export function buildWatchProgressStorageKey(
  contentKey: string,
  episodeIndex: number
): string {
  return `${WATCH_PROGRESS_KEY_PREFIX}${contentKey}${WATCH_PROGRESS_EPISODE_SEPARATOR}${episodeIndex}`;
}

export function parseWatchProgressStorageKey(
  key: string
): WatchProgressIdentity | null {
  if (!key.startsWith(WATCH_PROGRESS_KEY_PREFIX)) {
    return null;
  }

  const body = key.slice(WATCH_PROGRESS_KEY_PREFIX.length);
  const separatorIndex = body.lastIndexOf(WATCH_PROGRESS_EPISODE_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex >= body.length - 1) {
    return null;
  }

  const contentKey = body.slice(0, separatorIndex);
  const episodeIndex = Number.parseInt(body.slice(separatorIndex + 1), 10);
  if (!contentKey || !Number.isFinite(episodeIndex) || episodeIndex < 0) {
    return null;
  }

  return { contentKey, episodeIndex };
}

export function isWatchProgressStorageKey(key: string): boolean {
  return parseWatchProgressStorageKey(key) != null;
}

export function buildLegacyPlayRecordStorageKey(
  source: string,
  id: string
): string {
  return `${source}+${id}`;
}

export function mergeWatchProgressRecords(
  records: readonly PlayRecord[]
): PlayRecord | null {
  if (records.length === 0) {
    return null;
  }

  return records.reduce((winner, candidate) => {
    if (candidate.save_time > winner.save_time) {
      return candidate;
    }
    if (
      candidate.save_time === winner.save_time &&
      candidate.play_time > winner.play_time
    ) {
      return candidate;
    }
    return winner;
  });
}

export interface PlanWatchProgressReadInput {
  contentKey: string;
  episodeIndex: number;
  records: Record<string, PlayRecord>;
  legacyRoute?: WatchProgressRoute | null;
  authorityMode: WatchProgressAuthorityMode;
}

export interface PlanWatchProgressReadResult {
  record: PlayRecord | null;
  storageKey: string | null;
  mergedFromLegacy: boolean;
}

function matchesEpisode(record: PlayRecord, episodeIndex: number): boolean {
  return record.index === episodeIndex + 1;
}

export function planWatchProgressRead(
  input: PlanWatchProgressReadInput
): PlanWatchProgressReadResult {
  const legacyKey = input.legacyRoute
    ? buildLegacyPlayRecordStorageKey(
        input.legacyRoute.source,
        input.legacyRoute.id
      )
    : null;

  if (input.authorityMode === 'legacy') {
    const legacyRecord =
      legacyKey && input.records[legacyKey] ? input.records[legacyKey] : null;
    return {
      record: legacyRecord,
      storageKey: legacyRecord ? legacyKey : null,
      mergedFromLegacy: false,
    };
  }

  const primaryKey = buildWatchProgressStorageKey(
    input.contentKey,
    input.episodeIndex
  );
  const primary = input.records[primaryKey] || null;
  const legacy =
    legacyKey && input.records[legacyKey] ? input.records[legacyKey] : null;
  const legacyMatchesEpisode =
    legacy && matchesEpisode(legacy, input.episodeIndex) ? legacy : null;

  if (primary && legacyMatchesEpisode) {
    const merged = mergeWatchProgressRecords([primary, legacyMatchesEpisode]);
    return {
      record: merged,
      storageKey: primaryKey,
      mergedFromLegacy: merged === legacyMatchesEpisode,
    };
  }

  if (primary) {
    return {
      record: primary,
      storageKey: primaryKey,
      mergedFromLegacy: false,
    };
  }

  if (legacyMatchesEpisode) {
    return {
      record: legacyMatchesEpisode,
      storageKey: legacyKey,
      mergedFromLegacy: true,
    };
  }

  // Same-content legacy records may still carry the episode under a different route.
  const sameContentLegacy = Object.entries(input.records)
    .filter(([key, record]) => {
      if (isWatchProgressStorageKey(key)) {
        return false;
      }
      if (!matchesEpisode(record, input.episodeIndex)) {
        return false;
      }
      const recordContentKey = buildWatchProgressContentKey({
        title: record.search_title || record.title,
        year: record.year,
      });
      return recordContentKey === input.contentKey;
    })
    .map(([, record]) => record);

  const mergedLegacy = mergeWatchProgressRecords(sameContentLegacy);
  if (mergedLegacy) {
    return {
      record: mergedLegacy,
      storageKey: legacyKey,
      mergedFromLegacy: true,
    };
  }

  return {
    record: null,
    storageKey: null,
    mergedFromLegacy: false,
  };
}

export interface PlanWatchProgressWriteInput {
  contentKey: string;
  episodeIndex: number;
  route: WatchProgressRoute;
  authorityMode: WatchProgressAuthorityMode;
  dualWrite: boolean;
}

export interface PlanWatchProgressWriteResult {
  primaryKey: string;
  dualWriteKeys: string[];
}

export function planWatchProgressWrite(
  input: PlanWatchProgressWriteInput
): PlanWatchProgressWriteResult {
  const legacyKey = buildLegacyPlayRecordStorageKey(
    input.route.source,
    input.route.id
  );

  if (input.authorityMode === 'legacy') {
    return {
      primaryKey: legacyKey,
      dualWriteKeys: [],
    };
  }

  return {
    primaryKey: buildWatchProgressStorageKey(
      input.contentKey,
      input.episodeIndex
    ),
    dualWriteKeys: input.dualWrite ? [legacyKey] : [],
  };
}

export interface AdaptWatchProgressPlayheadInput {
  playTime: number;
  sourceTotalTime?: number | null;
  targetTotalTime?: number | null;
}

/**
 * A′ same-episode source-switch playhead adaptation.
 * Large duration mismatch → proportional map; otherwise clamp to target.
 */
export function adaptWatchProgressPlayhead(
  input: AdaptWatchProgressPlayheadInput
): number {
  const playTime = Math.max(0, input.playTime || 0);
  const sourceTotal = input.sourceTotalTime || 0;
  const targetTotal = input.targetTotalTime || 0;

  if (targetTotal <= 0) {
    return playTime;
  }

  let adapted = playTime;
  if (
    sourceTotal > 0 &&
    Math.abs(targetTotal - sourceTotal) / Math.max(sourceTotal, targetTotal) >=
      WATCH_PROGRESS_DURATION_MISMATCH_RATIO
  ) {
    adapted = playTime * (targetTotal / sourceTotal);
  }

  const maxPlayable = Math.max(0, targetTotal - END_GUARD_SECONDS);
  return Number(Math.min(adapted, maxPlayable).toFixed(2));
}

export interface PlanEpisodeChangeSaveInput {
  previousEpisodeIndex: number;
  nextEpisodeIndex: number;
  playTime: number;
  totalTime: number;
  reason: 'episode-change' | 'episode-ended';
}

export interface PlanEpisodeChangeSaveResult {
  mustSavePrevious: boolean;
  /** Completion semantics for ended → next. */
  completed: boolean;
  playTime: number;
}

/**
 * Episode changes (manual or ended→next) must always seal the previous episode first.
 */
export function planEpisodeChangeSave(
  input: PlanEpisodeChangeSaveInput
): PlanEpisodeChangeSaveResult {
  const episodeChanged = input.previousEpisodeIndex !== input.nextEpisodeIndex;
  if (!episodeChanged) {
    return {
      mustSavePrevious: false,
      completed: false,
      playTime: input.playTime,
    };
  }

  if (input.reason === 'episode-ended') {
    const completedPlayTime =
      input.totalTime > 0
        ? Math.max(input.playTime, input.totalTime)
        : input.playTime;
    return {
      mustSavePrevious: true,
      completed: true,
      playTime: completedPlayTime,
    };
  }

  return {
    mustSavePrevious: true,
    completed: false,
    playTime: input.playTime,
  };
}

export interface PlanLatestWatchProgressInput {
  contentKey: string;
  records: Record<string, PlayRecord>;
  legacyRoute?: WatchProgressRoute | null;
  authorityMode: WatchProgressAuthorityMode;
}

/**
 * Pick the newest Watch Progress row for a contentKey (any episode).
 * Used by refresh / continue-watching entry when URL omits episode.
 */
export function planLatestWatchProgressForContent(
  input: PlanLatestWatchProgressInput
): PlanWatchProgressReadResult {
  const candidates: Array<{ key: string; record: PlayRecord }> = [];

  for (const [key, record] of Object.entries(input.records)) {
    const parsed = parseWatchProgressStorageKey(key);
    if (parsed?.contentKey === input.contentKey) {
      candidates.push({ key, record });
      continue;
    }

    if (isWatchProgressStorageKey(key)) {
      continue;
    }

    const recordContentKey = buildWatchProgressContentKey({
      title: record.search_title || record.title,
      year: record.year,
    });
    if (recordContentKey === input.contentKey) {
      candidates.push({ key, record });
    }
  }

  if (input.legacyRoute) {
    const legacyKey = buildLegacyPlayRecordStorageKey(
      input.legacyRoute.source,
      input.legacyRoute.id
    );
    const legacy = input.records[legacyKey];
    if (legacy && !candidates.some((item) => item.key === legacyKey)) {
      candidates.push({ key: legacyKey, record: legacy });
    }
  }

  if (candidates.length === 0) {
    return {
      record: null,
      storageKey: null,
      mergedFromLegacy: false,
    };
  }

  const winner = candidates.reduce((best, item) => {
    if (item.record.save_time > best.record.save_time) {
      return item;
    }
    if (
      item.record.save_time === best.record.save_time &&
      item.record.play_time > best.record.play_time
    ) {
      return item;
    }
    return best;
  });

  if (input.authorityMode === 'legacy') {
    const legacyOnly = candidates.filter(
      (item) => !isWatchProgressStorageKey(item.key)
    );
    if (legacyOnly.length === 0) {
      return {
        record: null,
        storageKey: null,
        mergedFromLegacy: false,
      };
    }
    const legacyWinner = legacyOnly.reduce((best, item) =>
      item.record.save_time > best.record.save_time ? item : best
    );
    return {
      record: legacyWinner.record,
      storageKey: legacyWinner.key,
      mergedFromLegacy: false,
    };
  }

  return {
    record: winner.record,
    storageKey: winner.key,
    mergedFromLegacy: !isWatchProgressStorageKey(winner.key),
  };
}
