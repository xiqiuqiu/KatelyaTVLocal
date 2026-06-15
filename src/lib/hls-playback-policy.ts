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
export type PlaybackProbePlatform =
  | 'apple-native'
  | 'android-hlsjs'
  | 'desktop-hlsjs';

export type HlsPlaybackPolicyReason =
  | 'apple-native-hls-ios-skip'
  | 'direct-preferred';

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

export function detectPlaybackProbePlatform(
  input: AppleNativeHlsDetectionInput
): PlaybackProbePlatform {
  if (detectAppleNativeHlsEnvironment(input)) {
    return 'apple-native';
  }

  if (/\bAndroid\b/i.test(input.userAgent || '')) {
    return 'android-hlsjs';
  }

  return 'desktop-hlsjs';
}

export function resolveHlsPlaybackPolicy({
  directUrl,
  isAppleNativeHlsEnvironment,
}: HlsPlaybackPolicyInput): HlsPlaybackPolicyResult {
  const runtime: HlsPlaybackRuntime = isAppleNativeHlsEnvironment
    ? 'native-hls'
    : 'hlsjs';
  const recoveryProfile: HlsRecoveryProfile = isAppleNativeHlsEnvironment
    ? 'native-video'
    : 'hlsjs';

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
