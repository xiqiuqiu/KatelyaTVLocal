export type PlaybackRecoveryAuthorityMode = 'session' | 'legacy';

/** Selects the shared Session recovery ladder or the legacy hls.js planner. */
export function isPlaybackRecoverySessionAuthorityEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY !== 'false'
  );
}

export function getPlaybackRecoveryAuthorityMode(): PlaybackRecoveryAuthorityMode {
  return isPlaybackRecoverySessionAuthorityEnabled() ? 'session' : 'legacy';
}
