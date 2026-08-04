'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import {
  type PlaybackPreparationIntent,
  type PlaybackPreparationRect,
  createPlaybackPreparationState,
  reducePlaybackPreparationTransition,
} from '@/lib/playback-preparation-transition';
import { processImageUrl } from '@/lib/utils';

type StartPlaybackPreparationInput = Omit<PlaybackPreparationIntent, 'origin'>;

type PlaybackPreparationApi = {
  active: boolean;
  start: (input: StartPlaybackPreparationInput) => void;
  markFrameReady: () => void;
  markTerminalFailure: () => void;
  cancel: () => void;
};

const inactiveApi: PlaybackPreparationApi = {
  active: false,
  start: () => undefined,
  markFrameReady: () => undefined,
  markTerminalFailure: () => undefined,
  cancel: () => undefined,
};

const PlaybackPreparationContext =
  createContext<PlaybackPreparationApi>(inactiveApi);

const ENTER_DURATION_MS = 320;
const READY_FADE_MS = 200;
const LATE_NAVIGATION_TTL_MS = 30_000;

function readReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function currentHref(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function pathnameOf(href: string): string {
  return new URL(href, window.location.origin).pathname;
}

function hrefMatchesTarget(current: string, target: string): boolean {
  const currentUrl = new URL(current, window.location.origin);
  const targetUrl = new URL(target, window.location.origin);
  if (currentUrl.pathname !== targetUrl.pathname) return false;
  if (targetUrl.hash && currentUrl.hash !== targetUrl.hash) return false;

  return Array.from(targetUrl.searchParams.entries()).every(
    ([key, value]) => currentUrl.searchParams.getAll(key).includes(value)
  );
}

function getPlayerRect(): PlaybackPreparationRect {
  const target = document.querySelector<HTMLElement>(
    '[data-playback-preparation-target]'
  );
  if (target) {
    const rect = target.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    }
  }

  const width = Math.min(1120, window.innerWidth * 0.94);
  const height = width * (9 / 16);
  return {
    top: Math.max(72, (window.innerHeight - height) / 2 - 24),
    left: (window.innerWidth - width) / 2,
    width,
    height,
  };
}

function findOriginCard(cardKey: string): HTMLElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-playback-preparation-card]')
    ).find((element) => element.dataset.playbackPreparationCard === cardKey) ??
    null
  );
}

function restoreOrigin(intent: PlaybackPreparationIntent) {
  window.scrollTo({ top: intent.origin.scrollY, left: 0, behavior: 'auto' });
  const card = findOriginCard(intent.cardKey);
  if (!card) return;

  card.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: 'auto',
  });
  const focusTarget = card.matches('button, a, [tabindex]')
    ? card
    : card.querySelector<HTMLElement>('button, a, [tabindex]');
  focusTarget?.focus({ preventScroll: true });
}

function PlaybackPreparationOverlay({
  intent,
  returning,
  ready,
  onCancel,
}: {
  intent: PlaybackPreparationIntent;
  returning: boolean;
  ready: boolean;
  onCancel: () => void;
}) {
  const reducedMotion = readReducedMotion();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(returning);
  const [target, setTarget] = useState<PlaybackPreparationRect>(() =>
    getPlayerRect()
  );

  useEffect(() => {
    const update = () => setTarget(getPlayerRect());
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-playback-preparation-target]')) {
        update();
      }
    });
    update();
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setExpanded(!returning));
    return () => window.cancelAnimationFrame(frame);
  }, [returning]);

  useEffect(() => {
    if (!ready && !returning) {
      cancelButtonRef.current?.focus({ preventScroll: true });
    }
  }, [ready, returning]);

  const rect = reducedMotion ? target : expanded ? target : intent.rect;
  const duration = reducedMotion ? 120 : ENTER_DURATION_MS;
  const statusTop = Math.min(
    target.top + target.height + 18,
    Math.max(24, window.innerHeight - 120)
  );

  return (
    <div
      aria-label={`正在准备播放 ${intent.title}`}
      aria-modal='true'
      className={`fixed inset-0 z-[10040] transition-opacity ${
        ready ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      onKeyDown={(event) => {
        if (!ready && event.key === 'Tab') {
          event.preventDefault();
          cancelButtonRef.current?.focus({ preventScroll: true });
        }
      }}
      role='dialog'
      style={{ transitionDuration: `${reducedMotion ? 80 : READY_FADE_MS}ms` }}
    >
      <div
        aria-hidden
        className='absolute inset-0 bg-black/80 backdrop-blur-md'
        style={{
          opacity: expanded && !returning ? 1 : 0,
          transition: `opacity ${duration}ms ease`,
        }}
      />

      <div
        className='absolute overflow-hidden bg-black shadow-[0_24px_80px_rgba(0,0,0,0.55)]'
        data-testid='playback-preparation-visual'
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          borderRadius: expanded ? 18 : 14,
          opacity: reducedMotion ? (expanded ? 1 : 0) : 1,
          transition: reducedMotion
            ? `opacity ${duration}ms linear`
            : `top ${duration}ms cubic-bezier(0.22,1,0.36,1), left ${duration}ms cubic-bezier(0.22,1,0.36,1), width ${duration}ms cubic-bezier(0.22,1,0.36,1), height ${duration}ms cubic-bezier(0.22,1,0.36,1), border-radius ${duration}ms ease`,
        }}
      >
        <Image
          alt=''
          aria-hidden
          className='object-cover'
          fill
          priority
          referrerPolicy='no-referrer'
          sizes='(max-width: 768px) 94vw, 1120px'
          src={processImageUrl(intent.poster, {
            width: 1280,
            height: 720,
            quality: 82,
          })}
        />
        <div className='absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/10' />
      </div>

      <div
        className='absolute inset-x-0 flex flex-col items-center gap-3 px-4 text-center text-white transition-opacity'
        style={{
          top: statusTop,
          opacity: expanded && !returning ? 1 : 0,
          transitionDuration: `${duration}ms`,
        }}
      >
        <div aria-live='polite' className='contents' role='status'>
          <p className='text-base font-semibold tracking-tight sm:text-lg'>
            {intent.title}
          </p>
          <div className='flex items-center gap-2 text-sm text-white/70'>
            {!reducedMotion ? (
              <span
                aria-hidden
                className='h-1.5 w-1.5 animate-pulse rounded-full bg-white/80'
              />
            ) : null}
            <span>正在准备播放</span>
          </div>
        </div>
        <button
          className='rounded-full border border-white/25 bg-black/45 px-4 py-2 text-sm text-white backdrop-blur-md transition hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white'
          onClick={onCancel}
          ref={cancelButtonRef}
          type='button'
        >
          返回
        </button>
      </div>
    </div>
  );
}

export function usePlaybackPreparation(): PlaybackPreparationApi {
  return useContext(PlaybackPreparationContext);
}

export default function PlaybackPreparationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    reducePlaybackPreparationTransition,
    undefined,
    createPlaybackPreparationState
  );
  const [overlayDismissed, setOverlayDismissed] = useState(true);
  const generationRef = useRef(0);
  const stateRef = useRef(state);
  const visitedTargetRef = useRef(false);
  const cancelledNavigationRef = useRef<{
    generation: number;
    href: string;
    expiresAt: number;
  } | null>(null);
  const finishTimerRef = useRef<number | null>(null);
  stateRef.current = state;

  const clearFinishTimer = useCallback(() => {
    if (finishTimerRef.current != null) {
      window.clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
  }, []);

  const finishReturn = useCallback(
    (intent: PlaybackPreparationIntent, generation: number) => {
      clearFinishTimer();
      finishTimerRef.current = window.setTimeout(
        () => {
          restoreOrigin(intent);
          dispatch({ type: 'returnComplete', generation });
          setOverlayDismissed(true);
          visitedTargetRef.current = false;
        },
        readReducedMotion() ? 100 : ENTER_DURATION_MS
      );
    },
    [clearFinishTimer]
  );

  const start = useCallback(
    (input: StartPlaybackPreparationInput) => {
      clearFinishTimer();
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      visitedTargetRef.current = false;
      cancelledNavigationRef.current = null;
      const intent: PlaybackPreparationIntent = {
        ...input,
        origin: {
          href: currentHref(),
          scrollY: window.scrollY,
        },
      };
      setOverlayDismissed(false);
      dispatch({ type: 'start', generation, intent });
      router.push(input.href);
    },
    [clearFinishTimer, router]
  );

  const markFrameReady = useCallback(() => {
    const current = stateRef.current;
    if (
      !current.intent ||
      (current.phase !== 'entering' && current.phase !== 'preparing')
    ) {
      return;
    }
    if (
      pathnameOf(current.intent.origin.href) === pathnameOf(current.intent.href) &&
      !hrefMatchesTarget(currentHref(), current.intent.href)
    ) {
      return;
    }
    dispatch({ type: 'frameReady', generation: current.generation });
    clearFinishTimer();
    finishTimerRef.current = window.setTimeout(() => {
      setOverlayDismissed(true);
      finishTimerRef.current = null;
    }, READY_FADE_MS);
  }, [clearFinishTimer]);

  const markTerminalFailure = useCallback(() => {
    const current = stateRef.current;
    if (
      !current.intent ||
      (current.phase !== 'entering' && current.phase !== 'preparing')
    ) {
      return;
    }
    if (
      pathnameOf(current.intent.origin.href) === pathnameOf(current.intent.href) &&
      !hrefMatchesTarget(currentHref(), current.intent.href)
    ) {
      return;
    }
    dispatch({ type: 'terminalFailure', generation: current.generation });
    clearFinishTimer();
    finishTimerRef.current = window.setTimeout(() => {
      setOverlayDismissed(true);
      finishTimerRef.current = null;
    }, READY_FADE_MS);
  }, [clearFinishTimer]);

  const cancel = useCallback(() => {
    const current = stateRef.current;
    if (!current.intent || current.phase === 'idle') return;
    clearFinishTimer();
    setOverlayDismissed(false);
    dispatch({ type: 'cancel', generation: current.generation });

    if (currentHref() === current.intent.origin.href) {
      if (!visitedTargetRef.current) {
        cancelledNavigationRef.current = {
          generation: current.generation,
          href: current.intent.href,
          expiresAt: Date.now() + LATE_NAVIGATION_TTL_MS,
        };
      }
      finishReturn(current.intent, current.generation);
      return;
    }
    router.back();
  }, [clearFinishTimer, finishReturn, router]);

  useEffect(() => {
    const watchesTargetEntry =
      state.phase === 'entering' || state.phase === 'preparing';
    if (!watchesTargetEntry && !cancelledNavigationRef.current) return;

    let timer: number | null = null;
    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const inspectRoute = () => {
      const href = currentHref();
      const cancelledNavigation = cancelledNavigationRef.current;
      if (cancelledNavigation) {
        if (Date.now() >= cancelledNavigation.expiresAt) {
          cancelledNavigationRef.current = null;
        } else if (hrefMatchesTarget(href, cancelledNavigation.href)) {
          cancelledNavigationRef.current = null;
          stop();
          router.back();
          return;
        }
      }

      const current = stateRef.current;
      if (!current.intent || current.phase === 'idle') {
        if (!cancelledNavigationRef.current) stop();
        return;
      }
      if (hrefMatchesTarget(href, current.intent.href)) {
        visitedTargetRef.current = true;
        if (!cancelledNavigationRef.current) stop();
        return;
      }
      if (
        visitedTargetRef.current &&
        href === current.intent.origin.href
      ) {
        visitedTargetRef.current = false;
        stop();
        restoreOrigin(current.intent);
        setOverlayDismissed(false);
        dispatch({ type: 'return', generation: current.generation });
        finishReturn(current.intent, current.generation);
      }
    };

    timer = window.setInterval(inspectRoute, 50);
    inspectRoute();
    return stop;
  }, [finishReturn, router, state.generation, state.phase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const current = stateRef.current;
      if (!current.intent || current.phase === 'idle') return;
      event.preventDefault();
      cancel();
    };
    const onPopState = () => {
      const current = stateRef.current;
      if (
        !current.intent ||
        current.phase === 'idle' ||
        currentHref() !== current.intent.origin.href
      ) {
        return;
      }
      restoreOrigin(current.intent);
      setOverlayDismissed(false);
      dispatch({ type: 'return', generation: current.generation });
      finishReturn(current.intent, current.generation);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
    };
  }, [cancel, finishReturn]);

  useEffect(
    () => () => {
      clearFinishTimer();
    },
    [clearFinishTimer]
  );

  const api = useMemo<PlaybackPreparationApi>(
    () => ({
      active: true,
      start,
      markFrameReady,
      markTerminalFailure,
      cancel,
    }),
    [cancel, markFrameReady, markTerminalFailure, start]
  );
  const showOverlay = Boolean(state.intent) && !overlayDismissed;

  return (
    <PlaybackPreparationContext.Provider value={api}>
      {children}
      {showOverlay && state.intent ? (
        <PlaybackPreparationOverlay
          intent={state.intent}
          onCancel={cancel}
          ready={state.phase === 'ready' || state.phase === 'failed'}
          returning={state.phase === 'returning'}
        />
      ) : null}
    </PlaybackPreparationContext.Provider>
  );
}
