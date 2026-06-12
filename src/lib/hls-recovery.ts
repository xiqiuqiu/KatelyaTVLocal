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
}

export interface HlsRecoveryPlan {
  action: HlsRecoveryAction;
  reason: string;
}

const STALL_DETAIL_SET = new Set([
  'bufferStalledError',
  'bufferNudgeOnStall',
  'waitingTimeout',
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
      healthyWindowStartedTime: healthyWindowStartedTime || previousProgressTime,
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
}: HlsRecoveryPlanInput): HlsRecoveryPlan {
  const normalizedType = errorType || '';
  const normalizedDetails = errorDetails || '';
  const isStall = STALL_DETAIL_SET.has(normalizedDetails);
  const effectiveStallCount = Math.max(stallCount, stallWindowCount || 0);

  if (fatal) {
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

    if (hasAlternativeSource) {
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
