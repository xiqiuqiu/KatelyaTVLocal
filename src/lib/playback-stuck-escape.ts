/**
 * Stall escape: record bad playhead points and skip past them on retry.
 *
 * First hit near a freeze rewinds slightly (avoid the same segment edge).
 * Later hits in the same window skip forward so refresh/source-switch/recovery
 * can actually get past the stuck point instead of looping on T-5.
 */

export const PLAYBACK_RESUME_REWIND_SECONDS = 5;
export const PLAYBACK_BAD_POINT_SKIP_FORWARD_SECONDS = 20;
export const PLAYBACK_BAD_POINT_MATCH_WINDOW_SECONDS = 10;

export type StallEscapeAction = 'rewind' | 'skip-forward' | 'none';

export interface PlaybackBadPoint {
  sourceKey: string | null;
  timeSeconds: number;
  hitCount: number;
  updatedAtMs: number;
}

export interface PlanStallEscapeResumeInput {
  currentPlayTime: number;
  badPoints?: readonly PlaybackBadPoint[];
  sourceKey?: string | null;
  /**
   * same-source: match bad points for this source only.
   * cross-source: match any session bad point near this absolute time, because
   * carrying a known-stuck clock time across timelines re-enters the freeze.
   */
  mode?: 'same-source' | 'cross-source';
  rewindSeconds?: number;
  skipForwardSeconds?: number;
  matchWindowSeconds?: number;
  /**
   * When true, an already-planned resume target is kept as-is unless it sits
   * inside a known bad window (then skip forward). Avoids double rewind.
   */
  preferExistingWithoutRewind?: boolean;
}

export interface StallEscapeResumePlan {
  resumeTime: number | null;
  action: StallEscapeAction;
  /** Caller should persist this time as a bad point when non-null. */
  recordBadPointAt: number | null;
}

function roundTime(value: number): number {
  return Number(value.toFixed(2));
}

export function findNearbyPlaybackBadPoint(
  badPoints: readonly PlaybackBadPoint[] | undefined,
  input: {
    timeSeconds: number;
    sourceKey?: string | null;
    mode?: 'same-source' | 'cross-source';
    matchWindowSeconds?: number;
  }
): PlaybackBadPoint | null {
  if (!badPoints?.length) {
    return null;
  }

  const matchWindow =
    input.matchWindowSeconds ?? PLAYBACK_BAD_POINT_MATCH_WINDOW_SECONDS;
  const mode = input.mode ?? 'same-source';
  const sourceKey = input.sourceKey ?? null;

  let best: PlaybackBadPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const point of badPoints) {
    if (mode === 'same-source' && point.sourceKey !== sourceKey) {
      continue;
    }

    const distance = Math.abs(point.timeSeconds - input.timeSeconds);
    if (distance > matchWindow || distance >= bestDistance) {
      continue;
    }

    best = point;
    bestDistance = distance;
  }

  return best;
}

export function rememberPlaybackBadPoint(
  badPoints: readonly PlaybackBadPoint[],
  input: {
    sourceKey: string | null;
    timeSeconds: number;
    nowMs: number;
    matchWindowSeconds?: number;
  }
): PlaybackBadPoint[] {
  if (!Number.isFinite(input.timeSeconds) || input.timeSeconds <= 1) {
    return [...badPoints];
  }

  const timeSeconds = roundTime(input.timeSeconds);
  const existing = findNearbyPlaybackBadPoint(badPoints, {
    timeSeconds,
    sourceKey: input.sourceKey,
    mode: 'same-source',
    matchWindowSeconds: input.matchWindowSeconds,
  });

  if (!existing) {
    return [
      ...badPoints,
      {
        sourceKey: input.sourceKey,
        timeSeconds,
        hitCount: 1,
        updatedAtMs: input.nowMs,
      },
    ];
  }

  return badPoints.map((point) =>
    point === existing
      ? {
          ...point,
          timeSeconds,
          hitCount: point.hitCount + 1,
          updatedAtMs: input.nowMs,
        }
      : point
  );
}

export function planStallEscapeResume(
  input: PlanStallEscapeResumeInput
): StallEscapeResumePlan {
  const currentPlayTime = input.currentPlayTime;
  if (!Number.isFinite(currentPlayTime) || currentPlayTime <= 1) {
    return {
      resumeTime: null,
      action: 'none',
      recordBadPointAt: null,
    };
  }

  const rewindSeconds = input.rewindSeconds ?? PLAYBACK_RESUME_REWIND_SECONDS;
  const skipForwardSeconds =
    input.skipForwardSeconds ?? PLAYBACK_BAD_POINT_SKIP_FORWARD_SECONDS;
  const matchWindowSeconds =
    input.matchWindowSeconds ?? PLAYBACK_BAD_POINT_MATCH_WINDOW_SECONDS;
  const mode = input.mode ?? 'same-source';
  const sourceKey = input.sourceKey ?? null;

  const nearby = findNearbyPlaybackBadPoint(input.badPoints, {
    timeSeconds: currentPlayTime,
    sourceKey,
    mode,
    matchWindowSeconds,
  });

  if (nearby) {
    const anchor = Math.max(nearby.timeSeconds, currentPlayTime);
    return {
      resumeTime: roundTime(anchor + skipForwardSeconds),
      action: 'skip-forward',
      recordBadPointAt: roundTime(currentPlayTime),
    };
  }

  if (input.preferExistingWithoutRewind) {
    return {
      resumeTime: roundTime(currentPlayTime),
      action: 'none',
      recordBadPointAt: null,
    };
  }

  return {
    resumeTime: roundTime(Math.max(0, currentPlayTime - rewindSeconds)),
    action: 'rewind',
    recordBadPointAt: roundTime(currentPlayTime),
  };
}

const SESSION_BAD_POINTS_STORAGE_KEY = 'katelya.playbackBadPoints.v1';

export function readPersistedPlaybackBadPoints(
  storage?: Pick<Storage, 'getItem'> | null
): PlaybackBadPoint[] {
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(SESSION_BAD_POINTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as PlaybackBadPoint[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (point) =>
        point &&
        typeof point.timeSeconds === 'number' &&
        typeof point.hitCount === 'number'
    );
  } catch {
    return [];
  }
}

export function writePersistedPlaybackBadPoints(
  badPoints: readonly PlaybackBadPoint[],
  storage?: Pick<Storage, 'setItem'> | null
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(SESSION_BAD_POINTS_STORAGE_KEY, JSON.stringify(badPoints));
  } catch {
    // Ignore quota / private mode failures.
  }
}
