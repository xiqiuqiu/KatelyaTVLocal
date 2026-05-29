import type { SourcePlaybackMode } from './types';

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
  if (rememberedPlaybackMode === 'proxy') {
    if (proxyUrl) {
      return {
        mode: 'proxy',
        url: proxyUrl,
        reason: 'remembered-proxy',
        forcedProxyForAdFiltering: false,
      };
    }

    return {
      mode: 'direct',
      url: directUrl,
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
        reason: 'apple-native-hls-ad-filter',
        forcedProxyForAdFiltering: true,
      };
    }

    return {
      mode: 'direct',
      url: directUrl,
      reason: 'proxy-unavailable',
      forcedProxyForAdFiltering: false,
    };
  }

  return {
    mode: 'direct',
    url: directUrl,
    reason: 'direct-preferred',
    forcedProxyForAdFiltering: false,
  };
}
