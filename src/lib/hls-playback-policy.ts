import type { SourcePlaybackMode } from './types';

export type HlsPlaybackRuntime = 'hlsjs' | 'native-hls';
export type HlsPlaylistFilterMode = 'client-loader' | 'proxy-playlist';
export type HlsSegmentMode = 'direct' | 'proxy';
export type HlsRecoveryProfile = 'hlsjs' | 'native-video';

export type HlsPlaybackPolicyReason =
  | 'remembered-proxy'
  | 'apple-native-hls-ad-filter'
  | 'direct-preferred'
  | 'proxy-unavailable';

export interface AppleNativeHlsDetectionInput {
  userAgent?: string | null;
  platform?: string | null;
  maxTouchPoints?: number | null;
  hasWebKitPointConversion?: boolean;
}

export interface HlsPlaybackPolicyInput {
  directUrl: string;
  proxyUrl?: string | null;
  adFilteringProxyUrl?: string | null;
  rememberedPlaybackMode?: SourcePlaybackMode | null;
  isAppleNativeHlsEnvironment: boolean;
}

export interface HlsPlaybackPolicyResult {
  mode: SourcePlaybackMode;
  url: string;
  runtime: HlsPlaybackRuntime;
  playlistFilter: HlsPlaylistFilterMode;
  segmentMode: HlsSegmentMode;
  recoveryProfile: HlsRecoveryProfile;
  reason: HlsPlaybackPolicyReason;
  forcedProxyForAdFiltering: boolean;
}

export function detectAppleNativeHlsEnvironment({
  userAgent,
  platform,
  maxTouchPoints,
  hasWebKitPointConversion,
}: AppleNativeHlsDetectionInput): boolean {
  if (hasWebKitPointConversion) {
    return true;
  }

  const normalizedUserAgent = userAgent || '';
  const normalizedPlatform = platform || '';

  if (/\b(iPad|iPhone|iPod)\b/i.test(normalizedUserAgent)) {
    return true;
  }

  return (
    normalizedPlatform === 'MacIntel' &&
    typeof maxTouchPoints === 'number' &&
    maxTouchPoints > 1
  );
}

export function resolveHlsPlaybackPolicy({
  directUrl,
  proxyUrl,
  adFilteringProxyUrl,
  rememberedPlaybackMode,
  isAppleNativeHlsEnvironment,
}: HlsPlaybackPolicyInput): HlsPlaybackPolicyResult {
  const runtime: HlsPlaybackRuntime = isAppleNativeHlsEnvironment
    ? 'native-hls'
    : 'hlsjs';
  const recoveryProfile: HlsRecoveryProfile = isAppleNativeHlsEnvironment
    ? 'native-video'
    : 'hlsjs';

  if (rememberedPlaybackMode === 'proxy') {
    if (proxyUrl) {
      return {
        mode: 'proxy',
        url: proxyUrl,
        runtime,
        playlistFilter: 'proxy-playlist',
        segmentMode: 'proxy',
        recoveryProfile,
        reason: 'remembered-proxy',
        forcedProxyForAdFiltering: false,
      };
    }

    return {
      mode: 'direct',
      url: directUrl,
      runtime,
      playlistFilter: isAppleNativeHlsEnvironment
        ? 'proxy-playlist'
        : 'client-loader',
      segmentMode: 'direct',
      recoveryProfile,
      reason: 'proxy-unavailable',
      forcedProxyForAdFiltering: false,
    };
  }

  if (isAppleNativeHlsEnvironment) {
    const appleAdFilteringProxyUrl = adFilteringProxyUrl || proxyUrl;

    if (appleAdFilteringProxyUrl) {
      return {
        mode: 'proxy',
        url: appleAdFilteringProxyUrl,
        runtime,
        playlistFilter: 'proxy-playlist',
        segmentMode: adFilteringProxyUrl ? 'direct' : 'proxy',
        recoveryProfile,
        reason: 'apple-native-hls-ad-filter',
        forcedProxyForAdFiltering: true,
      };
    }

    return {
      mode: 'direct',
      url: directUrl,
      runtime,
      playlistFilter: 'proxy-playlist',
      segmentMode: 'direct',
      recoveryProfile,
      reason: 'proxy-unavailable',
      forcedProxyForAdFiltering: false,
    };
  }

  return {
    mode: 'direct',
    url: directUrl,
    runtime,
    playlistFilter: 'client-loader',
    segmentMode: 'direct',
    recoveryProfile,
    reason: 'direct-preferred',
    forcedProxyForAdFiltering: false,
  };
}
