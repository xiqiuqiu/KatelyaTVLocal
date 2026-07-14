import {
  allowsAutomaticEffect,
  createInitialPlaybackSessionState,
  getPlaybackIntentAuthorityMode,
  reducePlaybackSession,
  resolveAutomaticEffectGate,
} from '@/lib/playback-session';

describe('Playback Intent authority façade', () => {
  const originalFlag =
    process.env.NEXT_PUBLIC_PLAYBACK_INTENT_SESSION_AUTHORITY;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.NEXT_PUBLIC_PLAYBACK_INTENT_SESSION_AUTHORITY;
    } else {
      process.env.NEXT_PUBLIC_PLAYBACK_INTENT_SESSION_AUTHORITY = originalFlag;
    }
  });

  it('uses Session Intent alone when authority flag is enabled', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_INTENT_SESSION_AUTHORITY = 'true';
    expect(getPlaybackIntentAuthorityMode()).toBe('session');

    const paused = reducePlaybackSession(createInitialPlaybackSessionState(), {
      type: 'user.pause',
    }).state;

    const gate = resolveAutomaticEffectGate({
      kind: 'auto-source-switch',
      nowMs: 10_000,
      sessionState: paused,
      legacyAllowed: true,
    });

    expect(gate).toEqual({ allowed: false, deniedBy: 'user-paused' });
    expect(allowsAutomaticEffect(paused, 'auto-source-switch', 10_000)).toBe(
      false
    );
  });

  it('uses legacy gate alone when authority flag is disabled', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_INTENT_SESSION_AUTHORITY = 'false';
    expect(getPlaybackIntentAuthorityMode()).toBe('legacy');

    const paused = reducePlaybackSession(createInitialPlaybackSessionState(), {
      type: 'user.pause',
    }).state;

    const allowedByLegacy = resolveAutomaticEffectGate({
      kind: 'auto-source-switch',
      nowMs: 10_000,
      sessionState: paused,
      legacyAllowed: true,
    });
    expect(allowedByLegacy).toEqual({ allowed: true });

    const deniedByLegacy = resolveAutomaticEffectGate({
      kind: 'auto-source-switch',
      nowMs: 10_000,
      sessionState: createInitialPlaybackSessionState({
        playbackIntent: 'playing',
      }),
      legacyAllowed: false,
      legacyDeniedBy: 'user-paused',
    });
    expect(deniedByLegacy).toEqual({
      allowed: false,
      deniedBy: 'user-paused',
    });
  });
});
