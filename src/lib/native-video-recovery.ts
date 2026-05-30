export type NativeVideoRecoveryAction =
  | 'ignore'
  | 'resume-playback'
  | 'nudge-playback'
  | 'reload-source'
  | 'switch-full-proxy'
  | 'switch-source'
  | 'destroy';

export interface NativeVideoRecoveryPlanInput {
  stallCount: number;
  sourceReloadAttempts: number;
  fullProxyAttempted: boolean;
  hasAlternativeSource: boolean;
}

export interface NativeVideoRecoveryPlan {
  action: NativeVideoRecoveryAction;
  reason: string;
}

export function getNativeVideoRecoveryPlan({
  stallCount,
  sourceReloadAttempts,
  fullProxyAttempted,
  hasAlternativeSource,
}: NativeVideoRecoveryPlanInput): NativeVideoRecoveryPlan {
  if (stallCount <= 0) {
    return {
      action: 'ignore',
      reason: '原生播放器暂无恢复动作',
    };
  }

  if (stallCount === 1) {
    return {
      action: 'resume-playback',
      reason: '原生播放器停滞，尝试继续播放',
    };
  }

  if (stallCount === 2) {
    return {
      action: 'nudge-playback',
      reason: '原生播放器持续停滞，尝试微调播放位置',
    };
  }

  if (sourceReloadAttempts < 1) {
    return {
      action: 'reload-source',
      reason: '原生播放器仍未恢复，重新设置当前播放地址',
    };
  }

  if (!fullProxyAttempted) {
    return {
      action: 'switch-full-proxy',
      reason: '原生播放器持续卡死，升级到完整代理线路',
    };
  }

  if (hasAlternativeSource) {
    return {
      action: 'switch-source',
      reason: '完整代理仍无法恢复，切换到其他播放源',
    };
  }

  return {
    action: 'destroy',
    reason: '原生播放器无法恢复，且没有其他播放源',
  };
}
