import type { M3U8AdCandidate } from './hls-ad-filter';

/** How forcefully an Ad Skip Window is applied (CONTEXT: Ad Window Trust Tier). */
export type AdWindowTrustTier = 'observe' | 'recoverable' | 'silent';

/** Repeated undos demote the window to observe (stop auto-skip for everyone). */
export const AD_WINDOW_UNDO_DEMOTE_THRESHOLD = 2;
/** Repeated confirms (un-undone skips) promote to silent (no toast). */
export const AD_WINDOW_CONFIRM_SILENT_THRESHOLD = 3;

/**
 * Pure resolution of Ad Window Trust Tier from accumulated Ad Window
 * Confirmation evidence. Analyzer confidence alone never authorizes silent.
 */
export function resolveAdWindowTrustTier(evidence: {
  confirmCount?: number;
  undoCount?: number;
  /** Accumulated with confirms/undos; tier thresholds are count-driven. */
  trustScore?: number;
}): AdWindowTrustTier {
  const confirmCount = evidence.confirmCount ?? 0;
  const undoCount = evidence.undoCount ?? 0;

  if (undoCount >= AD_WINDOW_UNDO_DEMOTE_THRESHOLD) {
    return 'observe';
  }

  if (confirmCount >= AD_WINDOW_CONFIRM_SILENT_THRESHOLD) {
    return 'silent';
  }

  return 'recoverable';
}

/**
 * Prefer an explicit trustTier; otherwise resolve from confirmation counts
 * (load path). Missing both → cold-start recoverable.
 */
export function getEffectiveAdWindowTrustTier(window: {
  trustTier?: AdWindowTrustTier;
  confirmCount?: number;
  undoCount?: number;
  trustScore?: number;
}): AdWindowTrustTier {
  if (window.trustTier) {
    return window.trustTier;
  }
  if (
    window.confirmCount != null ||
    window.undoCount != null ||
    window.trustScore != null
  ) {
    return resolveAdWindowTrustTier({
      confirmCount: window.confirmCount,
      undoCount: window.undoCount,
      trustScore: window.trustScore,
    });
  }
  return 'recoverable';
}

export interface HlsAdSkipWindow {
  startTimeSeconds: number;
  endTimeSeconds: number;
  ruleId?: string;
  confidence: M3U8AdCandidate['confidence'];
  action: M3U8AdCandidate['action'];
  /**
   * Window provenance for session merge:
   * - analyzer: cold-start seed
   * - user-mark: session manual mark (#37)
   * - persisted: loaded from shared Ad Skip Window store (#38)
   */
  origin?: 'analyzer' | 'user-mark' | 'persisted';
  /** Resolved Ad Window Trust Tier; omit → treated as cold-start recoverable. */
  trustTier?: AdWindowTrustTier;
  confirmCount?: number;
  undoCount?: number;
  trustScore?: number;
}

export function toUserMarkAdSkipWindow(input: {
  startTimeSeconds: number;
  endTimeSeconds: number;
}): HlsAdSkipWindow {
  return {
    startTimeSeconds: input.startTimeSeconds,
    endTimeSeconds: input.endTimeSeconds,
    ruleId: 'user-mark',
    confidence: 'high',
    action: 'filter',
    origin: 'user-mark',
    // Fresh mark enters recoverable — never silent from a single report.
    trustTier: 'recoverable',
    confirmCount: 1,
    undoCount: 0,
    trustScore: 1,
  };
}

export interface HlsAdSkipDecisionInput {
  currentTimeSeconds: number;
  windows: HlsAdSkipWindow[];
  lastSkippedWindowKey?: string | null;
  lastUserSeekAtMs?: number | null;
  nowMs: number;
  paddingSeconds?: number;
  manualSeekGraceMs?: number;
}

export interface HlsAdSkipDecision {
  shouldSkip: boolean;
  targetTimeSeconds: number | null;
  windowKey: string | null;
  reason:
    | 'ad-window'
    | 'no-window'
    | 'already-skipped'
    | 'manual-seek-grace'
    | 'observe-tier';
  window?: HlsAdSkipWindow;
}

const DEFAULT_PADDING_SECONDS = 0.35;
const DEFAULT_MANUAL_SEEK_GRACE_MS = 2500;

export function toHlsAdSkipWindows(
  candidates: M3U8AdCandidate[]
): HlsAdSkipWindow[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.action === 'filter' &&
        candidate.confidence === 'high' &&
        candidate.endTimeSeconds > candidate.startTimeSeconds
    )
    .map((candidate) => ({
      startTimeSeconds: candidate.startTimeSeconds,
      endTimeSeconds: candidate.endTimeSeconds,
      ruleId: candidate.ruleId,
      confidence: candidate.confidence,
      action: candidate.action,
      // Cold-start seed: recoverable, never silent from analyzer confidence.
      trustTier: 'recoverable' as const,
      origin: 'analyzer' as const,
    }));
}

export function getHlsAdSkipWindowKey(window: HlsAdSkipWindow): string {
  return `${window.ruleId || 'auto'}:${window.startTimeSeconds.toFixed(
    3
  )}-${window.endTimeSeconds.toFixed(3)}`;
}

export function getHlsAdSkipDecision({
  currentTimeSeconds,
  windows,
  lastSkippedWindowKey,
  lastUserSeekAtMs,
  nowMs,
  paddingSeconds = DEFAULT_PADDING_SECONDS,
  manualSeekGraceMs = DEFAULT_MANUAL_SEEK_GRACE_MS,
}: HlsAdSkipDecisionInput): HlsAdSkipDecision {
  if (
    lastUserSeekAtMs &&
    nowMs - lastUserSeekAtMs >= 0 &&
    nowMs - lastUserSeekAtMs < manualSeekGraceMs
  ) {
    return {
      shouldSkip: false,
      targetTimeSeconds: null,
      windowKey: null,
      reason: 'manual-seek-grace',
    };
  }

  const matchedWindow = windows.find(
    (window) =>
      currentTimeSeconds >= window.startTimeSeconds &&
      currentTimeSeconds < window.endTimeSeconds
  );

  if (!matchedWindow) {
    return {
      shouldSkip: false,
      targetTimeSeconds: null,
      windowKey: null,
      reason: 'no-window',
    };
  }

  const windowKey = getHlsAdSkipWindowKey(matchedWindow);
  if (windowKey === lastSkippedWindowKey) {
    return {
      shouldSkip: false,
      targetTimeSeconds: null,
      windowKey,
      reason: 'already-skipped',
      window: matchedWindow,
    };
  }

  if (getEffectiveAdWindowTrustTier(matchedWindow) === 'observe') {
    return {
      shouldSkip: false,
      targetTimeSeconds: null,
      windowKey,
      reason: 'observe-tier',
      window: matchedWindow,
    };
  }

  return {
    shouldSkip: true,
    targetTimeSeconds: matchedWindow.endTimeSeconds + paddingSeconds,
    windowKey,
    reason: 'ad-window',
    window: matchedWindow,
  };
}
