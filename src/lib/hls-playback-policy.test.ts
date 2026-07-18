import {
  detectAppleNativeHlsEnvironment,
  detectPlaybackProbePlatform,
  resolveHlsPlaybackPolicy,
} from './hls-playback-policy';

describe('resolveHlsPlaybackPolicy', () => {
  const directUrl = 'https://media.example.com/show/index.m3u8';
  const proxyUrl =
    '/api/hls-proxy?url=https%3A%2F%2Fmedia.example.com%2Fshow%2Findex.m3u8';
  const adFilteringProxyUrl =
    '/api/hls-proxy?url=https%3A%2F%2Fmedia.example.com%2Fshow%2Findex.m3u8&segmentMode=direct';

  it('uses stable direct playback with native skip on iPad Chrome because proxy playlists can stall Apple HLS', () => {
    const result = resolveHlsPlaybackPolicy({
      directUrl,
      proxyUrl,
      adFilteringProxyUrl,
      rememberedPlaybackMode: 'direct',
      isAppleNativeHlsEnvironment: true,
    });

    expect(result.mode).toBe('direct');
    expect(result.url).toBe(directUrl);
    expect(result.runtime).toBe('native-hls');
    expect(result.playlistFilter).toBe('skip');
    expect(result.segmentMode).toBe('direct');
    expect(result.recoveryProfile).toBe('native-video');
    expect(result.forcedProxyForAdFiltering).toBe(false);
    expect(result.reason).toBe('apple-native-hls-ios-skip');
  });

  it('keeps direct-first playback and unifies Android/desktop hls.js on the seek-based ad skip path', () => {
    const result = resolveHlsPlaybackPolicy({
      directUrl,
      proxyUrl,
      adFilteringProxyUrl,
      rememberedPlaybackMode: 'direct',
      isAppleNativeHlsEnvironment: false,
    });

    expect(result.mode).toBe('direct');
    expect(result.url).toBe(directUrl);
    expect(result.runtime).toBe('hlsjs');
    expect(result.playlistFilter).toBe('skip');
    expect(result.segmentMode).toBe('direct');
    expect(result.recoveryProfile).toBe('hlsjs');
    expect(result.forcedProxyForAdFiltering).toBe(false);
    expect(result.reason).toBe('direct-preferred');
  });

  it('ignores remembered proxy playback on Android and desktop because proxy playback is not a default recovery path', () => {
    const result = resolveHlsPlaybackPolicy({
      directUrl,
      proxyUrl,
      adFilteringProxyUrl,
      rememberedPlaybackMode: 'proxy',
      isAppleNativeHlsEnvironment: false,
    });

    expect(result.mode).toBe('direct');
    expect(result.url).toBe(directUrl);
    expect(result.runtime).toBe('hlsjs');
    expect(result.playlistFilter).toBe('skip');
    expect(result.segmentMode).toBe('direct');
    expect(result.recoveryProfile).toBe('hlsjs');
    expect(result.forcedProxyForAdFiltering).toBe(false);
    expect(result.reason).toBe('direct-preferred');
  });

  it('ignores remembered proxy playback on iOS and keeps native direct playback', () => {
    const result = resolveHlsPlaybackPolicy({
      directUrl,
      proxyUrl,
      adFilteringProxyUrl,
      rememberedPlaybackMode: 'proxy',
      isAppleNativeHlsEnvironment: true,
    });

    expect(result.mode).toBe('direct');
    expect(result.url).toBe(directUrl);
    expect(result.runtime).toBe('native-hls');
    expect(result.playlistFilter).toBe('skip');
    expect(result.segmentMode).toBe('direct');
    expect(result.recoveryProfile).toBe('native-video');
    expect(result.forcedProxyForAdFiltering).toBe(false);
    expect(result.reason).toBe('apple-native-hls-ios-skip');
  });

  it('falls back to direct playback when proxy filtering is unavailable', () => {
    const result = resolveHlsPlaybackPolicy({
      directUrl,
      proxyUrl: null,
      rememberedPlaybackMode: 'direct',
      isAppleNativeHlsEnvironment: true,
    });

    expect(result.mode).toBe('direct');
    expect(result.url).toBe(directUrl);
    expect(result.playlistFilter).toBe('skip');
    expect(result.forcedProxyForAdFiltering).toBe(false);
    expect(result.reason).toBe('apple-native-hls-ios-skip');
  });
});

describe('detectAppleNativeHlsEnvironment', () => {
  it('treats iPad Chrome as an Apple native HLS environment', () => {
    expect(
      detectAppleNativeHlsEnvironment({
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.0.0 Mobile/15E148 Safari/604.1',
        platform: 'iPad',
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it('does not treat Android Chrome as an Apple native HLS environment', () => {
    expect(
      detectAppleNativeHlsEnvironment({
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      })
    ).toBe(false);
  });

  it('treats iPhone Safari as an Apple native HLS environment', () => {
    expect(
      detectAppleNativeHlsEnvironment({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it('treats iPod Touch as an Apple native HLS environment', () => {
    expect(
      detectAppleNativeHlsEnvironment({
        userAgent:
          'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it('treats MacIntel with multiple touch points as an Apple native HLS environment (M-series iPad via desktop UA)', () => {
    expect(
      detectAppleNativeHlsEnvironment({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it('prefers userAgentData platform for iPad desktop UA detection', () => {
    expect(
      detectAppleNativeHlsEnvironment({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: '',
        userAgentDataPlatform: 'MacIntel',
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it('does not treat a standard Mac desktop (no touch) as an Apple native HLS environment', () => {
    expect(
      detectAppleNativeHlsEnvironment({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      })
    ).toBe(false);
  });

  it('does not treat a Mac with exactly 1 touch point as an Apple native HLS environment', () => {
    expect(
      detectAppleNativeHlsEnvironment({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 1,
      })
    ).toBe(false);
  });

  it('returns true immediately when hasWebKitPointConversion is set (legacy detection path)', () => {
    expect(
      detectAppleNativeHlsEnvironment({
        hasWebKitPointConversion: true,
      })
    ).toBe(true);
  });

  it('does not crash and returns false when all inputs are null or undefined', () => {
    expect(
      detectAppleNativeHlsEnvironment({
        userAgent: null,
        platform: null,
        maxTouchPoints: null,
        hasWebKitPointConversion: false,
      })
    ).toBe(false);
  });
});

describe('detectPlaybackProbePlatform', () => {
  it('classifies iPad Chrome as apple native probing', () => {
    expect(
      detectPlaybackProbePlatform({
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 26_5_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/149.0.7827.137 Mobile/15E148 Safari/604.1',
        platform: 'iPad',
        maxTouchPoints: 5,
      })
    ).toBe('apple-native');
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

describe('resolveHlsPlaybackPolicy — legacy proxy preference', () => {
  const directUrl = 'https://media.example.com/show/index.m3u8';

  it('keeps direct when remembered mode is proxy and proxyUrl is null', () => {
    const result = resolveHlsPlaybackPolicy({
      directUrl,
      proxyUrl: null,
      rememberedPlaybackMode: 'proxy',
      isAppleNativeHlsEnvironment: false,
    });

    expect(result.mode).toBe('direct');
    expect(result.url).toBe(directUrl);
    expect(result.forcedProxyForAdFiltering).toBe(false);
    expect(result.reason).toBe('direct-preferred');
  });
});
