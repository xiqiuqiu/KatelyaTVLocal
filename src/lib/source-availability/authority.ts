export type SourceCandidateAuthorityMode = 'availability' | 'legacy';

export function isSourceAvailabilityCandidateAuthorityEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_SOURCE_AVAILABILITY_CANDIDATE_AUTHORITY !== 'false'
  );
}

export function getSourceCandidateAuthorityMode(): SourceCandidateAuthorityMode {
  return isSourceAvailabilityCandidateAuthorityEnabled()
    ? 'availability'
    : 'legacy';
}

export interface ResolveRecoveryCandidateSourceInput<T> {
  /** Evaluated only when authority mode is availability. */
  availabilitySelect: () => T | null;
  /** Evaluated only when authority mode is legacy — never AND/OR with Availability. */
  legacySelect: () => T | null;
}

/**
 * Single decision entry for automatic recovery candidates.
 * Availability and legacy are mutually exclusive — never AND/OR both authorities.
 */
export function resolveRecoveryCandidateSource<T>(
  input: ResolveRecoveryCandidateSourceInput<T>
): T | null {
  if (getSourceCandidateAuthorityMode() === 'availability') {
    return input.availabilitySelect();
  }

  return input.legacySelect();
}
