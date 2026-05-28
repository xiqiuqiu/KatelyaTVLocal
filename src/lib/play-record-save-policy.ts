export type PlayRecordSaveReason =
  | 'heartbeat'
  | 'pause'
  | 'episode-change'
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

export function shouldSavePlayRecord(
  previous: PlayRecordSaveSnapshot | null,
  next: PlayRecordSaveSnapshot,
  reason: PlayRecordSaveReason
): boolean {
  if (!previous) {
    return true;
  }

  if (
    previous.key !== next.key ||
    previous.episodeIndex !== next.episodeIndex
  ) {
    return true;
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
