import {
  getEffectiveAdWindowTrustTier,
  resolveAdWindowTrustTier,
  type HlsAdSkipWindow,
} from '@/lib/hls-ad-skip';

/** Persisted Ad Skip Window — shared within one deployment (ADR 0004). */
export interface PersistedAdSkipWindow {
  source: string;
  id: string;
  episodeIndex: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  /** Evidence score accumulated with confirm/undo (#39 Trust Tier). */
  trustScore: number;
  confirmCount: number;
  undoCount: number;
  updated_time: number;
  ruleId?: string;
  origin?: 'persisted';
}

/** Episode-scoped bag of persisted Ad Skip Windows. */
export interface EpisodeAdSkipConfig {
  source: string;
  id: string;
  episodeIndex: number;
  windows: PersistedAdSkipWindow[];
  updated_time: number;
}

export function generateAdSkipConfigKey(
  source: string,
  id: string,
  episodeIndex: number
): string {
  return `${source}+${id}+${episodeIndex}`;
}

/** Timeline-only identity — immune to ruleId / host / path rotation. */
export function getAdSkipWindowRangeKey(
  window: Pick<
    { startTimeSeconds: number; endTimeSeconds: number },
    'startTimeSeconds' | 'endTimeSeconds'
  >
): string {
  return `${window.startTimeSeconds.toFixed(3)}-${window.endTimeSeconds.toFixed(3)}`;
}

export function toPersistedAdSkipWindow(input: {
  source: string;
  id: string;
  episodeIndex: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  ruleId?: string;
  trustScore?: number;
  confirmCount?: number;
  undoCount?: number;
  updated_time: number;
}): PersistedAdSkipWindow {
  return {
    source: input.source,
    id: input.id,
    episodeIndex: input.episodeIndex,
    startTimeSeconds: input.startTimeSeconds,
    endTimeSeconds: input.endTimeSeconds,
    trustScore: input.trustScore ?? 1,
    confirmCount: input.confirmCount ?? 1,
    undoCount: input.undoCount ?? 0,
    updated_time: input.updated_time,
    ruleId: input.ruleId,
    origin: 'persisted',
  };
}

export function persistedToHlsAdSkipWindow(
  window: PersistedAdSkipWindow
): HlsAdSkipWindow {
  return {
    startTimeSeconds: window.startTimeSeconds,
    endTimeSeconds: window.endTimeSeconds,
    ruleId: window.ruleId,
    confidence: 'high',
    action: 'filter',
    origin: 'persisted',
    confirmCount: window.confirmCount,
    undoCount: window.undoCount,
    trustScore: window.trustScore,
    trustTier: resolveAdWindowTrustTier({
      confirmCount: window.confirmCount,
      undoCount: window.undoCount,
      trustScore: window.trustScore,
    }),
  };
}

/**
 * Merge persisted windows with analyzer cold-start seeds for
 * `adSkipWindows.loaded`. Identity is timeline-only — immune to host/path rotation.
 */
export function mergeAdSkipWindowsForLoad(input: {
  persisted: PersistedAdSkipWindow[];
  analyzer: HlsAdSkipWindow[];
}): HlsAdSkipWindow[] {
  const persistedMapped = input.persisted.map(persistedToHlsAdSkipWindow);
  const persistedRangeKeys = new Set(
    persistedMapped.map((window) => getAdSkipWindowRangeKey(window))
  );

  const analyzerUnique = input.analyzer
    .filter(
      (window) => !persistedRangeKeys.has(getAdSkipWindowRangeKey(window))
    )
    .map((window) => ({
      ...window,
      origin: window.origin ?? ('analyzer' as const),
      // Cold-start seed: recoverable regardless of analyzer confidence.
      trustTier: getEffectiveAdWindowTrustTier(window),
    }));

  return [...persistedMapped, ...analyzerUnique];
}

/**
 * Merge two episode configs by timeline range so a full-bag `set` from one
 * client cannot drop windows another client just wrote.
 */
export function mergeEpisodeAdSkipConfigs(
  existing: EpisodeAdSkipConfig | null,
  incoming: EpisodeAdSkipConfig
): EpisodeAdSkipConfig {
  const byRange = new Map<string, PersistedAdSkipWindow>();

  for (const window of existing?.windows ?? []) {
    byRange.set(getAdSkipWindowRangeKey(window), { ...window, origin: 'persisted' });
  }

  for (const window of incoming.windows) {
    const rangeKey = getAdSkipWindowRangeKey(window);
    const previous = byRange.get(rangeKey);
    if (!previous) {
      byRange.set(rangeKey, { ...window, origin: 'persisted' });
      continue;
    }
    byRange.set(rangeKey, {
      ...previous,
      ...window,
      confirmCount: Math.max(previous.confirmCount, window.confirmCount),
      undoCount: Math.max(previous.undoCount, window.undoCount),
      trustScore: Math.max(previous.trustScore, window.trustScore),
      updated_time: Math.max(previous.updated_time, window.updated_time),
      ruleId: window.ruleId ?? previous.ruleId,
      origin: 'persisted',
    });
  }

  return {
    source: incoming.source,
    id: incoming.id,
    episodeIndex: incoming.episodeIndex,
    windows: Array.from(byRange.values()),
    updated_time: Math.max(existing?.updated_time ?? 0, incoming.updated_time),
  };
}

export function applyAdSkipWindowConfirmation(input: {
  source: string;
  id: string;
  episodeIndex: number;
  existing: EpisodeAdSkipConfig | null;
  window: {
    startTimeSeconds: number;
    endTimeSeconds: number;
    ruleId?: string;
  };
  kind: 'confirm' | 'undo';
  nowMs: number;
}): EpisodeAdSkipConfig | null {
  const rangeKey = getAdSkipWindowRangeKey(input.window);
  const windows = input.existing?.windows ? [...input.existing.windows] : [];
  const existingIndex = windows.findIndex(
    (window) => getAdSkipWindowRangeKey(window) === rangeKey
  );

  if (input.kind === 'undo') {
    if (existingIndex < 0) {
      return null;
    }
    const current = windows[existingIndex];
    windows[existingIndex] = {
      ...current,
      undoCount: current.undoCount + 1,
      trustScore: Math.max(0, (current.trustScore || 1) - 1),
      updated_time: input.nowMs,
      origin: 'persisted',
    };
  } else if (existingIndex >= 0) {
    const current = windows[existingIndex];
    windows[existingIndex] = {
      ...current,
      confirmCount: current.confirmCount + 1,
      trustScore: (current.trustScore || 1) + 1,
      updated_time: input.nowMs,
      ruleId: input.window.ruleId ?? current.ruleId,
      origin: 'persisted',
    };
  } else {
    windows.push(
      toPersistedAdSkipWindow({
        source: input.source,
        id: input.id,
        episodeIndex: input.episodeIndex,
        startTimeSeconds: input.window.startTimeSeconds,
        endTimeSeconds: input.window.endTimeSeconds,
        ruleId: input.window.ruleId,
        trustScore: 1,
        confirmCount: 1,
        undoCount: 0,
        updated_time: input.nowMs,
      })
    );
  }

  return {
    source: input.source,
    id: input.id,
    episodeIndex: input.episodeIndex,
    windows,
    updated_time: input.nowMs,
  };
}
