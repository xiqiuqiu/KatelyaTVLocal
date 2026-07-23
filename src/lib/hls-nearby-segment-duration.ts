/**
 * Read the nearby media segment duration from an hls.js-like playlist level
 * for Segment-Scaled Escape (ADR 0007). Pure helper — adapters pass the
 * current playhead; no recovery policy lives here.
 */

export interface HlsNearbySegmentLevelLike {
  details?: {
    fragments?: Array<{ start?: number; duration?: number } | null> | null;
    targetduration?: number | null;
    averagetargetduration?: number | null;
  } | null;
}

export interface HlsNearbySegmentControllerLike {
  levels?: Array<HlsNearbySegmentLevelLike | null> | null;
  currentLevel?: number | null;
  loadLevel?: number | null;
}

export function getNearbyHlsSegmentDurationSeconds(
  hls: HlsNearbySegmentControllerLike | null | undefined,
  currentTimeSeconds: number
): number | null {
  if (!hls?.levels?.length) {
    return null;
  }

  const levelIndex =
    typeof hls.currentLevel === 'number' && hls.currentLevel >= 0
      ? hls.currentLevel
      : typeof hls.loadLevel === 'number' && hls.loadLevel >= 0
        ? hls.loadLevel
        : 0;
  const level = hls.levels[levelIndex] || hls.levels[0];
  const details = level?.details;
  if (!details) {
    return null;
  }

  const fragments = details.fragments;
  if (Array.isArray(fragments) && Number.isFinite(currentTimeSeconds)) {
    let best: { duration: number; distance: number } | null = null;
    for (const frag of fragments) {
      if (!frag || typeof frag.duration !== 'number' || frag.duration <= 0) {
        continue;
      }
      const start = typeof frag.start === 'number' ? frag.start : null;
      if (start == null) {
        continue;
      }
      const end = start + frag.duration;
      const distance =
        currentTimeSeconds < start
          ? start - currentTimeSeconds
          : currentTimeSeconds > end
            ? currentTimeSeconds - end
            : 0;
      if (!best || distance < best.distance) {
        best = { duration: frag.duration, distance };
      }
      if (distance === 0) {
        break;
      }
    }
    if (best) {
      return Number(best.duration.toFixed(2));
    }
  }

  const target =
    (typeof details.targetduration === 'number' && details.targetduration > 0
      ? details.targetduration
      : null) ??
    (typeof details.averagetargetduration === 'number' &&
    details.averagetargetduration > 0
      ? details.averagetargetduration
      : null);
  return target != null ? Number(target.toFixed(2)) : null;
}
