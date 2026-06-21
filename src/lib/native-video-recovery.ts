export const NATIVE_FALSE_PLAYING_CHECK_DELAY_MS = 9000;
export const NATIVE_PLAY_RESUME_GRACE_MS = 10000;
export const NATIVE_HARD_STALL_THRESHOLD_MS = 30000;
export const NATIVE_WATCHDOG_INTERVAL_MS = 3000;
export const NATIVE_JITTER_WINDOW_MS = 30000;
export const NATIVE_CRITICAL_JITTER_WINDOW_COUNT = 2;

export type NativePlaybackIntent = 'playing' | 'paused';
export type NativeJitterEventType = 'waiting' | 'stalled' | 'suspend';
export type NativeStallSeverity =
  | 'observe'
  | 'soft-stall'
  | 'hard-stall'
  | 'source-failed';
export type NativeLowFrequencyRecoveryAction =
  | 'observe'
  | 'resume-playback'
  | 'switch-source';

export interface NativeJitterEvent {
  type: NativeJitterEventType;
  atMs: number;
  currentTime: number;
  readyState: number;
}

export interface NativeJitterDecision {
  isJitter: boolean;
  eventCount: number;
  rollbackCount: number;
  maxRollbackSeconds: number;
  jitterWindowCount: number;
  events: NativeJitterEvent[];
  reasons: string[];
}

export interface NativeRecoveryActionDecision {
  action: NativeLowFrequencyRecoveryAction;
  reason: string;
}

interface NativePlaybackNudgeRange {
  start: number;
  end: number;
}

interface NativePlaybackNudgeInput {
  currentTime: number;
  bufferedRanges: NativePlaybackNudgeRange[];
}

interface NativePauseResetInput {
  isVideoLoading: boolean;
  mediaSourceUnavailable: boolean;
  recentlyHadBufferIssue: boolean;
}

interface NativeStallIgnoreInput {
  playIntent: NativePlaybackIntent;
  mediaSourceUnavailable: boolean;
  nowMs: number;
  ignoreStallUntilMs: number;
}

interface NativeJitterDecisionInput {
  events: NativeJitterEvent[];
  nowMs: number;
  previousJitterWindows: number;
  windowMs?: number;
}

interface NativeStallSeverityInput {
  ended: boolean;
  paused: boolean;
  mediaSourceUnavailable: boolean;
  readyState: number;
  networkState: number;
  stalledForMs: number;
  hasRecentProgress: boolean;
}

interface NativeRecoveryActionInput {
  severity: NativeStallSeverity;
  playIntent: NativePlaybackIntent;
  browserAutoplayLocked: boolean;
  hasAlternativeSource: boolean;
  sourceRecoveryAttempts: number;
  jitterWindowCount?: number;
}

interface NativePlaybackFailureFeedbackInput {
  severity: NativeStallSeverity;
  action: NativeLowFrequencyRecoveryAction;
  sourceRecoveryAttempts: number;
}

const NATIVE_JITTER_EVENT_THRESHOLD = 4;
const NATIVE_JITTER_ROLLBACK_THRESHOLD_SECONDS = 2;
const NATIVE_JITTER_ROLLBACK_THRESHOLD_COUNT = 2;

export function shouldResetNativeRecoveryOnPause({
  isVideoLoading,
  mediaSourceUnavailable,
  recentlyHadBufferIssue,
}: NativePauseResetInput): boolean {
  return !isVideoLoading && !mediaSourceUnavailable && !recentlyHadBufferIssue;
}

export function shouldIgnoreNativeStall({
  playIntent,
  mediaSourceUnavailable,
  nowMs,
  ignoreStallUntilMs,
}: NativeStallIgnoreInput): boolean {
  if (mediaSourceUnavailable) {
    return false;
  }

  if (playIntent === 'paused') {
    return true;
  }

  return ignoreStallUntilMs > 0 && nowMs < ignoreStallUntilMs;
}

export function getNativeJitterDecision({
  events,
  nowMs,
  previousJitterWindows,
  windowMs = NATIVE_JITTER_WINDOW_MS,
}: NativeJitterDecisionInput): NativeJitterDecision {
  const activeEvents = events
    .filter((event) => nowMs - event.atMs < windowMs)
    .sort((first, second) => first.atMs - second.atMs);
  let rollbackCount = 0;
  let maxRollbackSeconds = 0;

  for (let index = 1; index < activeEvents.length; index += 1) {
    const previous = activeEvents[index - 1];
    const current = activeEvents[index];
    const rollbackSeconds = previous.currentTime - current.currentTime;
    if (rollbackSeconds >= NATIVE_JITTER_ROLLBACK_THRESHOLD_SECONDS) {
      rollbackCount += 1;
      maxRollbackSeconds = Math.max(maxRollbackSeconds, rollbackSeconds);
    }
  }

  const reasons: string[] = [];
  if (activeEvents.length >= NATIVE_JITTER_EVENT_THRESHOLD) {
    reasons.push('frequent-buffer-events');
  }
  if (rollbackCount >= NATIVE_JITTER_ROLLBACK_THRESHOLD_COUNT) {
    reasons.push('repeated-current-time-rollback');
  }

  const isJitter = reasons.length > 0;
  const jitterWindowCount = isJitter ? previousJitterWindows + 1 : 0;

  return {
    isJitter,
    eventCount: activeEvents.length,
    rollbackCount,
    maxRollbackSeconds: Number(maxRollbackSeconds.toFixed(2)),
    jitterWindowCount,
    events: activeEvents,
    reasons,
  };
}

export function getNativeStallSeverity({
  ended,
  paused,
  mediaSourceUnavailable,
  readyState,
  networkState,
  stalledForMs,
  hasRecentProgress,
}: NativeStallSeverityInput): NativeStallSeverity {
  if (ended) {
    return 'observe';
  }

  if (mediaSourceUnavailable || (readyState === 0 && networkState === 3)) {
    return 'source-failed';
  }

  if (paused) {
    return 'observe';
  }

  if (hasRecentProgress) {
    return 'observe';
  }

  if (stalledForMs >= NATIVE_HARD_STALL_THRESHOLD_MS) {
    return 'hard-stall';
  }

  return 'soft-stall';
}

export function getNativeRecoveryAction({
  severity,
  playIntent,
  browserAutoplayLocked,
  hasAlternativeSource,
  sourceRecoveryAttempts,
  jitterWindowCount = 0,
}: NativeRecoveryActionInput): NativeRecoveryActionDecision {
  if (browserAutoplayLocked) {
    return {
      action: 'observe',
      reason: '浏览器阻止自动播放，等待用户手动继续',
    };
  }

  if (playIntent === 'paused') {
    return {
      action: 'observe',
      reason: '用户暂停播放，停止自动恢复',
    };
  }

  if (severity === 'source-failed') {
    return hasAlternativeSource
      ? {
          action: 'switch-source',
          reason: '原生播放器判定当前媒体源不可用，切换到其他播放源',
        }
      : {
          action: 'observe',
          reason: '原生播放器判定当前媒体源不可用，但没有其他播放源',
        };
  }

  if (
    (severity === 'soft-stall' || severity === 'hard-stall') &&
    hasAlternativeSource &&
    sourceRecoveryAttempts <= 0 &&
    jitterWindowCount >= NATIVE_CRITICAL_JITTER_WINDOW_COUNT
  ) {
    return {
      action: 'switch-source',
      reason: '原生播放器连续缓冲抖动且长时间未推进，切换到其他播放源',
    };
  }

  if (severity === 'hard-stall') {
    if (sourceRecoveryAttempts <= 0) {
      return {
        action: 'resume-playback',
        reason: '原生播放器长时间未推进，尝试恢复播放',
      };
    }

    return hasAlternativeSource
      ? {
          action: 'switch-source',
          reason: '原生播放器长时间未推进且恢复失败，切换到其他播放源',
        }
      : {
          action: 'observe',
          reason: '原生播放器长时间未推进，但没有其他播放源',
        };
  }

  if (severity === 'soft-stall') {
    return {
      action: 'observe',
      reason: '原生播放器短暂缓冲，继续观察',
    };
  }

  return {
    action: 'observe',
    reason: '原生播放器状态正常，继续观察',
  };
}

export function shouldReportNativePlaybackFailureFeedback({
  severity,
  action,
  sourceRecoveryAttempts,
}: NativePlaybackFailureFeedbackInput): boolean {
  if (severity === 'source-failed') {
    return true;
  }

  if (severity !== 'hard-stall') {
    return false;
  }

  return action === 'switch-source' || sourceRecoveryAttempts > 0;
}

export function getNativePlaybackNudgeTime({
  currentTime,
  bufferedRanges,
}: NativePlaybackNudgeInput): number | null {
  for (const { start, end } of bufferedRanges) {
    if (end <= start) {
      continue;
    }

    if (currentTime >= start - 0.5 && currentTime <= end + 0.5) {
      const nudgedTime = Math.min(end - 0.1, currentTime + 0.35);
      if (
        nudgedTime > currentTime + 0.01 &&
        nudgedTime >= start &&
        nudgedTime <= end
      ) {
        return Number(nudgedTime.toFixed(2));
      }
    }

    if (currentTime < start && start - currentTime < 1.5) {
      const nudgedTime = Math.min(start + 0.05, end - 0.05);
      if (nudgedTime >= start && nudgedTime <= end) {
        return Number(nudgedTime.toFixed(2));
      }
    }
  }

  return null;
}
