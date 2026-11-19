import {
  buildVideoInfoFromPreferenceResult,
  formatSourceSpeedKbps,
  isBrowserSourceMeasurement,
} from './source-preference-video-info';

describe('source preference video info mapping', () => {
  it('never treats browser history from the server as a local measurement', () => {
    expect(
      buildVideoInfoFromPreferenceResult({
        qualityLabel: '4K',
        speedLabel: '2.4 MB/s',
        speedSource: 'browser',
        updatedAt: 1710000000000,
        pingTimeMs: 88,
        speedKbps: 1200,
        latencyMs: 340,
      })
    ).toEqual({
      quality: '4K',
      loadSpeed: '2.4 MB/s',
      pingTime: 88,
      speedSource: 'feedback',
      speedUpdatedAt: 1710000000000,
      speedPending: false,
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
        updatedAt: 1710000001000,
      })
    ).toEqual({
      quality: '未知',
      loadSpeed: '299.1 KB/s',
      pingTime: 280,
      speedSource: 'backend',
      speedUpdatedAt: 1710000001000,
      speedPending: false,
    });
  });

  it('converts bits to byte units and keeps pending or historical speeds out of local feedback', () => {
    expect(formatSourceSpeedKbps(8192)).toBe('1000.0 KB/s');
    expect(formatSourceSpeedKbps(8388.608)).toBe('1.0 MB/s');
    expect(formatSourceSpeedKbps(0)).toBeNull();
    const local = {
      quality: '720p',
      loadSpeed: '1.0 MB/s',
      pingTime: 25,
      speedSource: 'browser' as const,
    };
    expect(isBrowserSourceMeasurement(local)).toBe(true);
    expect(isBrowserSourceMeasurement({ ...local, speedPending: true })).toBe(
      false
    );
    expect(
      isBrowserSourceMeasurement({ ...local, speedSource: 'backend' })
    ).toBe(false);
    expect(
      isBrowserSourceMeasurement({ ...local, speedSource: 'feedback' })
    ).toBe(false);
  });

  it('keeps missing speed as a tryable pending state when only probe time exists', () => {
    expect(
      buildVideoInfoFromPreferenceResult({
        probeTimeMs: 640,
      })
    ).toEqual({
      quality: '未知',
      loadSpeed: '待检测，可尝试',
      pingTime: 640,
      speedSource: 'none',
      speedPending: true,
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
