import { scoreSource } from '@/lib/source-ranking/scoring';

describe('source ranking scoring', () => {
  it('matches the planned scoring formula exactly', () => {
    expect(
      scoreSource({
        successRate: 40,
        directRate: 10,
        proxyRate: 5,
        unavailableRate: 90,
        avgSpeedKbps: 500,
        resolutionLabel: '480p',
      })
    ).toEqual({
      healthScore: -30,
      speedScore: 10,
      qualityScore: 40,
      finalScore: -0.5,
    });
  });

  it('prefers stable direct high-quality source', () => {
    const strong = scoreSource({
      successRate: 100,
      directRate: 100,
      proxyRate: 0,
      unavailableRate: 0,
      avgSpeedKbps: 5000,
      resolutionLabel: '1080p',
    });

    const weak = scoreSource({
      successRate: 70,
      directRate: 40,
      proxyRate: 20,
      unavailableRate: 30,
      avgSpeedKbps: 600,
      resolutionLabel: '720p',
    });

    expect(strong.finalScore).toBeGreaterThan(weak.finalScore);
    expect(strong.healthScore).toBeGreaterThan(weak.healthScore);
    expect(strong.qualityScore).toBeGreaterThan(weak.qualityScore);
  });

  it('falls back to baseline scores when speed or resolution is missing', () => {
    expect(
      scoreSource({
        successRate: 80,
        directRate: 50,
        proxyRate: 20,
        unavailableRate: 10,
        avgSpeedKbps: null,
        resolutionLabel: null,
      })
    ).toMatchObject({
      speedScore: 35,
      qualityScore: 35,
    });
  });
});
