/**
 * Play-page player mount helpers.
 *
 * Next.js syncs `history.replaceState` into `useSearchParams`. Soft source
 * switches therefore change `playIdentityKey` and can remount the loading gate,
 * destroying ArtPlayer's DOM while leaving a stale `artPlayerRef`. These helpers
 * keep soft switches from re-entering full init and detect detached players.
 */

export type ArtPlayerLike = {
  template?: { $container?: HTMLElement | null };
  container?: HTMLElement | null;
};

/** True when the ArtPlayer instance is still attached to the live React host. */
export function isArtPlayerBoundToContainer(
  player: ArtPlayerLike | null | undefined,
  container: HTMLElement | null | undefined
): boolean {
  if (!player || !container || !container.isConnected) {
    return false;
  }

  const playerContainer =
    player.template?.$container || player.container || null;
  if (!playerContainer) {
    // Cannot verify ownership — only treat as bound if the host still has DOM.
    return container.childElementCount > 0;
  }

  return (
    playerContainer.isConnected &&
    (playerContainer === container || container.contains(playerContainer))
  );
}

/**
 * Soft source switches set a one-shot skip so URL identity churn does not tear
 * down the in-page player via the loading gate.
 */
export function consumePlayIdentityInitSkip(skipNext: boolean): {
  runInit: boolean;
  clearSkip: boolean;
} {
  if (skipNext) {
    return { runInit: false, clearSkip: true };
  }
  return { runInit: true, clearSkip: false };
}

/**
 * `video:ended` schedules the next episode after the completion save. A manual
 * episode pick in that gap must win — only advance when the page is still on
 * the episode that ended.
 */
export function shouldAutoAdvanceEndedEpisode(input: {
  endedEpisodeIndex: number;
  currentEpisodeIndex: number;
}): boolean {
  return input.currentEpisodeIndex === input.endedEpisodeIndex;
}

/**
 * While a new episode's media is still the previous element, live currentTime
 * and duration belong to the episode being left. Callers must pass the snapped
 * values instead of reading the player.
 */
export function resolveEpisodeProgressSnapshot(input: {
  episodeIndex: number;
  playTime: number;
  totalTime: number;
}): { episodeIndex: number; playTime: number; totalTime: number } {
  const playTime = Number.isFinite(input.playTime)
    ? Math.max(0, Math.floor(input.playTime))
    : 0;
  const totalTime = Number.isFinite(input.totalTime)
    ? Math.max(0, Math.floor(input.totalTime))
    : 0;
  return {
    episodeIndex: input.episodeIndex,
    playTime,
    totalTime,
  };
}

/** Prefer a non-empty detail/search title over wiping the play URL title. */
export function resolvePlayUrlTitle(input: {
  detailTitle?: string | null;
  urlTitle?: string | null;
  fallbackTitle?: string | null;
}): string {
  const detail = (input.detailTitle || '').trim();
  if (detail) {
    return detail;
  }
  const url = (input.urlTitle || '').trim();
  if (url) {
    return url;
  }
  return (input.fallbackTitle || '').trim();
}
