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
