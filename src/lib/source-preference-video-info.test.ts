import { buildVideoInfoFromPreferenceResult } from './source-preference-video-info';

describe('source preference video info mapping', () => {
  it('uses browser metrics before backend probe metrics', () => {
    expect(
      buildVideoInfoFromPreferenceResult({
        qualityLabel: '4K',
        speedLabel: '2.4 MB/s',
        pingTimeMs: 88,
        speedKbps: 1200,
        latencyMs: 340,
      })
    ).toEqual({
      quality: '4K',
      loadSpeed: '2.4 MB/s',
      pingTime: 88,
    });
  });

  it('falls back to backend probe speed and latency when browser metrics are missing', () => {
    expect(
      buildVideoInfoFromPreferenceResult({
        qualityLabel: null,
        speedLabel: null,
        pingTimeMs: null,
        speedKbps: 2450,
        latencyMs: 280,
      })
    ).toEqual({
      quality: '未知',
      loadSpeed: '2.4 MB/s',
      pingTime: 280,
    });
  });

  it('uses probe time as the final latency fallback', () => {
    expect(
      buildVideoInfoFromPreferenceResult({
        speedKbps: 512,
        probeTimeMs: 640,
      })
    ).toEqual({
      quality: '未知',
      loadSpeed: '512 KB/s',
      pingTime: 640,
    });
  });

  it('returns null when no usable metric exists', () => {
    expect(
      buildVideoInfoFromPreferenceResult({
        qualityLabel: null,
        speedLabel: null,
        pingTimeMs: null,
        speedKbps: null,
        latencyMs: null,
        probeTimeMs: undefined,
      })
    ).toBeNull();
  });
});
