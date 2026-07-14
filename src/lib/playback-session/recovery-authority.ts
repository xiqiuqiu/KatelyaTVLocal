export type PlaybackRecoveryAuthorityMode = 'session' | 'legacy';
export type NativeJitterRoutingMode = 'session-tree' | 'legacy-parallel';

/**
 * Paired rollback for Session R/Resume + Native jitter routing.
 * When false, adapters restore legacy parallel commanders together.
 */
export function isPlaybackRecoverySessionAuthorityEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_PLAYBACK_RECOVERY_SESSION_AUTHORITY !== 'false'
  );
}

export function getPlaybackRecoveryAuthorityMode(): PlaybackRecoveryAuthorityMode {
  return isPlaybackRecoverySessionAuthorityEnabled() ? 'session' : 'legacy';
}

/**
 * Native jitter must enter the same decision tree as the watchdog when
 * Session recovery authority is on — never a parallel skip/switch commander.
 */
export function resolveNativeJitterRouting(): NativeJitterRoutingMode {
  return getPlaybackRecoveryAuthorityMode() === 'session'
    ? 'session-tree'
    : 'legacy-parallel';
}
