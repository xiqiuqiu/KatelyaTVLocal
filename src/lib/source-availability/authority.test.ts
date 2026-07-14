import {
  getSourceCandidateAuthorityMode,
  resolveRecoveryCandidateSource,
} from './authority';

describe('Source Availability candidate authority façade', () => {
  const originalFlag =
    process.env.NEXT_PUBLIC_SOURCE_AVAILABILITY_CANDIDATE_AUTHORITY;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.NEXT_PUBLIC_SOURCE_AVAILABILITY_CANDIDATE_AUTHORITY;
    } else {
      process.env.NEXT_PUBLIC_SOURCE_AVAILABILITY_CANDIDATE_AUTHORITY =
        originalFlag;
    }
  });

  it('uses Availability alone when authority flag is enabled', () => {
    process.env.NEXT_PUBLIC_SOURCE_AVAILABILITY_CANDIDATE_AUTHORITY = 'true';
    expect(getSourceCandidateAuthorityMode()).toBe('availability');

    let legacyCalls = 0;
    const selected = resolveRecoveryCandidateSource({
      availabilitySelect: () => 'availability-candidate',
      legacySelect: () => {
        legacyCalls += 1;
        return 'legacy-candidate';
      },
    });

    expect(selected).toBe('availability-candidate');
    expect(legacyCalls).toBe(0);
  });

  it('uses legacy alone when authority flag is disabled', () => {
    process.env.NEXT_PUBLIC_SOURCE_AVAILABILITY_CANDIDATE_AUTHORITY = 'false';
    expect(getSourceCandidateAuthorityMode()).toBe('legacy');

    let availabilityCalls = 0;
    const selected = resolveRecoveryCandidateSource({
      availabilitySelect: () => {
        availabilityCalls += 1;
        return 'availability-candidate';
      },
      legacySelect: () => 'legacy-candidate',
    });

    expect(selected).toBe('legacy-candidate');
    expect(availabilityCalls).toBe(0);
  });
});
