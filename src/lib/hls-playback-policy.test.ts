import {
  detectAppleNativeHlsEnvironment,
  resolveHlsPlaybackPolicy,
} from './hls-playback-policy';

describe('resolveHlsPlaybackPolicy', () => {
  const directUrl = 'https://media.example.com/show/index.m3u8';
  const proxyUrl = '/api/hls-proxy?url=https%3A%2F%2Fmedia.example.com%2Fshow%2Findex.m3u8';

  it('uses proxy filtering on iPad Chrome because it runs through the Apple HLS environment', () => {
    const result = resolveHlsPlaybackPolicy({
      directUrl,
      proxyUrl,
      rememberedPlaybackMode: 'direct',
      isAppleNativeHlsEnvironment: true,
    });

    expect(result.mode).toBe('proxy');
    expect(result.url).toBe(proxyUrl);
    expect(result.forcedProxyForAdFiltering).toBe(true);
    expect(result.reason).toBe('apple-native-hls-ad-filter');
  });

  it('keeps direct-first playback for Android and desktop browser environments', () => {
    const result = resolveHlsPlaybackPolicy({
      directUrl,
      proxyUrl,
      rememberedPlaybackMode: 'direct',
      isAppleNativeHlsEnvironment: false,
    });

    expect(result.mode).toBe('direct');
    expect(result.url).toBe(directUrl);
    expect(result.forcedProxyForAdFiltering).toBe(false);
    expect(result.reason).toBe('direct-preferred');
  });

  it('respects remembered proxy playback before terminal-specific filtering', () => {
    const result = resolveHlsPlaybackPolicy({
      directUrl,
      proxyUrl,
      rememberedPlaybackMode: 'proxy',
      isAppleNativeHlsEnvironment: false,
    });

    expect(result.mode).toBe('proxy');
    expect(result.url).toBe(proxyUrl);
    expect(result.forcedProxyForAdFiltering).toBe(false);
    expect(result.reason).toBe('remembered-proxy');
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
    expect(result.forcedProxyForAdFiltering).toBe(false);
    expect(result.reason).toBe('proxy-unavailable');
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
});
