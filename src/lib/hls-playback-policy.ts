import type { SourcePlaybackMode } from './types';

export type HlsPlaybackRuntime = 'hlsjs' | 'native-hls';
/**
 * 广告处理已统一为单一 seek 式 Ad Skip Window 路径（ADR 0004）：
 * 所有运行时均以 `skip` 表示“喂入时间窗后由 reducer 经 seek 跳过”，
 * 不再区分桌面/安卓 `client-filter`（物理删分片）与 iOS `ios-skip`。
 */
export type HlsPlaylistFilterMode = 'skip' | 'none';
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
      playlistFilter: 'skip',
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
    playlistFilter: 'skip',
    segmentMode: 'direct',
    recoveryProfile,
    reason: 'direct-preferred',
    forcedProxyForAdFiltering: false,
  };
}
