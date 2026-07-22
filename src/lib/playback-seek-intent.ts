/**
 * Classify browser `seeking` events before they stamp Playback Intent.
 *
 * Domain rule: Playback Intent is stamped only by explicit user gestures.
 * iOS native HLS often emits `seeking`/`seeked` on buffer gaps and quality
 * shifts; treating those as user.seekStarted clears the escape budget and
 * gates automatic recovery (prod session 8bd17d7d: deniedBy=seeking ×44).
 */

export type SeekIntentClassification =
  | 'user'
  | 'system'
  | 'ambiguous-browser';

export interface ClassifySeekingEventInput {
  systemSeekInFlight: boolean;
  recoveryInFlight: 'R1' | 'R2' | 'R3' | 'resume' | null;
  /** Post-recovery grace (ignoreStallUntil / system-seek settle window). */
  automaticRecoveryGraceActive: boolean;
  stallEpisodeActive: boolean;
  /** Outstanding automatic skip-forward budget from this Playback Session. */
  escapeBudgetCharged: boolean;
  /**
   * Absolute playhead delta from the last healthy progress sample to the
   * seeking-time playhead, when known. Null when the adapter has no sample.
   */
  seekDeltaSeconds: number | null;
}

/** Tiny discontinuities are almost never intentional scrubbing. */
export const AMBIGUOUS_SEEK_DELTA_SECONDS = 1.5;
/**
 * During an active Stall Episode, iOS buffer repairs can move the playhead a
 * few seconds without user input — still not a user scrub.
 */
export const STALL_EPISODE_AMBIGUOUS_SEEK_DELTA_SECONDS = 3;

export function classifySeekingEvent(
  input: ClassifySeekingEventInput
): SeekIntentClassification {
  if (input.systemSeekInFlight) {
    return 'system';
  }

  if (
    input.recoveryInFlight === 'R1' ||
    input.recoveryInFlight === 'R2' ||
    input.recoveryInFlight === 'R3' ||
    input.recoveryInFlight === 'resume'
  ) {
    return 'ambiguous-browser';
  }

  if (input.automaticRecoveryGraceActive) {
    return 'ambiguous-browser';
  }

  const delta =
    input.seekDeltaSeconds != null && Number.isFinite(input.seekDeltaSeconds)
      ? Math.abs(input.seekDeltaSeconds)
      : null;

  if (
    input.stallEpisodeActive &&
    delta != null &&
    delta < STALL_EPISODE_AMBIGUOUS_SEEK_DELTA_SECONDS
  ) {
    return 'ambiguous-browser';
  }

  // Charged escape budget + small discontinuity: the previous automatic
  // skip-forward / buffer repair is still settling — do not wipe the budget.
  if (
    input.escapeBudgetCharged &&
    delta != null &&
    delta < STALL_EPISODE_AMBIGUOUS_SEEK_DELTA_SECONDS
  ) {
    return 'ambiguous-browser';
  }

  if (delta != null && delta < AMBIGUOUS_SEEK_DELTA_SECONDS) {
    return 'ambiguous-browser';
  }

  return 'user';
}

export function shouldStampSeekingPlaybackIntent(
  input: ClassifySeekingEventInput
): boolean {
  return classifySeekingEvent(input) === 'user';
}
