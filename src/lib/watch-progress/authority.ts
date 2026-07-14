export type WatchProgressAuthorityMode = 'content-key' | 'legacy';

/**
 * Instant rollback for Watch Progress identity.
 * When false, reads/writes use legacy source+id keys only and must not
 * corrupt the content-key migration window.
 */
export function isWatchProgressContentKeyAuthorityEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_WATCH_PROGRESS_CONTENT_KEY_AUTHORITY !== 'false'
  );
}

export function getWatchProgressAuthorityMode(): WatchProgressAuthorityMode {
  return isWatchProgressContentKeyAuthorityEnabled() ? 'content-key' : 'legacy';
}

export function isWatchProgressDualWriteEnabled(): boolean {
  if (!isWatchProgressContentKeyAuthorityEnabled()) {
    return false;
  }

  return process.env.NEXT_PUBLIC_WATCH_PROGRESS_DUAL_WRITE !== 'false';
}
