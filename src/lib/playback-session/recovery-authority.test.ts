import {
  getPlaybackRecoveryAuthorityMode,
  isPlaybackRecoverySessionAuthorityEnabled,
} from '@/lib/playback-session';

describe('Playback Recovery authority façade', () => {
  const originalFlag =
    process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY;
    } else {
      process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY =
        originalFlag;
    }
  });

  it('uses the Session tree when recovery authority is on', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY = 'true';
    expect(isPlaybackRecoverySessionAuthorityEnabled()).toBe(true);
    expect(getPlaybackRecoveryAuthorityMode()).toBe('session');
  });

  it('restores the legacy hls.js planner when authority is off', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY = 'false';
    expect(getPlaybackRecoveryAuthorityMode()).toBe('legacy');
  });
});
