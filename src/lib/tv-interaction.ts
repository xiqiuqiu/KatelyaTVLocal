export const TV_MODE_QUERY_PARAM = 'tv';

const TV_ACTION_SELECTOR =
  'button:not(:disabled), a[href], [role="button"]:not([aria-disabled="true"]), [role="slider"]:not([aria-disabled="true"])';

export function isTvMode(searchParams: URLSearchParams): boolean {
  return searchParams.get(TV_MODE_QUERY_PARAM) === '1';
}

export function buildTvModeHref(href: string, enabled: boolean): string {
  const url = new URL(href);
  if (enabled) {
    url.searchParams.set(TV_MODE_QUERY_PARAM, '1');
  } else {
    url.searchParams.delete(TV_MODE_QUERY_PARAM);
  }
  return `${url.pathname}${url.search}${url.hash}`;
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
