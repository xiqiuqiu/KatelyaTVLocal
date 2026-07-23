/**
 * Stall escape: record bad playhead points and skip past them on retry.
 *
 * First hit near a freeze applies a small edge rewind (clear the segment
 * boundary). Later hits in the same Known Fault Interval use Segment-Scaled
 * Escape — roughly one nearby media segment — so refresh/source-switch/recovery
 * can get past the stuck point without burning tens of seconds of plot
 * (ADR 0007 / #48).
 */

/** Small boundary correction before a forward Segment-Scaled Escape. */
export const PLAYBACK_EDGE_REWIND_SECONDS = 1.5;
/**
 * Typical mid-segment fallback when playlist `#EXTINF` is unavailable.
 * Distinct from playlist-true escapes in telemetry (`scale: 'fallback'`).
 */
export const PLAYBACK_FALLBACK_SEGMENT_DURATION_SECONDS = 7;
export const PLAYBACK_BAD_POINT_MATCH_WINDOW_SECONDS = 10;

/** @deprecated Prefer {@link PLAYBACK_EDGE_REWIND_SECONDS}. */
export const PLAYBACK_RESUME_REWIND_SECONDS = PLAYBACK_EDGE_REWIND_SECONDS;
/** @deprecated Prefer {@link PLAYBACK_FALLBACK_SEGMENT_DURATION_SECONDS}. */
export const PLAYBACK_BAD_POINT_SKIP_FORWARD_SECONDS =
  PLAYBACK_FALLBACK_SEGMENT_DURATION_SECONDS;

export type StallEscapeAction = 'rewind' | 'skip-forward' | 'none';
export type StallEscapeScale = 'playlist' | 'fallback';

export interface PlaybackBadPoint {
  sourceKey: string | null;
  timeSeconds: number;
  hitCount: number;
  updatedAtMs: number;
  /**
   * Exclusive end of the Known Fault Interval projected from this Bad Point.
   * Expanded when overlapping failures merge on the same source.
   */
  escapeEndSeconds?: number;
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
  /**
   * Nearby playlist media segment duration (`#EXTINF`). When finite and
   * positive, drives Segment-Scaled Escape; otherwise the mid-segment fallback
   * is used (unless `skipForwardSeconds` is explicitly provided).
   */
  nearbySegmentDurationSeconds?: number | null;
  matchWindowSeconds?: number;
  /**
   * When true, an already-planned resume target is kept as-is unless it sits
   * inside a known bad window (then skip forward). Avoids double rewind.
   */
  preferExistingWithoutRewind?: boolean;
  /**
   * When true, never emit skip-forward (used during post-ad-skip grace on iOS
   * so Bad Point escape cannot stack seeks after the ad jump).
   */
  suppressSkipForward?: boolean;
}

export interface StallEscapeResumePlan {
  resumeTime: number | null;
  action: StallEscapeAction;
  /** Caller should persist this time as a bad point when non-null. */
  recordBadPointAt: number | null;
  /** Telemetry: playlist-true vs mid-segment fallback for forward escapes. */
  escapeScale: StallEscapeScale | null;
  /** Seconds used for the forward escape quantum (null for rewind/none). */
  escapeSpanSeconds: number | null;
}

export function resolveSegmentScaledEscapeSeconds(
  nearbySegmentDurationSeconds?: number | null
): { seconds: number; scale: StallEscapeScale } {
  if (
    typeof nearbySegmentDurationSeconds === 'number' &&
    Number.isFinite(nearbySegmentDurationSeconds) &&
    nearbySegmentDurationSeconds > 0.25 &&
    nearbySegmentDurationSeconds <= 30
  ) {
    return {
      seconds: Number(nearbySegmentDurationSeconds.toFixed(2)),
      scale: 'playlist',
    };
  }
  return {
    seconds: PLAYBACK_FALLBACK_SEGMENT_DURATION_SECONDS,
    scale: 'fallback',
  };
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

    const intervalEnd = point.escapeEndSeconds ?? point.timeSeconds;
    const inKnownFaultInterval =
      input.timeSeconds >= point.timeSeconds - matchWindow &&
      input.timeSeconds < intervalEnd + 0.01;
    const distance = Math.abs(point.timeSeconds - input.timeSeconds);
    if (!inKnownFaultInterval && distance > matchWindow) {
      continue;
    }
    if (distance >= bestDistance && !inKnownFaultInterval) {
      continue;
    }
    // Prefer the closest anchor; when inside an interval, prefer the one that
    // covers the playhead even if the anchor is slightly farther.
    const rank = inKnownFaultInterval
      ? Math.min(distance, Math.abs(intervalEnd - input.timeSeconds))
      : distance;
    if (rank >= bestDistance && best != null) {
      continue;
    }

    best = point;
    bestDistance = rank;
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
    /** Expand the Known Fault Interval exclusive end when merging. */
    escapeEndSeconds?: number;
  }
): PlaybackBadPoint[] {
  if (!Number.isFinite(input.timeSeconds) || input.timeSeconds <= 1) {
    return [...badPoints];
  }

  const timeSeconds = roundTime(input.timeSeconds);
  const escapeEndSeconds =
    typeof input.escapeEndSeconds === 'number' &&
    Number.isFinite(input.escapeEndSeconds)
      ? roundTime(Math.max(input.escapeEndSeconds, timeSeconds))
      : undefined;
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
        ...(escapeEndSeconds != null ? { escapeEndSeconds } : {}),
      },
    ];
  }

  return badPoints.map((point) => {
    if (point !== existing) {
      return point;
    }
    const mergedEscapeEnd = Math.max(
      point.escapeEndSeconds ?? point.timeSeconds,
      escapeEndSeconds ?? timeSeconds,
      timeSeconds
    );
    return {
      ...point,
      timeSeconds: Math.min(point.timeSeconds, timeSeconds),
      hitCount: point.hitCount + 1,
      updatedAtMs: input.nowMs,
      escapeEndSeconds: roundTime(mergedEscapeEnd),
    };
  });
}

/**
 * Drop Bad Points that sit inside (or within matchWindow of) an Ad Skip Window.
 * Stalls recorded inside the ad must not fire Segment-Scaled Escape after the
 * ad seek (previously a fixed +20s stack that yielded ~40s jumps).
 */
export function purgeBadPointsOverlappingAdSkipWindow(
  badPoints: readonly PlaybackBadPoint[],
  input: {
    startTimeSeconds: number;
    endTimeSeconds: number;
    sourceKey?: string | null;
    matchWindowSeconds?: number;
  }
): PlaybackBadPoint[] {
  if (!badPoints.length) {
    return [];
  }

  const matchWindow =
    input.matchWindowSeconds ?? PLAYBACK_BAD_POINT_MATCH_WINDOW_SECONDS;
  const lo = input.startTimeSeconds - matchWindow;
  const hi = input.endTimeSeconds + matchWindow;
  const sourceKey = input.sourceKey ?? null;

  return badPoints.filter((point) => {
    if (sourceKey != null && point.sourceKey !== sourceKey) {
      return true;
    }
    return point.timeSeconds < lo || point.timeSeconds > hi;
  });
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
      escapeScale: null,
      escapeSpanSeconds: null,
    };
  }

  const rewindSeconds = input.rewindSeconds ?? PLAYBACK_EDGE_REWIND_SECONDS;
  const resolvedSkip =
    typeof input.skipForwardSeconds === 'number' &&
    Number.isFinite(input.skipForwardSeconds)
      ? {
          seconds: input.skipForwardSeconds,
          scale: 'fallback' as StallEscapeScale,
        }
      : resolveSegmentScaledEscapeSeconds(input.nearbySegmentDurationSeconds);
  const skipForwardSeconds = resolvedSkip.seconds;
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
    if (input.suppressSkipForward) {
      return {
        resumeTime: roundTime(currentPlayTime),
        action: 'none',
        recordBadPointAt: null,
        escapeScale: null,
        escapeSpanSeconds: null,
      };
    }

    const projectedEscapeEnd =
      typeof nearby.escapeEndSeconds === 'number' &&
      Number.isFinite(nearby.escapeEndSeconds) &&
      nearby.escapeEndSeconds > nearby.timeSeconds + 0.01
        ? nearby.escapeEndSeconds
        : null;
    // Still inside a prior Known Fault Interval → land on its escapeEnd.
    // Otherwise advance one Segment-Scaled Escape quantum past the hazard.
    let resumeTime: number;
    if (
      projectedEscapeEnd != null &&
      currentPlayTime + 0.01 < projectedEscapeEnd
    ) {
      resumeTime = roundTime(projectedEscapeEnd);
    } else {
      const anchor = Math.max(
        nearby.timeSeconds,
        currentPlayTime,
        projectedEscapeEnd ?? 0
      );
      resumeTime = roundTime(anchor + skipForwardSeconds);
    }

    return {
      resumeTime,
      action: 'skip-forward',
      recordBadPointAt: roundTime(currentPlayTime),
      escapeScale: resolvedSkip.scale,
      escapeSpanSeconds: skipForwardSeconds,
    };
  }

  if (input.preferExistingWithoutRewind) {
    return {
      resumeTime: roundTime(currentPlayTime),
      action: 'none',
      recordBadPointAt: null,
      escapeScale: null,
      escapeSpanSeconds: null,
    };
  }

  return {
    resumeTime: roundTime(Math.max(0, currentPlayTime - rewindSeconds)),
    action: 'rewind',
    recordBadPointAt: roundTime(currentPlayTime),
    escapeScale: null,
    escapeSpanSeconds: null,
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
