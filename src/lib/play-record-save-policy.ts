export type PlayRecordSaveReason =
  | 'heartbeat'
  | 'pause'
  | 'episode-change'
  | 'episode-ended'
  | 'source-change'
  | 'visibility-hidden'
  | 'beforeunload'
  | 'resume-sync';

export interface PlayRecordSaveSnapshot {
  key: string;
  episodeIndex: number;
  playTime: number;
  totalTime: number;
  savedAt: number;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
const D1_HEARTBEAT_INTERVAL_MS = 30000;
const UPSTASH_HEARTBEAT_INTERVAL_MS = 20000;
const DUPLICATE_SAVE_WINDOW_MS = 10000;
const MIN_PROGRESS_DELTA_SECONDS = 5;
const MIN_TOTAL_TIME_DELTA_SECONDS = 5;
/** Mid-episode floor for collapsed-playhead regression guards (金特务 prod). */
const MID_EPISODE_PLAYTIME_SECONDS = 120;
/** Near-start ceiling: live playheads at/under this look like post-switch collapse. */
const NEAR_START_PLAYTIME_SECONDS = 30;

export function getPlayRecordHeartbeatIntervalMs(
  storageType?: string | null
): number {
  switch (storageType) {
    case 'd1':
      return D1_HEARTBEAT_INTERVAL_MS;
    case 'upstash':
      return UPSTASH_HEARTBEAT_INTERVAL_MS;
    default:
      return DEFAULT_HEARTBEAT_INTERVAL_MS;
  }
}

/**
 * True when next looks like a collapsed/near-zero playhead wiping mid-episode
 * Watch Progress (e.g. source-switch seek lost, then visibility-hidden at ~5s).
 */
export function isCollapsedWatchProgressRegression(
  previous: PlayRecordSaveSnapshot,
  next: PlayRecordSaveSnapshot
): boolean {
  return (
    previous.playTime >= MID_EPISODE_PLAYTIME_SECONDS &&
    next.playTime <= NEAR_START_PLAYTIME_SECONDS &&
    previous.playTime - next.playTime >= MIN_PROGRESS_DELTA_SECONDS
  );
}

/**
 * Prefer a remembered mid-episode playhead when live media only shows a
 * near-start position after timeline collapse. Unlike resolveRememberedPlayhead
 * (live>1 wins), this keeps Watch Progress from adopting ~5s after a lost seek.
 */
export function resolvePlayTimeForWatchProgressSave(input: {
  livePlayTime: number;
  rememberedPlayhead: number;
  /** When set, a remembered playhead from another episode is ignored. */
  rememberedEpisodeIndex?: number | null;
  episodeIndex?: number | null;
  userRewound?: boolean;
}): number {
  const live = Math.max(0, Math.floor(input.livePlayTime || 0));
  const remembered = Math.max(0, Math.floor(input.rememberedPlayhead || 0));
  const sameEpisode =
    input.rememberedEpisodeIndex == null ||
    input.episodeIndex == null ||
    input.rememberedEpisodeIndex === input.episodeIndex;
  if (
    !input.userRewound &&
    sameEpisode &&
    remembered >= MID_EPISODE_PLAYTIME_SECONDS &&
    live <= NEAR_START_PLAYTIME_SECONDS &&
    remembered - live >= MIN_PROGRESS_DELTA_SECONDS
  ) {
    return remembered;
  }
  return live;
}

export interface PlayRecordProgressMergeInput {
  existingPlayTime: number;
  existingEpisodeIndex: number;
  incomingPlayTime: number;
  incomingEpisodeIndex: number;
  /**
   * True only when this playback session confirmed a user seek backward.
   * Heartbeat, pause, and an old tab waking up must leave this false.
   */
  userRewound?: boolean;
}

/**
 * Same-episode writes must not replace a further playhead with an earlier one
 * unless the user deliberately seeked backward. A later episode still replaces
 * the row, because legacy keys store one episode per source+id.
 */
export function mergePlayRecordProgress(input: PlayRecordProgressMergeInput): {
  playTime: number;
  keptFurtherProgress: boolean;
} {
  const existingPlayTime = Number.isFinite(input.existingPlayTime)
    ? input.existingPlayTime
    : 0;
  const incomingPlayTime = Number.isFinite(input.incomingPlayTime)
    ? input.incomingPlayTime
    : 0;
  const sameEpisode = input.existingEpisodeIndex === input.incomingEpisodeIndex;
  if (
    sameEpisode &&
    !input.userRewound &&
    incomingPlayTime < existingPlayTime
  ) {
    return { playTime: existingPlayTime, keptFurtherProgress: true };
  }
  return { playTime: incomingPlayTime, keptFurtherProgress: false };
}

/**
 * When an earlier playhead is rejected, keep the stored progress metadata too.
 * An old tab must not refresh save_time or duration while its playhead is dropped.
 */
export function applyKeptPlayRecordProgress<
  T extends {
    play_time: number;
    total_time: number;
    save_time: number;
    source_name: string;
  }
>(incoming: T, existing: T, keptFurtherProgress: boolean): T {
  if (!keptFurtherProgress) {
    return incoming;
  }
  return {
    ...incoming,
    play_time: existing.play_time,
    total_time: existing.total_time,
    save_time: existing.save_time,
    source_name: existing.source_name,
  };
}

export function shouldSavePlayRecord(
  previous: PlayRecordSaveSnapshot | null,
  next: PlayRecordSaveSnapshot,
  reason: PlayRecordSaveReason,
  userRewound = false
): boolean {
  if (!previous || userRewound) {
    return true;
  }

  if (
    previous.key !== next.key ||
    previous.episodeIndex !== next.episodeIndex
  ) {
    return true;
  }

  // Episode completion must never be dropped by heartbeat debounce.
  if (reason === 'episode-ended' || reason === 'episode-change') {
    return true;
  }

  // Explicit pause may record an intentional restart-from-start. Background /
  // heartbeat / resume-sync must not wipe mid-episode progress after a
  // collapsed post-switch timeline (金特务：本色回归 apple-hlsjs).
  if (
    reason !== 'pause' &&
    isCollapsedWatchProgressRegression(previous, next)
  ) {
    return false;
  }

  const elapsedMs = Math.max(0, next.savedAt - previous.savedAt);
  const playTimeDelta = Math.abs(next.playTime - previous.playTime);
  const totalTimeDelta = Math.abs(next.totalTime - previous.totalTime);

  if (reason === 'heartbeat') {
    return playTimeDelta >= MIN_PROGRESS_DELTA_SECONDS;
  }

  if (elapsedMs > DUPLICATE_SAVE_WINDOW_MS) {
    return true;
  }

  if (playTimeDelta >= MIN_PROGRESS_DELTA_SECONDS) {
    return true;
  }

  if (totalTimeDelta >= MIN_TOTAL_TIME_DELTA_SECONDS) {
    return true;
  }

  return false;
}
