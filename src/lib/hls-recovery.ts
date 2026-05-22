import type { SourcePlaybackMode } from '@/lib/types';

export type HlsRecoveryAction =
  | 'ignore'
  | 'nudge-playback'
  | 'restart-load'
  | 'recover-media'
  | 'switch-proxy'
  | 'switch-source'
  | 'destroy';

export interface HlsRecoveryPlanInput {
  fatal: boolean;
  errorType?: string | null;
  errorDetails?: string | null;
  playbackMode: SourcePlaybackMode;
  stallCount: number;
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

export function getHlsRecoveryPlan({
  fatal,
  errorType,
  errorDetails,
  playbackMode,
  stallCount,
  networkRecoveryAttempts,
  mediaRecoveryAttempts,
  hasAlternativeSource,
}: HlsRecoveryPlanInput): HlsRecoveryPlan {
  const normalizedType = errorType || '';
  const normalizedDetails = errorDetails || '';
  const isStall = STALL_DETAIL_SET.has(normalizedDetails);

  if (fatal) {
    if (playbackMode === 'direct') {
      return {
        action: 'switch-proxy',
        reason: '致命播放错误，优先切换到代理线路',
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
    if (stallCount <= 2) {
      return {
        action: 'nudge-playback',
        reason: '缓冲停滞，尝试微调播放位置恢复',
      };
    }

    if (stallCount === 3) {
      return {
        action: 'restart-load',
        reason: '连续缓冲停滞，重新拉取分片',
      };
    }

    if (stallCount === 4) {
      return {
        action: 'recover-media',
        reason: '连续缓冲停滞，尝试恢复媒体解码器',
      };
    }

    if (playbackMode === 'direct') {
      return {
        action: 'switch-proxy',
        reason: '直连线路持续卡顿，切换到代理线路',
      };
    }

    if (hasAlternativeSource) {
      return {
        action: 'switch-source',
        reason: '代理线路仍持续卡顿，切换到其他播放源',
      };
    }

    return {
      action: 'recover-media',
      reason: '当前线路持续卡顿，重复尝试恢复媒体解码器',
    };
  }

  if (normalizedType === 'networkError') {
    if (networkRecoveryAttempts < 2) {
      return {
        action: 'restart-load',
        reason: '网络抖动，重新拉取分片',
      };
    }

    if (playbackMode === 'direct') {
      return {
        action: 'switch-proxy',
        reason: '网络错误重复发生，切换到代理线路',
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

    if (playbackMode === 'direct') {
      return {
        action: 'switch-proxy',
        reason: '媒体错误重复发生，切换到代理线路',
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
