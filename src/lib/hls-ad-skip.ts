import type { M3U8AdCandidate } from './hls-ad-filter';

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
  reason: 'ad-window' | 'no-window' | 'already-skipped' | 'manual-seek-grace';
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

  return {
    shouldSkip: true,
    targetTimeSeconds: matchedWindow.endTimeSeconds + paddingSeconds,
    windowKey,
    reason: 'ad-window',
    window: matchedWindow,
  };
}
