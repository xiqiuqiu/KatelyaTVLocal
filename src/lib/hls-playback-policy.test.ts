import {
  detectAppleDevice,
  detectPlaybackProbePlatform,
  resolveHlsPlaybackPolicy,
} from './hls-playback-policy';

describe('resolveHlsPlaybackPolicy', () => {
  const directUrl = 'https://media.example.com/show/index.m3u8';
  it('uses hls.js through MMS with remote playback disabled on capable Apple devices', () => {
    const result = resolveHlsPlaybackPolicy({
      directUrl,
      appleCapabilities: {
        isAppleDevice: true,
        hasManagedMediaSource: true,
        hlsJsSupported: true,
      },
    });

    expect(result.mode).toBe('direct');
    expect(result.url).toBe(directUrl);
    expect(result.runtime).toBe('hlsjs');
    expect(result.playlistFilter).toBe('skip');
    expect(result.segmentMode).toBe('direct');
    expect(result.recoveryProfile).toBe('hlsjs');
    expect(result.deviceUnsupported).toBe(false);
    expect(result.disableRemotePlayback).toBe(true);
    expect(result.reason).toBe('direct-preferred');
  });

  it('keeps direct-first playback and unifies Android/desktop hls.js on the seek-based ad skip path', () => {
    const result = resolveHlsPlaybackPolicy({
      directUrl,
      appleCapabilities: {
        isAppleDevice: false,
        hasManagedMediaSource: false,
        hlsJsSupported: true,
      },
    });

    expect(result.mode).toBe('direct');
    expect(result.url).toBe(directUrl);
    expect(result.runtime).toBe('hlsjs');
    expect(result.playlistFilter).toBe('skip');
    expect(result.segmentMode).toBe('direct');
    expect(result.recoveryProfile).toBe('hlsjs');
    expect(result.deviceUnsupported).toBe(false);
    expect(result.disableRemotePlayback).toBe(false);
    expect(result.reason).toBe('direct-preferred');
  });

  it.each([
    {
      name: 'ManagedMediaSource is unavailable',
      hasManagedMediaSource: false,
      hlsJsSupported: false,
    },
    {
      name: 'hls.js does not support the available media source',
      hasManagedMediaSource: true,
      hlsJsSupported: false,
    },
  ])('marks Apple device unsupported when $name', (capability) => {
    const result = resolveHlsPlaybackPolicy({
      directUrl,
      appleCapabilities: {
        isAppleDevice: true,
        ...capability,
      },
    });

    expect(result.runtime).toBe('hlsjs');
    expect(result.recoveryProfile).toBe('hlsjs');
    expect(result.deviceUnsupported).toBe(true);
    expect(result.disableRemotePlayback).toBe(true);
    expect(result.reason).toBe('device-unsupported');
  });
});

describe('detectAppleDevice', () => {
  it('treats iPad Chrome as an Apple device', () => {
    expect(
      detectAppleDevice({
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.0.0 Mobile/15E148 Safari/604.1',
        platform: 'iPad',
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it('does not treat Android Chrome as an Apple device', () => {
    expect(
      detectAppleDevice({
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      })
    ).toBe(false);
  });

  it('treats iPhone Safari as an Apple device', () => {
    expect(
      detectAppleDevice({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it('treats iPod Touch as an Apple device', () => {
    expect(
      detectAppleDevice({
        userAgent:
          'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it('treats MacIntel with multiple touch points as an Apple device (M-series iPad via desktop UA)', () => {
    expect(
      detectAppleDevice({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it('prefers userAgentData platform for iPad desktop UA detection', () => {
    expect(
      detectAppleDevice({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: '',
        userAgentDataPlatform: 'MacIntel',
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it('does not treat a standard Mac desktop (no touch) as an Apple device', () => {
    expect(
      detectAppleDevice({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      })
    ).toBe(false);
  });

  it('does not treat a Mac with exactly 1 touch point as an Apple device', () => {
    expect(
      detectAppleDevice({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 1,
      })
    ).toBe(false);
  });

  it('does not crash and returns false when all inputs are null or undefined', () => {
    expect(
      detectAppleDevice({
        userAgent: null,
        platform: null,
        maxTouchPoints: null,
      })
    ).toBe(false);
  });
});

describe('detectPlaybackProbePlatform', () => {
  it('classifies iPad Chrome as Apple hls.js probing', () => {
    expect(
      detectPlaybackProbePlatform({
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 26_5_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/149.0.7827.137 Mobile/15E148 Safari/604.1',
        platform: 'iPad',
        maxTouchPoints: 5,
      })
    ).toBe('apple-hlsjs');
  });

  it('classifies Android Chrome separately from desktop hls.js browsers', () => {
    expect(
      detectPlaybackProbePlatform({
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      })
    ).toBe('android-hlsjs');
  });

  it('classifies desktop browsers as desktop hls.js browsers', () => {
    expect(
      detectPlaybackProbePlatform({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        platform: 'Win32',
        maxTouchPoints: 0,
      })
    ).toBe('desktop-hlsjs');
  });
});
