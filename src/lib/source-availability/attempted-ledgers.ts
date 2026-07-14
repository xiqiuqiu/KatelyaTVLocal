/**
 * Two attempted ledgers for source work during a Playback Session title.
 *
 * - autoRecoveryAttempted: Session semantic — cleared on episode / title change
 * - probeSchedulingAttempted: probe budget evidence — retained across episodes
 *   within the same title; cleared only on title leave
 */
export interface SourceAttemptedLedgers {
  autoRecoveryAttempted: Set<string>;
  probeSchedulingAttempted: Set<string>;
}

export function clearAttemptedLedgersOnEpisodeChange(
  ledgers: SourceAttemptedLedgers
): SourceAttemptedLedgers {
  return {
    autoRecoveryAttempted: new Set(),
    probeSchedulingAttempted: ledgers.probeSchedulingAttempted,
  };
}

export function clearAttemptedLedgersOnTitleChange(): SourceAttemptedLedgers {
  return {
    autoRecoveryAttempted: new Set(),
    probeSchedulingAttempted: new Set(),
  };
}
