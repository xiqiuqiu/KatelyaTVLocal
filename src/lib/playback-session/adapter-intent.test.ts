import {
  createInitialPlaybackSessionState,
  getPlaybackIntentAuthorityMode,
  reducePlaybackSession,
  resolveAdapterAutomaticEffectAllowed,
} from '@/lib/playback-session';

describe('Playback Intent adapter gate mapping', () => {
  const originalFlag = process.env.NEXT_PUBLIC_PLAYBACK_INTENT_SESSION_AUTHORITY;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.NEXT_PUBLIC_PLAYBACK_INTENT_SESSION_AUTHORITY;
    } else {
      process.env.NEXT_PUBLIC_PLAYBACK_INTENT_SESSION_AUTHORITY = originalFlag;
    }
  });

  it('maps Session user-paused to denied recovery when session authority is on', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_INTENT_SESSION_AUTHORITY = 'true';
    expect(getPlaybackIntentAuthorityMode()).toBe('session');

    const paused = reducePlaybackSession(createInitialPlaybackSessionState(), {
      type: 'user.pause',
    }).state;

    expect(
      resolveAdapterAutomaticEffectAllowed({
        kind: 'same-source-recovery',
        nowMs: 10_000,
        sessionState: paused,
        legacyIsUserPaused: false,
      })
    ).toBe(false);
  });

  it('maps legacy pause alone when session authority is off', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_INTENT_SESSION_AUTHORITY = 'false';

    const playing = createInitialPlaybackSessionState({
      playbackIntent: 'playing',
    });

    expect(
      resolveAdapterAutomaticEffectAllowed({
        kind: 'same-source-recovery',
        nowMs: 10_000,
        sessionState: playing,
        legacyIsUserPaused: true,
      })
    ).toBe(false);

    expect(
      resolveAdapterAutomaticEffectAllowed({
        kind: 'same-source-recovery',
        nowMs: 10_000,
        sessionState: playing,
        legacyIsUserPaused: false,
      })
    ).toBe(true);
  });
});
