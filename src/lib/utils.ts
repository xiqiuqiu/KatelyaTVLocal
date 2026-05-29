/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import Hls from 'hls.js';

import {
  SourceDomainPreference,
  SourcePlaybackMode,
  SourceProbeResult,
  SourceStatus,
  SourceStatusKind,
  SourceVideoInfo,
} from './types';

const SOURCE_DOMAIN_MEMORY_KEY = 'sourceDomainPreferences';
const SOURCE_DOMAIN_MEMORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCE_DOMAIN_MEMORY_NEGATIVE_TTL_MS = 15 * 60 * 1000; // 15 minutes for unavailable
const BROWSER_PROBE_ERROR_PATTERNS = [
  'Timeout loading video metadata',
  'Failed to load video metadata',
  '浏览器直连检测失败',
  'HLS播放失败:',
];

function readSourceDomainPreferenceMap(): Record<
  string,
  SourceDomainPreference
> {
  if (typeof window === 'undefined') return {};

  try {
    const rawValue = localStorage.getItem(SOURCE_DOMAIN_MEMORY_KEY);
    if (!rawValue) return {};

    const parsed = JSON.parse(rawValue) as Record<
      string,
      SourceDomainPreference
    >;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSourceDomainPreferenceMap(
  value: Record<string, SourceDomainPreference>
): void {
  if (typeof window === 'undefined') return;

  localStorage.setItem(SOURCE_DOMAIN_MEMORY_KEY, JSON.stringify(value));
}

export function getSourceIdentityKey(source: string, id: string): string {
  return `${source}-${id}`;
}

export function normalizeSourceUrl(url: string): string | null {
  if (!url) return null;

  const trimmedUrl = url.trim();
  if (!trimmedUrl) return null;

  try {
    return new URL(trimmedUrl).toString();
  } catch {
    return null;
  }
}

export function extractSourceDomain(url: string): string | null {
  const normalizedUrl = normalizeSourceUrl(url);
  if (!normalizedUrl) return null;

  try {
    return new URL(normalizedUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function getSourceDomainFromEpisodes(episodes: string[]): string | null {
  if (!episodes?.length) return null;

  for (const episodeUrl of episodes) {
    const domain = extractSourceDomain(episodeUrl);
    if (domain) {
      return domain;
    }
  }

  return null;
}

export function getSourceDomainPreference(
  domain: string | null
): SourceDomainPreference | null {
  if (!domain || typeof window === 'undefined') return null;

  const allPreferences = readSourceDomainPreferenceMap();
  const preference = allPreferences[domain];
  if (!preference) return null;

  const ttl =
    preference.mode === 'unavailable'
      ? SOURCE_DOMAIN_MEMORY_NEGATIVE_TTL_MS
      : SOURCE_DOMAIN_MEMORY_TTL_MS;

  if (Date.now() - preference.updatedAt > ttl) {
    delete allPreferences[domain];
    writeSourceDomainPreferenceMap(allPreferences);
    return null;
  }

  return preference;
}

function isTransientBrowserProbeError(error?: string): boolean {
  if (!error) return false;

  return BROWSER_PROBE_ERROR_PATTERNS.some((pattern) =>
    error.includes(pattern)
  );
}

export function rememberSourceDomainPreference(
  domain: string | null,
  mode: SourcePlaybackMode | 'unavailable',
  error?: string
): void {
  if (!domain || typeof window === 'undefined') return;

  const allPreferences = readSourceDomainPreferenceMap();
  const previousPreference = allPreferences[domain];

  allPreferences[domain] = {
    mode,
    failCount: mode === 'direct' ? 0 : (previousPreference?.failCount || 0) + 1,
    updatedAt: Date.now(),
    lastError: error,
  };

  writeSourceDomainPreferenceMap(allPreferences);
}

export function clearSourceDomainPreference(domain: string | null): void {
  if (!domain || typeof window === 'undefined') return;

  const allPreferences = readSourceDomainPreferenceMap();
  if (!(domain in allPreferences)) return;

  delete allPreferences[domain];
  writeSourceDomainPreferenceMap(allPreferences);
}

export function createSourceStatus(
  kind: SourceStatusKind,
  options: {
    reason?: string;
    playbackMode?: SourcePlaybackMode;
    domain?: string | null;
    measured?: SourceVideoInfo;
    updatedAt?: number;
    fromMemory?: boolean;
    rankingSource?: 'd1' | 'live';
    rankScore?: number;
  } = {}
): SourceStatus {
  return {
    kind,
    reason: options.reason,
    playbackMode: options.playbackMode,
    domain: options.domain,
    measured: options.measured,
    updatedAt: options.updatedAt ?? Date.now(),
    fromMemory: options.fromMemory,
    rankingSource: options.rankingSource,
    rankScore: options.rankScore,
  };
}

export function createPlayableSourceStatus(options: {
  reason?: string;
  playbackMode?: SourcePlaybackMode;
  domain?: string | null;
  measured?: SourceVideoInfo;
  updatedAt?: number;
  fromMemory?: boolean;
  rankingSource?: 'd1' | 'live';
  rankScore?: number;
} = {}): SourceStatus {
  return createSourceStatus('playable', {
    reason: options.reason || '测速失败，可尝试播放',
    playbackMode: options.playbackMode,
    domain: options.domain,
    measured: options.measured,
    updatedAt: options.updatedAt,
    fromMemory: options.fromMemory,
    rankingSource: options.rankingSource,
    rankScore: options.rankScore,
  });
}

export function getRememberedSourceStatus(
  episodes: string[]
): SourceStatus | null {
  const domain = getSourceDomainFromEpisodes(episodes);
  const preference = getSourceDomainPreference(domain);
  if (!preference) return null;

  if (preference.mode === 'unavailable') {
    if (isTransientBrowserProbeError(preference.lastError)) {
      clearSourceDomainPreference(domain);
      return null;
    }

    return createSourceStatus('unavailable', {
      domain,
      reason: preference.lastError || '该源近期不可用',
      fromMemory: true,
      updatedAt: preference.updatedAt,
    });
  }

  return createSourceStatus(preference.mode, {
    domain,
    playbackMode: preference.mode,
    reason:
      preference.mode === 'proxy'
        ? '该源近期更适合通过代理播放'
        : '该源近期可直接播放',
    fromMemory: true,
    updatedAt: preference.updatedAt,
  });
}

export function getSourceStatusLabel(status: SourceStatus): string {
  switch (status.kind) {
    case 'probing':
      return '检测中';
    case 'direct':
      return '直连';
    case 'proxy':
      return '代理';
    case 'playable':
      return '可播';
    case 'unavailable':
      return '不可用';
    default:
      return '待检测';
  }
}

export function isSourceStatusClickable(
  status: SourceStatus | null | undefined
): boolean {
  if (!status) return true;

  return status.kind !== 'unavailable' && status.kind !== 'probing';
}

export function getSourceProbeUrl(): string | null {
  if (typeof window === 'undefined') return null;

  const serverSourceProbe = (window as any).RUNTIME_CONFIG?.SOURCE_PROBE;
  return serverSourceProbe && serverSourceProbe.trim()
    ? serverSourceProbe.trim()
    : null;
}

export function getLocalSourceProbeUrl(): string | null {
  if (typeof window === 'undefined') return null;

  return '/api/source-probe?url=';
}

export function buildSourceProbeUrl(
  originalUrl: string,
  probeUrl = getSourceProbeUrl()
): string | null {
  if (!originalUrl || !probeUrl) return null;

  return `${probeUrl}${encodeURIComponent(originalUrl)}`;
}

function getSourceProbeRequestUrls(originalUrl: string): string[] {
  const urls = [
    buildSourceProbeUrl(originalUrl, getSourceProbeUrl()),
    buildSourceProbeUrl(originalUrl, getLocalSourceProbeUrl()),
  ].filter((url): url is string => Boolean(url));

  return Array.from(new Set(urls));
}

export async function probeSourcePlayback(
  sourceUrl: string
): Promise<SourceProbeResult> {
  const normalizedUrl = normalizeSourceUrl(sourceUrl);

  if (!normalizedUrl) {
    return {
      kind: 'unavailable',
      reason: '无效播放地址',
      domain: null,
    };
  }

  const requestUrls = getSourceProbeRequestUrls(normalizedUrl);
  if (requestUrls.length === 0) {
    return {
      kind: 'unavailable',
      reason: '未配置来源探测端点',
      domain: extractSourceDomain(normalizedUrl),
    };
  }

  let lastFailureReason = '服务端探测失败';

  for (const requestUrl of requestUrls) {
    try {
      const response = await fetch(requestUrl, {
        method: 'GET',
        cache: 'no-store',
      });

      const payload = (await response.json().catch(() => null)) as
        | SourceProbeResult
        | { error?: string }
        | null;

      if (!response.ok) {
        lastFailureReason =
          (payload && 'error' in payload && payload.error) ||
          `服务端探测失败: ${response.status}`;
        continue;
      }

      if (!payload || !('kind' in payload)) {
        lastFailureReason = '服务端探测返回无效结果';
        continue;
      }

      return {
        ...payload,
        domain: payload.domain ?? extractSourceDomain(normalizedUrl),
      };
    } catch (error) {
      lastFailureReason =
        error instanceof Error ? error.message : '服务端探测失败';
    }
  }

  return {
    kind: 'unavailable',
    reason: lastFailureReason,
    domain: extractSourceDomain(normalizedUrl),
  };
}

/**
 * 获取图片代理 URL 设置
 */
export function getImageProxyUrl(): string | null {
  if (typeof window === 'undefined') return null;

  // 本地未开启图片代理，则不使用代理
  const enableImageProxy = localStorage.getItem('enableImageProxy');
  if (enableImageProxy !== null) {
    if (!JSON.parse(enableImageProxy) as boolean) {
      return null;
    }
  }

  const localImageProxy = localStorage.getItem('imageProxyUrl');
  if (localImageProxy != null) {
    return localImageProxy.trim() ? localImageProxy.trim() : null;
  }

  // 如果未设置，则使用全局对象
  const serverImageProxy = (window as any).RUNTIME_CONFIG?.IMAGE_PROXY;
  return serverImageProxy && serverImageProxy.trim()
    ? serverImageProxy.trim()
    : null;
}

/**
 * 处理图片 URL，如果设置了图片代理则使用代理
 */
export interface ImageProxyOptions {
  width?: number;
  height?: number;
  quality?: number;
}

function appendImageProxyOptions(
  proxiedUrl: string,
  options?: ImageProxyOptions
): string {
  const params = new URLSearchParams();

  if (options?.width) {
    params.set('w', String(options.width));
  }
  if (options?.height) {
    params.set('h', String(options.height));
  }
  if (options?.quality) {
    params.set('q', String(options.quality));
  }

  const queryString = params.toString();
  if (!queryString) return proxiedUrl;

  return `${proxiedUrl}${proxiedUrl.includes('?') ? '&' : '?'}${queryString}`;
}

export function processImageUrl(
  originalUrl: string,
  options?: ImageProxyOptions
): string {
  if (!originalUrl) return originalUrl;

  const proxyUrl = getImageProxyUrl();
  if (!proxyUrl) return originalUrl;

  return appendImageProxyOptions(
    `${proxyUrl}${encodeURIComponent(originalUrl)}`,
    options
  );
}

/**
 * 获取豆瓣代理 URL 设置
 */
export function getDoubanProxyUrl(): string | null {
  if (typeof window === 'undefined') return null;

  // 本地未开启豆瓣代理，则不使用代理
  const enableDoubanProxy = localStorage.getItem('enableDoubanProxy');
  if (enableDoubanProxy !== null) {
    if (!JSON.parse(enableDoubanProxy) as boolean) {
      return null;
    }
  }

  const localDoubanProxy = localStorage.getItem('doubanProxyUrl');
  if (localDoubanProxy != null) {
    return localDoubanProxy.trim() ? localDoubanProxy.trim() : null;
  }

  // 如果未设置，则使用全局对象
  const serverDoubanProxy = (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY;
  return serverDoubanProxy && serverDoubanProxy.trim()
    ? serverDoubanProxy.trim()
    : null;
}

/**
 * 获取 HLS 代理 URL 设置
 */
export function getHlsProxyUrl(): string | null {
  if (typeof window === 'undefined') return null;

  const serverHlsProxy = (window as any).RUNTIME_CONFIG?.HLS_PROXY;
  return serverHlsProxy && serverHlsProxy.trim() ? serverHlsProxy.trim() : null;
}

/**
 * 处理 HLS URL，如果配置了代理则使用代理
 */
export function buildHlsProxyUrl(originalUrl: string): string | null {
  if (!originalUrl) return null;

  const proxyUrl = getHlsProxyUrl();
  if (!proxyUrl) return null;

  return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
}

/**
 * 处理豆瓣 URL，如果设置了豆瓣代理则使用代理
 */
export function processDoubanUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  const proxyUrl = getDoubanProxyUrl();
  if (!proxyUrl) return originalUrl;

  return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
}

export function cleanHtmlTags(text: string): string {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '\n') // 将 HTML 标签替换为换行
    .replace(/\n+/g, '\n') // 将多个连续换行合并为一个
    .replace(/[ \t]+/g, ' ') // 将多个连续空格和制表符合并为一个空格，但保留换行符
    .replace(/^\n+|\n+$/g, '') // 去掉首尾换行
    .replace(/&nbsp;/g, ' ') // 将 &nbsp; 替换为空格
    .trim(); // 去掉首尾空格
}

/**
 * 从m3u8地址获取视频质量等级和网络信息
 * @param m3u8Url m3u8播放列表的URL
 * @returns Promise<{quality: string, loadSpeed: string, pingTime: number}> 视频质量等级和网络信息
 */
export async function getVideoResolutionFromM3u8(m3u8Url: string): Promise<{
  quality: string; // 如720p、1080p等
  loadSpeed: string; // 自动转换为KB/s或MB/s
  pingTime: number; // 网络延迟（毫秒）
}> {
  try {
    // 直接使用m3u8 URL作为视频源，避免CORS问题
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';

      // 测量网络延迟（ping时间） - 使用m3u8 URL而不是ts文件
      const pingStart = performance.now();
      let pingTime = 0;

      // 测量ping时间（使用m3u8 URL）
      fetch(m3u8Url, { method: 'HEAD', mode: 'no-cors' })
        .then(() => {
          pingTime = performance.now() - pingStart;
        })
        .catch(() => {
          pingTime = performance.now() - pingStart; // 记录到失败为止的时间
        });

      // 固定使用hls.js加载
      const hls = new Hls();

      // 设置超时处理
      const timeout = setTimeout(() => {
        hls.destroy();
        video.remove();
        reject(new Error('Timeout loading video metadata'));
      }, 8000);

      video.onerror = () => {
        clearTimeout(timeout);
        hls.destroy();
        video.remove();
        reject(new Error('Failed to load video metadata'));
      };

      let actualLoadSpeed = '未知';
      let hasSpeedCalculated = false;
      let hasMetadataLoaded = false;

      let fragmentStartTime = 0;

      // 检查是否可以返回结果
      const checkAndResolve = () => {
        if (
          hasMetadataLoaded &&
          (hasSpeedCalculated || actualLoadSpeed !== '未知')
        ) {
          clearTimeout(timeout);
          const width = video.videoWidth;
          if (width && width > 0) {
            hls.destroy();
            video.remove();

            // 根据视频宽度判断视频质量等级，使用经典分辨率的宽度作为分割点
            const quality =
              width >= 3840
                ? '4K' // 4K: 3840x2160
                : width >= 2560
                ? '2K' // 2K: 2560x1440
                : width >= 1920
                ? '1080p' // 1080p: 1920x1080
                : width >= 1280
                ? '720p' // 720p: 1280x720
                : width >= 854
                ? '480p'
                : 'SD'; // 480p: 854x480

            resolve({
              quality,
              loadSpeed: actualLoadSpeed,
              pingTime: Math.round(pingTime),
            });
          } else {
            // webkit 无法获取尺寸，直接返回
            resolve({
              quality: '未知',
              loadSpeed: actualLoadSpeed,
              pingTime: Math.round(pingTime),
            });
          }
        }
      };

      // 监听片段加载开始
      hls.on(Hls.Events.FRAG_LOADING, () => {
        fragmentStartTime = performance.now();
      });

      // 监听片段加载完成，只需首个分片即可计算速度
      hls.on(Hls.Events.FRAG_LOADED, (event: any, data: any) => {
        if (
          fragmentStartTime > 0 &&
          data &&
          data.payload &&
          !hasSpeedCalculated
        ) {
          const loadTime = performance.now() - fragmentStartTime;
          const size = data.payload.byteLength || 0;

          if (loadTime > 0 && size > 0) {
            const speedKBps = size / 1024 / (loadTime / 1000);

            // 立即计算速度，无需等待更多分片
            const avgSpeedKBps = speedKBps;

            if (avgSpeedKBps >= 1024) {
              actualLoadSpeed = `${(avgSpeedKBps / 1024).toFixed(1)} MB/s`;
            } else {
              actualLoadSpeed = `${avgSpeedKBps.toFixed(1)} KB/s`;
            }
            hasSpeedCalculated = true;
            checkAndResolve(); // 尝试返回结果
          }
        }
      });

      hls.loadSource(m3u8Url);
      hls.attachMedia(video);

      // 监听hls.js错误
      hls.on(Hls.Events.ERROR, (event: any, data: any) => {
        console.error('HLS错误:', data);
        if (data.fatal) {
          clearTimeout(timeout);
          hls.destroy();
          video.remove();
          reject(new Error(`HLS播放失败: ${data.type}`));
        }
      });

      // 监听视频元数据加载完成
      video.onloadedmetadata = () => {
        hasMetadataLoaded = true;
        checkAndResolve(); // 尝试返回结果
      };
    });
  } catch (error) {
    throw new Error(
      `Error getting video resolution: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
