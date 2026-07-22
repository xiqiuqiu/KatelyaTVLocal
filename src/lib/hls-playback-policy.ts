import type { SourcePlaybackMode } from './types';

export type HlsPlaybackRuntime = 'hlsjs';
/**
 * 广告处理已统一为单一 seek 式 Ad Skip Window 路径（ADR 0004）：
 * 所有运行时均以 `skip` 表示“喂入时间窗后由 reducer 经 seek 跳过”，
 * 不再区分桌面/安卓 `client-filter`（物理删分片）与 iOS `ios-skip`。
 */
export type HlsPlaylistFilterMode = 'skip' | 'none';
export type HlsSegmentMode = 'direct' | 'proxy';
export type HlsRecoveryProfile = 'hlsjs';
export type PlaybackProbePlatform =
  | 'apple-hlsjs'
  | 'android-hlsjs'
  | 'desktop-hlsjs';

export type HlsPlaybackPolicyReason = 'direct-preferred' | 'device-unsupported';

export interface AppleDeviceDetectionInput {
  userAgent?: string | null;
  platform?: string | null;
  userAgentDataPlatform?: string | null;
  maxTouchPoints?: number | null;
}

export interface ApplePlaybackCapabilities {
  isAppleDevice: boolean;
  hasManagedMediaSource: boolean;
  hlsJsSupported: boolean;
}

export interface HlsPlaybackPolicyInput {
  directUrl: string;
  proxyUrl?: string | null;
  adFilteringProxyUrl?: string | null;
  rememberedPlaybackMode?: SourcePlaybackMode | null;
  appleCapabilities: ApplePlaybackCapabilities;
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
  deviceUnsupported: boolean;
  disableRemotePlayback: boolean;
}

export function detectAppleDevice({
  userAgent,
  platform,
  userAgentDataPlatform,
  maxTouchPoints,
}: AppleDeviceDetectionInput): boolean {
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
  input: AppleDeviceDetectionInput
): PlaybackProbePlatform {
  if (detectAppleDevice(input)) {
    return 'apple-hlsjs';
  }

  if (/\bAndroid\b/i.test(input.userAgent || '')) {
    return 'android-hlsjs';
  }

  return 'desktop-hlsjs';
}

export function resolveHlsPlaybackPolicy({
  directUrl,
  appleCapabilities,
}: HlsPlaybackPolicyInput): HlsPlaybackPolicyResult {
  const deviceUnsupported =
    appleCapabilities.isAppleDevice &&
    (!appleCapabilities.hasManagedMediaSource ||
      !appleCapabilities.hlsJsSupported);

  return {
    mode: 'direct',
    url: directUrl,
    runtime: 'hlsjs',
    playlistFilter: 'skip',
    segmentMode: 'direct',
    recoveryProfile: 'hlsjs',
    reason: deviceUnsupported ? 'device-unsupported' : 'direct-preferred',
    forcedProxyForAdFiltering: false,
    deviceUnsupported,
    disableRemotePlayback: appleCapabilities.isAppleDevice,
  };
}
