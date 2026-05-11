export interface SourceScoreInput {
  successRate: number;
  directRate: number;
  proxyRate: number;
  unavailableRate: number;
  avgSpeedKbps: number | null;
  resolutionLabel: string | null;
}

export interface SourceScoreResult {
  healthScore: number;
  speedScore: number;
  qualityScore: number;
  finalScore: number;
}

const QUALITY_SCORE_MAP: Record<string, number> = {
  '4K': 100,
  '2K': 88,
  '1080p': 76,
  '720p': 60,
  '480p': 40,
  SD: 20,
};

export function scoreSource(input: SourceScoreInput): SourceScoreResult {
  const healthScore =
    input.successRate * 0.5 +
    input.directRate * 0.3 +
    input.proxyRate * 0.2 -
    input.unavailableRate * 0.6;

  const speedScore =
    input.avgSpeedKbps == null
      ? 35
      : Math.min(100, Math.max(0, input.avgSpeedKbps / 50));

  const qualityScore = input.resolutionLabel
    ? (QUALITY_SCORE_MAP[input.resolutionLabel] ?? 35)
    : 35;

  const finalScore =
    healthScore * 0.45 + speedScore * 0.3 + qualityScore * 0.25;

  return {
    healthScore,
    speedScore,
    qualityScore,
    finalScore,
  };
}
