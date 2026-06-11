import type { SourcePlaybackMode } from './types';

export type HlsPlaybackRuntime = 'hlsjs' | 'native-hls';
export type HlsPlaylistFilterMode =
  | 'client-filter'
  | 'proxy-filter'
  | 'ios-skip'
  | 'client-observe'
  | 'proxy-observe'
  | 'none';
export type HlsSegmentMode = 'direct' | 'proxy';
export type HlsRecoveryProfile = 'hlsjs' | 'native-video';

export type HlsPlaybackPolicyReason =
  | 'remembered-proxy'
  | 'apple-native-hls-ios-skip'
  | 'direct-preferred'
  | 'proxy-unavailable';

export interface AppleNativeHlsDetectionInput {
  userAgent?: string | null;
  platform?: string | null;
  userAgentDataPlatform?: string | null;
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
  userAgentDataPlatform,
  maxTouchPoints,
  hasWebKitPointConversion,
}: AppleNativeHlsDetectionInput): boolean {
  if (hasWebKitPointConversion) {
    return true;
  }

  const normalizedUserAgent = userAgent || '';
  const normalizedPlatform = userAgentDataPlatform || platform || '';

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
        playlistFilter: 'proxy-filter',
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
      playlistFilter: isAppleNativeHlsEnvironment ? 'ios-skip' : 'client-filter',
      segmentMode: 'direct',
      recoveryProfile,
      reason: 'proxy-unavailable',
      forcedProxyForAdFiltering: false,
    };
  }

  if (isAppleNativeHlsEnvironment) {
    return {
      mode: 'direct',
      url: directUrl,
      runtime,
      playlistFilter: 'ios-skip',
      segmentMode: 'direct',
      recoveryProfile,
      reason: 'apple-native-hls-ios-skip',
      forcedProxyForAdFiltering: false,
    };
  }

  return {
    mode: 'direct',
    url: directUrl,
    runtime,
    playlistFilter: 'client-filter',
    segmentMode: 'direct',
    recoveryProfile,
    reason: 'direct-preferred',
    forcedProxyForAdFiltering: false,
  };
}
