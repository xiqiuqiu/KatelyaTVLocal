import {
  AMBIGUOUS_SEEK_DELTA_SECONDS,
  classifySeekingEvent,
  shouldStampSeekingPlaybackIntent,
  STALL_EPISODE_AMBIGUOUS_SEEK_DELTA_SECONDS,
} from '@/lib/playback-seek-intent';

const base = {
  systemSeekInFlight: false,
  recoveryInFlight: null as null,
  automaticRecoveryGraceActive: false,
  stallEpisodeActive: false,
  escapeBudgetCharged: false,
  seekDeltaSeconds: 45,
};

describe('classifySeekingEvent (iOS spurious seeking gate)', () => {
  it('stamps large intentional scrubs as user intent', () => {
    expect(classifySeekingEvent(base)).toBe('user');
    expect(shouldStampSeekingPlaybackIntent(base)).toBe(true);
  });

  it('classifies system seeks as system', () => {
    expect(
      classifySeekingEvent({ ...base, systemSeekInFlight: true })
    ).toBe('system');
    expect(
      shouldStampSeekingPlaybackIntent({ ...base, systemSeekInFlight: true })
    ).toBe(false);
  });

  it('does not stamp seeking during automatic recovery in-flight', () => {
    for (const recoveryInFlight of ['R1', 'R2', 'R3', 'resume'] as const) {
      expect(
        classifySeekingEvent({ ...base, recoveryInFlight, seekDeltaSeconds: 20 })
      ).toBe('ambiguous-browser');
    }
  });

  it('does not stamp seeking inside post-recovery grace', () => {
    expect(
      classifySeekingEvent({
        ...base,
        automaticRecoveryGraceActive: true,
        seekDeltaSeconds: 20,
      })
    ).toBe('ambiguous-browser');
  });

  it('treats small discontinuities during a Stall Episode as browser noise', () => {
    expect(
      classifySeekingEvent({
        ...base,
        stallEpisodeActive: true,
        seekDeltaSeconds: STALL_EPISODE_AMBIGUOUS_SEEK_DELTA_SECONDS - 0.1,
      })
    ).toBe('ambiguous-browser');
  });

  it('preserves charged escape budget against small post-escape seeking noise', () => {
    // Prod 8bd17d7d: after +20 R2 escapes, iOS fired seeking and wiped budget.
    expect(
      classifySeekingEvent({
        ...base,
        escapeBudgetCharged: true,
        seekDeltaSeconds: 2.5,
      })
    ).toBe('ambiguous-browser');
  });

  it('treats tiny playhead jitters as ambiguous even when idle', () => {
    expect(
      classifySeekingEvent({
        ...base,
        seekDeltaSeconds: AMBIGUOUS_SEEK_DELTA_SECONDS - 0.1,
      })
    ).toBe('ambiguous-browser');
  });

  it('still allows a real scrub while escape budget is charged', () => {
    expect(
      classifySeekingEvent({
        ...base,
        escapeBudgetCharged: true,
        seekDeltaSeconds: 90,
      })
    ).toBe('user');
  });
});
