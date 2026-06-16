import type { SourcePreferenceResult, SourceVideoInfo } from './types';

type SourcePreferenceVideoInfoInput = Pick<
  SourcePreferenceResult,
  | 'qualityLabel'
  | 'speedLabel'
  | 'speedSource'
  | 'speedUpdatedAt'
  | 'speedPending'
  | 'pingTimeMs'
  | 'latencyMs'
  | 'speedKbps'
  | 'probeTimeMs'
  | 'updatedAt'
>;

export function formatSourceSpeedKbps(speedKbps?: number | null): string | null {
  if (typeof speedKbps !== 'number' || !Number.isFinite(speedKbps)) {
    return null;
  }

  const normalizedSpeed = Math.max(1, speedKbps);
  if (normalizedSpeed >= 1024) {
    return `${(normalizedSpeed / 1024).toFixed(1)} MB/s`;
  }

  return `${normalizedSpeed.toFixed(0)} KB/s`;
}

export function buildVideoInfoFromPreferenceResult(
  result: SourcePreferenceVideoInfoInput
): SourceVideoInfo | null {
  const quality = result.qualityLabel || '未知';
  const formattedBackendSpeed = formatSourceSpeedKbps(result.speedKbps);
  const loadSpeed =
    result.speedLabel || formattedBackendSpeed || '待检测，可尝试';
  const pingTime = Math.round(
    result.pingTimeMs ?? result.latencyMs ?? result.probeTimeMs ?? 0
  );
  const speedSource =
    result.speedSource ||
    (result.speedLabel
      ? 'feedback'
      : formattedBackendSpeed
      ? 'backend'
      : 'none');
  const speedPending =
    result.speedPending ?? (speedSource === 'none' && !result.speedLabel);

  if (quality === '未知' && speedSource === 'none' && pingTime <= 0) {
    return null;
  }

  return {
    quality,
    loadSpeed,
    pingTime,
    speedSource,
    speedUpdatedAt: result.speedUpdatedAt ?? result.updatedAt,
    speedPending,
  };
}
