export const TV_MODE_QUERY_PARAM = 'tv';
export const TV_MODE_PREFERENCE_COOKIE = 'katelya_tv_mode';

export function isTvBrowser(userAgent: string): boolean {
  // Q7F Pro's WebView has no generic TV marker; use its verified device ID.
  return /\b(?:8R710_Q7FP|smart[-_ ]?tv|android[-_ ]?tv|google[-_ ]?tv|hbbtv|netcast|web0s|webos\.tv|vidaa|viera|roku|crkey|AFT[A-Z0-9]+)\b/i.test(
    userAgent
  );
}

const TV_ACTION_SELECTOR =
  'button:not(:disabled), a[href], [role="button"]:not([aria-disabled="true"]), [role="slider"]:not([aria-disabled="true"])';

export function isTvMode(searchParams: URLSearchParams): boolean {
  return searchParams.get(TV_MODE_QUERY_PARAM) === '1';
}

export function buildTvModeHref(href: string, enabled: boolean): string {
  const url = new URL(href, 'https://tv.local');
  if (enabled) {
    url.searchParams.set(TV_MODE_QUERY_PARAM, '1');
  } else url.searchParams.set(TV_MODE_QUERY_PARAM, '0');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function resolveTvBrowseFocusTarget(input: {
  current: HTMLElement;
  candidates: HTMLElement[];
  key: string;
}): HTMLElement | null {
  if (!isTvDirectionalKey(input.key)) return null;
  const horizontal = input.key === 'ArrowLeft' || input.key === 'ArrowRight';
  const sign = input.key === 'ArrowLeft' || input.key === 'ArrowUp' ? -1 : 1;
  const rect = input.current.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const candidate of input.candidates) {
    if (candidate === input.current) continue;
    if (
      horizontal &&
      input.current.hasAttribute('data-tv-card-primary') &&
      candidate.closest('article') === input.current.closest('article')
    )
      continue;
    const next = candidate.getBoundingClientRect();
    const dx = next.left + next.width / 2 - x;
    const dy = next.top + next.height / 2 - y;
    const forward = (horizontal ? dx : dy) * sign;
    if (forward <= 1) continue;
    const cross = Math.abs(horizontal ? dy : dx);
    const overlaps = horizontal
      ? next.top < rect.bottom && next.bottom > rect.top
      : next.left < rect.right && next.right > rect.left;
    if (!overlaps && cross > forward) continue;
    // Measure alignment to the target's span so wide inputs aren't skipped.
    const crossGap = horizontal
      ? Math.max(next.top - y, y - next.bottom, 0)
      : Math.max(next.left - x, x - next.right, 0);
    const score = forward + crossGap * 3 + (overlaps ? 0 : 10000);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function resolveTvRemoteClickTarget(input: {
  pointerType: string;
  activeElement: Element | null;
  eventTarget: EventTarget | null;
}): HTMLElement | null {
  const { pointerType, activeElement } = input;
  if (
    pointerType !== '' ||
    !(activeElement instanceof HTMLElement) ||
    !activeElement.matches(TV_ACTION_SELECTOR)
  ) {
    return null;
  }
  return activeElement;
}

export function isTvDirectionalKey(key: string): boolean {
  return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key);
}

export function shouldWakeTvPlayerControls(input: {
  key: string;
  isTvMode: boolean;
  isFullscreen: boolean;
  controlsVisible: boolean;
  hasFocusedControl: boolean;
}): boolean {
  return (
    input.isTvMode &&
    input.isFullscreen &&
    isTvDirectionalKey(input.key) &&
    (!input.controlsVisible || !input.hasFocusedControl)
  );
}

export function resolveTvPlayerConfirmTarget(input: {
  key: string;
  eventTarget: EventTarget | null;
  activeElement?: Element | null;
}): HTMLElement | null {
  if (input.key !== 'Enter') {
    return null;
  }

  const control =
    (input.activeElement instanceof HTMLElement
      ? input.activeElement.closest<HTMLElement>(
          '[data-tv-player-control="true"]'
        )
      : null) ||
    (input.eventTarget instanceof HTMLElement
      ? input.eventTarget.closest<HTMLElement>(
          '[data-tv-player-control="true"]'
        )
      : null);
  return control?.getAttribute('role') === 'button' ? control : null;
}

export function resolveTvPlayerActivationTarget(
  control: HTMLElement
): HTMLElement {
  const visibleIcon = Array.from(control.children).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      child.classList.contains('art-icon') &&
      child.style.display !== 'none'
  );
  return visibleIcon || control;
}

export function resolveTvPlayerHorizontalControlTarget(input: {
  player: HTMLElement;
  current: HTMLElement;
  key: string;
}): HTMLElement | null {
  if (!['ArrowLeft', 'ArrowRight'].includes(input.key)) return null;

  const controls = Array.from(
    input.player.querySelectorAll<HTMLElement>(
      '.art-controls [data-tv-player-control="true"]'
    )
  ).filter(
    (control) =>
      !control.hidden &&
      control.style.display !== 'none' &&
      control.getAttribute('aria-hidden') !== 'true' &&
      control.getAttribute('aria-disabled') !== 'true'
  );
  const currentIndex = controls.indexOf(input.current);
  if (currentIndex < 0) return null;

  const nextIndex = currentIndex + (input.key === 'ArrowLeft' ? -1 : 1);
  return controls[nextIndex] || input.current;
}

export function getTvSeekTime(
  currentTime: number,
  duration: number,
  deltaSeconds: number
): number {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const safeCurrent = Number.isFinite(currentTime) ? currentTime : 0;
  return Math.min(safeDuration, Math.max(0, safeCurrent + deltaSeconds));
}
