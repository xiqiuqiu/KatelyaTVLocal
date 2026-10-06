'use client';

import { type RefObject, useEffect } from 'react';

import {
  isTvDirectionalKey,
  resolveTvBrowseFocusTarget,
  resolveTvRemoteClickTarget,
} from '@/lib/tv-interaction';

const ACTIONS =
  'button:not(:disabled):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), input[data-tv-input]:not(:disabled)';

function available(element: HTMLElement): boolean {
  if (
    !element.isConnected ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.closest('[hidden], [inert], [aria-hidden="true"]')
  )
    return false;
  for (
    let parent: HTMLElement | null = element;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    )
      return false;
  }
  return element.getBoundingClientRect().width > 0;
}

export default function useTvBrowseNavigation(
  rootRef: RefObject<HTMLDivElement>,
  enabled: boolean,
  page: string
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    const storageKey = `tv-browse-focus:${page}`;
    let remembered = '';
    try {
      remembered = sessionStorage.getItem(storageKey) || '';
    } catch {
      /* Storage may be unavailable in a TV WebView. */
    }
    let interacted = false;
    let pending: HTMLElement | null = null;
    let virtualPointer = false;
    let activating = false;
    let lastEnterAt = -Infinity;
    let lastRootFocus: HTMLElement | null = null;
    let lastDialog: HTMLElement | null = null;
    let frame = 0;
    const sessionId = `tv-browse-${Date.now().toString(36)}`;
    if (process.env.NODE_ENV === 'development')
      root.dataset.tvDebugSession = sessionId;

    const rememberFocus = (target: HTMLElement) => {
      const key = target.dataset.tvFocusKey;
      if (!key || !root.contains(target)) return;
      remembered = key;
      try {
        sessionStorage.setItem(storageKey, key);
      } catch {
        /* Keep navigation usable without storage. */
      }
    };

    const log = (eventType: string, payload: Record<string, unknown>) => {
      if (process.env.NODE_ENV !== 'development') return;
      void fetch('/api/tv-remote-debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          eventType,
          payload: { page, ...payload },
        }),
        keepalive: true,
      }).catch(() => undefined);
    };
    const dialog = () =>
      document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    const actions = (scope: HTMLElement) =>
      Array.from(scope.querySelectorAll<HTMLElement>(ACTIONS)).filter(
        available
      );
    const modalBack = (modal: HTMLElement) =>
      Array.from(
        modal.querySelectorAll<HTMLElement>('[data-tv-back], .swal2-cancel')
      ).find(available);
    const focusInitial = () => {
      const controls = actions(root);
      const saved = controls.find(
        (control) => control.dataset.tvFocusKey === remembered
      );
      const target =
        saved ||
        controls.find((control) => control.hasAttribute('data-tv-primary')) ||
        controls[0];
      target?.focus();
    };
    const recoverFocus = () => {
      frame = 0;
      const modal = dialog();
      if (modal) {
        lastDialog = modal;
        return;
      }
      if (lastDialog) {
        lastDialog = null;
        if (lastRootFocus && available(lastRootFocus)) lastRootFocus.focus();
        else focusInitial();
        return;
      }
      if (!interacted || document.activeElement === document.body)
        focusInitial();
    };
    const scheduleRecovery = () => {
      if (!frame) frame = requestAnimationFrame(recoverFocus);
    };
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const modal = dialog();
      if (modal && !modal.contains(event.target)) {
        lastDialog = modal;
        const back = modalBack(modal);
        if (back) activate(back, 'browse-back');
        return;
      }
      if (!root.contains(event.target) && !modal?.contains(event.target))
        return;
      event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (root.contains(event.target)) {
        lastRootFocus = event.target;
        if (interacted) rememberFocus(event.target);
      }
      log('browse-focus', {
        focus:
          event.target.dataset.tvFocusKey ||
          event.target.getAttribute('aria-label') ||
          event.target.textContent,
      });
    };
    const activate = (target: HTMLElement, eventType = 'browse-confirm') => {
      rememberFocus(target);
      activating = true;
      try {
        target.click();
      } finally {
        activating = false;
      }
      log(eventType, {
        focus:
          target.dataset.tvFocusKey ||
          target.getAttribute('aria-label') ||
          target.textContent,
      });
    };
    const onKey = (event: KeyboardEvent) => {
      const scope = dialog() || root;
      const controls = actions(scope);
      const current = controls.find(
        (control) => control === document.activeElement
      );
      // Editing belongs to the native input/IME, not directional page navigation.
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        (current instanceof HTMLInputElement && !current.readOnly)
      )
        return;
      if (isTvDirectionalKey(event.key)) {
        interacted = true;
        pending = null;
        lastEnterAt = -Infinity;
        event.preventDefault();
        event.stopImmediatePropagation();
        const target = current
          ? resolveTvBrowseFocusTarget({
              current,
              candidates: controls,
              key: event.key,
            })
          : controls[0];
        target?.focus();
        log('browse-direction', { key: event.key });
      } else if (event.key === 'Enter' && current) {
        interacted = true;
        event.preventDefault();
        event.stopImmediatePropagation();
        lastEnterAt = Date.now();
        activate(current);
      } else if (
        event.key === 'Escape' ||
        event.key === 'BrowserBack' ||
        event.keyCode === 4
      ) {
        const back =
          scope === root
            ? root.querySelector<HTMLElement>('[data-tv-back]')
            : modalBack(scope);
        if (!back) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (scope !== root) lastDialog = scope;
        pending = null;
        activate(back, 'browse-back');
      }
    };
    const onPointer = (event: PointerEvent) => {
      interacted = true;
      virtualPointer = event.pointerType === '';
      const active = document.activeElement;
      pending =
        virtualPointer &&
        active instanceof HTMLInputElement &&
        active.hasAttribute('data-tv-input')
          ? active
          : resolveTvRemoteClickTarget({
              pointerType: event.pointerType,
              activeElement: active,
              eventTarget: event.target,
            });
    };
    const onClick = (event: MouseEvent) => {
      if (activating) return;
      const target = pending;
      pending = null;
      const duplicate =
        (virtualPointer || event.detail === 0) &&
        Date.now() - lastEnterAt < 500;
      virtualPointer = false;
      if (duplicate) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else if (
        target &&
        actions(dialog() || root).includes(target) &&
        event.target !== target
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        target.focus();
        activate(target);
      } else {
        const clicked =
          event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>(ACTIONS)
            : null;
        if (clicked && actions(dialog() || root).includes(clicked)) {
          rememberFocus(clicked);
          log('browse-confirm', {
            focus:
              clicked.dataset.tvFocusKey ||
              clicked.getAttribute('aria-label') ||
              clicked.textContent,
          });
        }
      }
    };
    const observer = new MutationObserver(scheduleRecovery);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'aria-hidden'],
    });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('focusin', onFocus, true);
    scheduleRecovery();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      delete root.dataset.tvDebugSession;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('focusin', onFocus, true);
    };
  }, [enabled, page, rootRef]);
}
