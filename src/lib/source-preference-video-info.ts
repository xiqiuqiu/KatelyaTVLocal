import type { SourcePreferenceResult, SourceVideoInfo } from './types';

type SourcePreferenceVideoInfoInput = Pick<
  SourcePreferenceResult,
  | 'qualityLabel'
  | 'speedLabel'
  | 'pingTimeMs'
  | 'latencyMs'
  | 'speedKbps'
  | 'probeTimeMs'
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
  const loadSpeed =
    result.speedLabel || formatSourceSpeedKbps(result.speedKbps) || '未知';
  const pingTime = Math.round(
    result.pingTimeMs ?? result.latencyMs ?? result.probeTimeMs ?? 0
  );

  if (quality === '未知' && loadSpeed === '未知' && pingTime <= 0) {
    return null;
  }

  return {
    quality,
    loadSpeed,
    pingTime,
  };
}
