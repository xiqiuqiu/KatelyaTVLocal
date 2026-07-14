import {
  getPlaybackRecoveryAuthorityMode,
  isPlaybackRecoverySessionAuthorityEnabled,
  resolveNativeJitterRouting,
} from '@/lib/playback-session';

describe('Playback Recovery authority façade (paired rollback)', () => {
  const originalFlag =
    process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY;
    } else {
      process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY = originalFlag;
    }
  });

  it('routes Native jitter into the Session tree when recovery authority is on', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY = 'true';
    expect(isPlaybackRecoverySessionAuthorityEnabled()).toBe(true);
    expect(getPlaybackRecoveryAuthorityMode()).toBe('session');
    expect(resolveNativeJitterRouting()).toBe('session-tree');
  });

  it('restores legacy parallel jitter routing together when authority is off', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY = 'false';
    expect(getPlaybackRecoveryAuthorityMode()).toBe('legacy');
    expect(resolveNativeJitterRouting()).toBe('legacy-parallel');
  });
});
