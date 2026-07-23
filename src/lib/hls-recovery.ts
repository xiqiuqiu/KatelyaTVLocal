import type { SourcePlaybackMode } from '@/lib/types';

export type HlsRecoveryAction =
  | 'ignore'
  | 'nudge-playback'
  | 'restart-load'
  | 'recover-media'
  | 'switch-source'
  | 'destroy';

export interface HlsRecoveryPlanInput {
  fatal: boolean;
  errorType?: string | null;
  errorDetails?: string | null;
  playbackMode: SourcePlaybackMode;
  stallCount: number;
  stallWindowCount?: number;
  networkRecoveryAttempts: number;
  mediaRecoveryAttempts: number;
  hasAlternativeSource: boolean;
  hasStartedPlayback?: boolean;
  currentTimeSeconds?: number;
  readyState?: number;
}

export interface HlsRecoveryPlan {
  action: HlsRecoveryAction;
  reason: string;
}

function toFinitePlayhead(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * True when the media element has lost a usable timeline (common on Apple MMS
 * after detach / failed recover): readyState below HAVE_CURRENT_DATA, or an
 * explicit non-positive/null duration.
 */
export function isCollapsedMediaTimeline(input: {
  readyState?: number | null;
  duration?: number | null;
}): boolean {
  const noReadyData = input.readyState != null && input.readyState < 2;
  if (noReadyData) {
    return true;
  }
  if (input.duration === null) {
    return true;
  }
  if (typeof input.duration === 'number') {
    return !Number.isFinite(input.duration) || input.duration <= 0;
  }
  return false;
}

/**
 * Prefer a remembered mid-episode playhead when live media has collapsed to
 * currentTime≈0. Used by restart-load, stall-window resets, and playhead refs
 * so a scrub on a dead element cannot wipe Continuous Viewing state.
 *
 * Prod signal (鬼谜东宫 / iPad apple-hlsjs, export 2026-07-23):
 * progressSave at 2315.04 → recovery.stage.entered with currentTime 0,
 * duration null, readyState 0; scrubbing then showed 0:00 with no effect.
 */
export function resolveRememberedPlayhead(input: {
  liveCurrentTime: number | null | undefined;
  rememberedPlayhead?: number | null | undefined;
}): number {
  const live = toFinitePlayhead(input.liveCurrentTime);
  const remembered = toFinitePlayhead(input.rememberedPlayhead);
  if (live > 1) {
    return live;
  }
  if (remembered > 1) {
    return remembered;
  }
  return live;
}

/**
 * Position passed to `hls.startLoad` during same-source restart-load.
 */
export function resolveHlsRestartLoadPosition(input: {
  liveCurrentTime: number | null | undefined;
  rememberedPlayhead?: number | null | undefined;
}): number {
  return Math.max(0, resolveRememberedPlayhead(input) - 1);
}

export function getHlsPlaybackNudgeTime(input: {
  currentTime: number;
  bufferedRanges: Array<{ start: number; end: number }>;
}): number | null {
  for (const { start, end } of input.bufferedRanges) {
    if (end <= start) {
      continue;
    }
    if (input.currentTime >= start - 0.5 && input.currentTime <= end + 0.5) {
      const nudgedTime = Math.min(end - 0.1, input.currentTime + 0.35);
      if (
        nudgedTime > input.currentTime + 0.01 &&
        nudgedTime >= start &&
        nudgedTime <= end
      ) {
        return Number(nudgedTime.toFixed(2));
      }
    }
    if (input.currentTime < start && start - input.currentTime < 1.5) {
      const nudgedTime = Math.min(start + 0.05, end - 0.05);
      if (nudgedTime >= start && nudgedTime <= end) {
        return Number(nudgedTime.toFixed(2));
      }
    }
  }
  return null;
}

/** Soft-stall count at which recovery should switch source (legacy + Session). */
export const HLS_SUSTAINED_STALL_SWITCH_THRESHOLD = 5;

const STALL_DETAIL_SET = new Set([
  'bufferStalledError',
  'bufferNudgeOnStall',
  'waitingTimeout',
]);

const STARTUP_PLAYLIST_ERROR_SET = new Set([
  'manifestLoadError',
  'manifestLoadTimeOut',
  'levelLoadError',
  'levelLoadTimeOut',
]);

const HEALTHY_PROGRESS_WINDOW_MS = 8000;
const HEALTHY_PROGRESS_SECONDS = 1.5;
const SINGLE_HEALTHY_PROGRESS_SECONDS = 0.5;

export interface HlsRecoveryProgressInput {
  currentTime: number;
  now: number;
  lastProgressTime: number;
  lastProgressAt: number;
  healthyWindowStartedAt: number;
  healthyWindowStartedTime: number;
  hasActiveStallWindow: boolean;
}

export interface HlsRecoveryProgressUpdate {
  healthy: boolean;
  lastProgressTime: number;
  lastProgressAt: number;
  healthyWindowStartedAt: number;
  healthyWindowStartedTime: number;
}

export type HlsWaitingRecoveryIgnoreReason =
  | 'stale-session'
  | 'stale-url'
  | 'stale-video'
  | 'ended'
  | 'user-paused'
  | 'user-seeking'
  | 'manual-interaction-grace'
  | 'seek-buffer-grace';

export interface HlsWaitingRecoveryGuardInput {
  timerSessionId: number;
  currentSessionId: number;
  timerPlaybackUrl: string | null;
  currentPlaybackUrl: string | null;
  isSameVideoElement: boolean;
  isEnded: boolean;
  isUserPaused: boolean;
  isSeeking: boolean;
  nowMs: number;
  manualInteractionUntilMs: number;
  seekBufferGraceUntilMs: number;
}

export interface HlsWaitingRecoveryGuardResult {
  shouldTrigger: boolean;
  reason?: HlsWaitingRecoveryIgnoreReason;
}

export interface HlsRecoveryGuardPlaybackUrlInput {
  videoCurrentSrc?: string | null;
  playbackUrl?: string | null;
  fallbackUrl?: string | null;
}

export function getHlsRecoveryProgressUpdate({
  currentTime,
  now,
  lastProgressTime,
  lastProgressAt,
  healthyWindowStartedAt,
  healthyWindowStartedTime,
  hasActiveStallWindow,
}: HlsRecoveryProgressInput): HlsRecoveryProgressUpdate {
  const safeCurrentTime = Number.isFinite(currentTime) ? currentTime : 0;
  const previousProgressTime = Number.isFinite(lastProgressTime)
    ? lastProgressTime
    : 0;
  const timeMovedForward = safeCurrentTime > previousProgressTime;

  if (!timeMovedForward) {
    return {
      healthy: false,
      lastProgressTime: previousProgressTime,
      lastProgressAt,
      healthyWindowStartedAt: healthyWindowStartedAt || now,
      healthyWindowStartedTime:
        healthyWindowStartedTime || previousProgressTime,
    };
  }

  const windowStartedAt = healthyWindowStartedAt || now;
  const windowStartedTime = healthyWindowStartedTime || previousProgressTime;
  const progressedInWindow = safeCurrentTime - windowStartedTime;
  const progressedSinceLastUpdate = safeCurrentTime - previousProgressTime;
  const windowElapsed = now - windowStartedAt;
  const healthy =
    hasActiveStallWindow &&
    ((windowElapsed <= HEALTHY_PROGRESS_WINDOW_MS &&
      progressedInWindow >= HEALTHY_PROGRESS_SECONDS) ||
      progressedSinceLastUpdate >= SINGLE_HEALTHY_PROGRESS_SECONDS);

  return {
    healthy,
    lastProgressTime: safeCurrentTime,
    lastProgressAt: now,
    healthyWindowStartedAt: healthy ? now : windowStartedAt,
    healthyWindowStartedTime: healthy ? safeCurrentTime : windowStartedTime,
  };
}

export function shouldTriggerHlsWaitingRecovery({
  timerSessionId,
  currentSessionId,
  timerPlaybackUrl,
  currentPlaybackUrl,
  isSameVideoElement,
  isEnded,
  isUserPaused,
  isSeeking,
  nowMs,
  manualInteractionUntilMs,
  seekBufferGraceUntilMs,
}: HlsWaitingRecoveryGuardInput): HlsWaitingRecoveryGuardResult {
  if (timerSessionId !== currentSessionId) {
    return { shouldTrigger: false, reason: 'stale-session' };
  }

  if (timerPlaybackUrl !== currentPlaybackUrl) {
    return { shouldTrigger: false, reason: 'stale-url' };
  }

  if (!isSameVideoElement) {
    return { shouldTrigger: false, reason: 'stale-video' };
  }

  if (isEnded) {
    return { shouldTrigger: false, reason: 'ended' };
  }

  if (isUserPaused) {
    return { shouldTrigger: false, reason: 'user-paused' };
  }

  if (isSeeking) {
    return { shouldTrigger: false, reason: 'user-seeking' };
  }

  if (seekBufferGraceUntilMs > nowMs) {
    return { shouldTrigger: false, reason: 'seek-buffer-grace' };
  }

  if (manualInteractionUntilMs > nowMs) {
    return { shouldTrigger: false, reason: 'manual-interaction-grace' };
  }

  return { shouldTrigger: true };
}

export function getHlsRecoveryGuardPlaybackUrl({
  videoCurrentSrc,
  playbackUrl,
  fallbackUrl,
}: HlsRecoveryGuardPlaybackUrlInput): string | null {
  return playbackUrl || fallbackUrl || videoCurrentSrc || null;
}

export function getHlsRecoveryPlan({
  fatal,
  errorType,
  errorDetails,
  playbackMode: _playbackMode,
  stallCount,
  stallWindowCount,
  networkRecoveryAttempts,
  mediaRecoveryAttempts,
  hasAlternativeSource,
  hasStartedPlayback,
  currentTimeSeconds,
  readyState,
}: HlsRecoveryPlanInput): HlsRecoveryPlan {
  const normalizedType = errorType || '';
  const normalizedDetails = errorDetails || '';
  const isStall = STALL_DETAIL_SET.has(normalizedDetails);
  const isStartupPlaylistFailure =
    STARTUP_PLAYLIST_ERROR_SET.has(normalizedDetails) &&
    hasStartedPlayback === false &&
    (currentTimeSeconds ?? 0) <= 1 &&
    (readyState ?? 0) < 2;
  const effectiveStallCount = Math.max(stallCount, stallWindowCount || 0);

  if (fatal) {
    if (
      normalizedType === 'networkError' &&
      isStartupPlaylistFailure &&
      hasAlternativeSource
    ) {
      return {
        action: 'switch-source',
        reason: '当前线路起播失败，切换到其他播放源',
      };
    }

    if (normalizedType === 'networkError' && networkRecoveryAttempts < 2) {
      return {
        action: 'restart-load',
        reason: '致命网络错误，重新拉取分片',
      };
    }

    if (normalizedType === 'mediaError' && mediaRecoveryAttempts < 2) {
      return {
        action: 'recover-media',
        reason: '致命媒体错误，尝试恢复解码器',
      };
    }

    if (hasAlternativeSource) {
      return {
        action: 'switch-source',
        reason: '当前线路不可恢复，切换到其他播放源',
      };
    }

    return {
      action: 'destroy',
      reason: '当前线路不可恢复，停止当前 HLS 实例',
    };
  }

  if (isStall) {
    if (effectiveStallCount <= 2) {
      return {
        action: 'nudge-playback',
        reason: '缓冲停滞，尝试微调播放位置恢复',
      };
    }

    if (effectiveStallCount === 3) {
      return {
        action: 'restart-load',
        reason: '连续缓冲停滞，重新拉取分片',
      };
    }

    if (effectiveStallCount === 4) {
      return {
        action: 'recover-media',
        reason: '连续缓冲停滞，尝试恢复媒体解码器',
      };
    }

    if (
      effectiveStallCount >= HLS_SUSTAINED_STALL_SWITCH_THRESHOLD &&
      hasAlternativeSource
    ) {
      return {
        action: 'switch-source',
        reason: '当前线路持续卡顿，切换到其他播放源',
      };
    }

    return {
      action: 'destroy',
      reason: '当前线路持续卡顿且无可用候选源，停止当前 HLS 实例',
    };
  }

  if (normalizedType === 'networkError') {
    if (networkRecoveryAttempts < 2) {
      return {
        action: 'restart-load',
        reason: '网络抖动，重新拉取分片',
      };
    }

    if (hasAlternativeSource) {
      return {
        action: 'switch-source',
        reason: '网络错误重复发生，切换到其他播放源',
      };
    }

    return {
      action: 'destroy',
      reason: '网络错误重复发生，停止当前 HLS 实例',
    };
  }

  if (normalizedType === 'mediaError') {
    if (mediaRecoveryAttempts < 2) {
      return {
        action: 'recover-media',
        reason: '媒体错误，尝试恢复解码器',
      };
    }

    if (hasAlternativeSource) {
      return {
        action: 'switch-source',
        reason: '媒体错误重复发生，切换到其他播放源',
      };
    }

    return {
      action: 'destroy',
      reason: '媒体错误重复发生，停止当前 HLS 实例',
    };
  }

  return {
    action: 'ignore',
    reason: '当前错误无需额外恢复动作',
  };
}
