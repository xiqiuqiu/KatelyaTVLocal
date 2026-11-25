/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import Hls, { type FragLoadingData } from 'hls.js';

import { formatSourceSpeedKbps } from './source-preference-video-info';
import {
  SOURCE_CORS_BLOCKED_REASON,
  SourceDomainPreference,
  SourcePlaybackMode,
  SourcePlaybackQualityPreference,
  SourceProbeResult,
  SourceStatus,
  SourceStatusKind,
  SourceVideoInfo,
} from './types';

const SOURCE_DOMAIN_MEMORY_KEY = 'sourceDomainPreferences';
const SOURCE_PLAYBACK_QUALITY_MEMORY_KEY = 'sourcePlaybackQualityPreferences';
const SOURCE_DOMAIN_MEMORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCE_DOMAIN_MEMORY_NEGATIVE_TTL_MS = 15 * 60 * 1000; // 15 minutes for unavailable
const SOURCE_PLAYBACK_QUALITY_SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCE_PLAYBACK_QUALITY_FAILURE_TTL_MS = 20 * 60 * 1000;
const BROWSER_PROBE_ERROR_PATTERNS = [
  'Timeout loading video metadata',
  'Failed to load video metadata',
  '浏览器直连检测失败',
  'HLS播放失败:',
  'The operation was aborted',
  'AbortError',
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
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, preference]) =>
          preference?.mode === 'direct' || preference?.mode === 'unavailable'
      )
    );
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

function readSourcePlaybackQualityPreferenceMap(): Record<
  string,
  SourcePlaybackQualityPreference
> {
  if (typeof window === 'undefined') return {};

  try {
    const rawValue = localStorage.getItem(SOURCE_PLAYBACK_QUALITY_MEMORY_KEY);
    if (!rawValue) return {};

    const parsed = JSON.parse(rawValue) as Record<
      string,
      SourcePlaybackQualityPreference
    >;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, preference]) =>
          preference?.mode === 'direct' || preference?.mode === 'unavailable'
      )
    );
  } catch {
    return {};
  }
}

function writeSourcePlaybackQualityPreferenceMap(
  value: Record<string, SourcePlaybackQualityPreference>
): void {
  if (typeof window === 'undefined') return;

  localStorage.setItem(
    SOURCE_PLAYBACK_QUALITY_MEMORY_KEY,
    JSON.stringify(value)
  );
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

function getSourcePlaybackQualityKey(
  sourceKey: string,
  domain: string | null
): string | null {
  if (!sourceKey || !domain) return null;

  return `${sourceKey}@@${domain}`;
}

function parseSpeedKbpsFromLabel(label?: string): number | undefined {
  if (!label) return undefined;

  const match = label.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
  if (!match) return undefined;

  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return undefined;

  return match[2] === 'MB/s' ? value * 1024 : value;
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
  if (
    !domain ||
    typeof window === 'undefined' ||
    error === SOURCE_CORS_BLOCKED_REASON
  ) {
    return;
  }

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

export function rememberSourcePlaybackQuality(
  sourceKey: string,
  domain: string | null,
  update: {
    mode: SourcePlaybackMode | 'unavailable';
    episodeUrl?: string;
    startupTimeMs?: number;
    observedSpeedKbps?: number;
    browserSpeedLabel?: string;
    stallCount?: number;
    confidence?: 'low' | 'medium' | 'high';
    lastError?: string;
  }
): void {
  const key = getSourcePlaybackQualityKey(sourceKey, domain);
  if (!key || typeof window === 'undefined') return;

  const allPreferences = readSourcePlaybackQualityPreferenceMap();
  const stored = allPreferences[key];
  const previous =
    stored?.episodeUrl === update.episodeUrl ? stored : undefined;
  const now = Date.now();
  const observedSpeedKbps =
    update.observedSpeedKbps ??
    parseSpeedKbpsFromLabel(update.browserSpeedLabel) ??
    previous?.observedSpeedKbps;

  allPreferences[key] = {
    mode: update.mode,
    episodeUrl: update.episodeUrl,
    lastPlayableAt: update.mode === 'direct' ? now : previous?.lastPlayableAt,
    lastFailedAt: update.mode === 'unavailable' ? now : previous?.lastFailedAt,
    startupTimeMs: update.startupTimeMs ?? previous?.startupTimeMs,
    observedSpeedKbps,
    browserSpeedLabel: update.browserSpeedLabel ?? previous?.browserSpeedLabel,
    stallCount: update.stallCount ?? previous?.stallCount,
    confidence:
      update.confidence ?? (update.mode === 'unavailable' ? 'medium' : 'high'),
    lastError: update.lastError,
    updatedAt: now,
  };

  writeSourcePlaybackQualityPreferenceMap(allPreferences);
}

export function getSourcePlaybackQualityPreference(
  sourceKey: string,
  domain: string | null
): SourcePlaybackQualityPreference | null {
  const key = getSourcePlaybackQualityKey(sourceKey, domain);
  if (!key || typeof window === 'undefined') return null;

  const allPreferences = readSourcePlaybackQualityPreferenceMap();
  const preference = allPreferences[key];
  if (!preference) return null;

  const ttl =
    preference.mode === 'unavailable'
      ? SOURCE_PLAYBACK_QUALITY_FAILURE_TTL_MS
      : SOURCE_PLAYBACK_QUALITY_SUCCESS_TTL_MS;

  if (Date.now() - preference.updatedAt > ttl) {
    delete allPreferences[key];
    writeSourcePlaybackQualityPreferenceMap(allPreferences);
    return null;
  }

  return preference;
}

function clearSourcePlaybackQualityPreference(
  sourceKey: string,
  domain: string | null
): void {
  const key = getSourcePlaybackQualityKey(sourceKey, domain);
  if (!key || typeof window === 'undefined') return;

  const allPreferences = readSourcePlaybackQualityPreferenceMap();
  if (!(key in allPreferences)) return;

  delete allPreferences[key];
  writeSourcePlaybackQualityPreferenceMap(allPreferences);
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
    localConfidence?: 'low' | 'medium' | 'high';
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
    localConfidence: options.localConfidence,
  };
}

export function createPlayableSourceStatus(
  options: {
    reason?: string;
    playbackMode?: SourcePlaybackMode;
    domain?: string | null;
    measured?: SourceVideoInfo;
    updatedAt?: number;
    fromMemory?: boolean;
    rankingSource?: 'd1' | 'live';
    rankScore?: number;
    localConfidence?: 'low' | 'medium' | 'high';
  } = {}
): SourceStatus {
  return createSourceStatus('playable', {
    reason: options.reason || '测速失败，可尝试播放',
    playbackMode: options.playbackMode,
    domain: options.domain,
    measured: options.measured,
    updatedAt: options.updatedAt,
    fromMemory: options.fromMemory,
    rankingSource: options.rankingSource,
    rankScore: options.rankScore,
    localConfidence: options.localConfidence,
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
    reason: '该源近期可直接播放',
    fromMemory: true,
    updatedAt: preference.updatedAt,
  });
}

export function getRememberedSourceStatusForSource(
  sourceKey: string,
  episodes: string[],
  episodeIndex = 0
): SourceStatus | null {
  const episodeUrl = episodes?.[episodeIndex];
  if (!episodeUrl) return null;
  const domain = extractSourceDomain(episodeUrl);
  const preference = getSourcePlaybackQualityPreference(sourceKey, domain);

  // Older source/domain memories can influence order, but did not verify this URL.
  const rememberedOrder = () => {
    if (
      preference?.mode !== 'direct' &&
      getSourceDomainPreference(domain)?.mode !== 'direct'
    ) {
      return null;
    }
    return createSourceStatus('idle', {
      domain,
      fromMemory: true,
      localConfidence: preference?.confidence,
      reason: '本机近期有播放记录，当前集待检测',
    });
  };
  if (!preference || preference.episodeUrl !== episodeUrl)
    return rememberedOrder();

  if (preference.mode === 'unavailable') {
    if (
      preference.confidence === 'low' ||
      isTransientBrowserProbeError(preference.lastError)
    ) {
      clearSourcePlaybackQualityPreference(sourceKey, domain);
      return rememberedOrder();
    }

    return createSourceStatus('unavailable', {
      domain,
      reason: preference.lastError || '该源近期在本机不可用',
      fromMemory: true,
      updatedAt: preference.updatedAt,
      localConfidence: preference.confidence,
    });
  }

  const speedLabel =
    preference.browserSpeedLabel ||
    (typeof preference.observedSpeedKbps === 'number'
      ? `${Math.max(1, preference.observedSpeedKbps).toFixed(0)} KB/s`
      : '未知');

  return createSourceStatus(preference.mode, {
    domain,
    playbackMode: preference.mode,
    reason: '本机近期播放流畅',
    fromMemory: true,
    measured: {
      quality: '未知',
      loadSpeed: speedLabel,
      pingTime: preference.startupTimeMs || 0,
      speedSource: 'feedback',
      speedUpdatedAt: preference.updatedAt,
      speedPending: speedLabel === '未知',
    },
    updatedAt: preference.updatedAt,
    localConfidence: preference.confidence,
  });
}

export function getSourceStatusLabel(status: SourceStatus): string {
  switch (status.kind) {
    case 'probing':
      return '检测中';
    case 'direct':
      return '推荐·直连';
    case 'playable':
      return '可尝试';
    case 'unavailable':
      return '不可用';
    default:
      return '待检测';
  }
}

export function getSourceStatusDescription(
  status: SourceStatus | null | undefined,
  videoInfo = status?.measured
): string {
  if (status?.kind === 'probing') {
    return '正在检测当前线路';
  }

  // Keep badge/description consistent: never advertise speed for an
  // unavailable line.
  if (videoInfo && !videoInfo.hasError && status?.kind !== 'unavailable') {
    const speed = formatSourceVideoInfoSpeed(videoInfo);
    return videoInfo.browserSpeedUnmeasured && videoInfo.pingTime <= 0
      ? speed
      : `${speed} · ${videoInfo.pingTime}ms`;
  }

  switch (status?.kind) {
    case 'direct':
      return '推荐优先使用，浏览器可直接播放';
    case 'playable':
      return '可尝试播放，失败时可换源';
    case 'unavailable':
      return '该线路当前不可用';
    default:
      return '等待检测线路状态';
  }
}

function formatSourceVideoInfoSpeed(videoInfo: SourceVideoInfo): string {
  if (videoInfo.browserSpeedUnmeasured) {
    return videoInfo.speedSource === 'backend'
      ? `后端 ${videoInfo.loadSpeed} · 本机速度未测得`
      : '速度未测得';
  }
  switch (videoInfo.speedSource) {
    case 'backend':
      return `后端 ${videoInfo.loadSpeed}`;
    case 'browser':
      return `本机 ${videoInfo.loadSpeed}`;
    case 'feedback':
      return videoInfo.loadSpeed === '待检测，可尝试'
        ? '近期可播'
        : `近期 ${videoInfo.loadSpeed}`;
    case 'none':
      return videoInfo.speedPending ? '待检测，可尝试' : videoInfo.loadSpeed;
    default:
      return videoInfo.loadSpeed;
  }
}

export function isSourceStatusClickable(
  status: SourceStatus | null | undefined
): boolean {
  if (!status) return true;

  return status.kind !== 'unavailable';
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

      if (
        !payload ||
        typeof payload !== 'object' ||
        !('kind' in payload) ||
        (payload.kind !== 'direct' && payload.kind !== 'unavailable')
      ) {
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

export class SourceSpeedProbeTimeoutError extends Error {
  constructor() {
    super('Timeout loading video metadata');
  }
}

export function markBrowserSpeedUnmeasured(
  info?: SourceVideoInfo
): SourceVideoInfo {
  if (info?.speedSource === 'browser' && !info.hasError && !info.speedPending) {
    return info;
  }
  return {
    ...(info && !info.hasError
      ? info
      : {
          quality: '未知',
          loadSpeed: '速度未测得',
          pingTime: 0,
          speedSource: 'none',
        }),
    browserSpeedUnmeasured: true,
  };
}

const MIN_SPEED_SAMPLE_BYTES = 64 * 1024;
const MIN_SPEED_SAMPLE_TIME_MS = 50;
const REQUIRED_SPEED_SAMPLES = 2;
const MAX_SPEED_SAMPLE_ATTEMPTS = 3;

/** Use a dedicated HLS instance so playback can keep its normal cache. */
export function getVideoResolutionFromM3u8(
  m3u8Url: string,
  options: {
    timeoutMs?: number;
    background?: boolean;
    extension?: { maxTimeoutMs: number; canContinue: () => boolean };
  } = {}
): Promise<SourceVideoInfo> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    const uncachedUrls = new Set<string>();
    let usesUncachedLoader = false;
    const hls = new Hls({
      progressive: true,
      fetchSetup: (context, init) => {
        const request = new Request(context.url, {
          ...init,
          cache: 'no-store',
          ...(options.background ? { priority: 'low' } : {}),
        });
        usesUncachedLoader = true;
        uncachedUrls.add(request.url);
        return request;
      },
    });
    let hasMetadata = false;
    let activeFragment: FragLoadingData['frag'] | undefined;
    let receivedFragmentData = false;
    let sampleCount = 0;
    let sampleAttempts = 0;
    let sampleBytes = 0;
    let sampleTimeMs = 0;
    let pingTime = 0;
    let playbackBitrateBps: number | undefined;
    let settled = false;
    let extending = false;
    const timeoutMs = options.timeoutMs ?? 8000;
    const extension = options.background ? options.extension : undefined;
    const startedAt = performance.now();
    const softDeadline = startedAt + timeoutMs;
    const hardDeadline = startedAt + (extension?.maxTimeoutMs ?? timeoutMs);
    let timeout: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      settled = true;
      clearTimeout(timeout);
      hls.destroy();
      video.remove();
    };
    const fail = (error: Error) => {
      if (settled) return;
      cleanup();
      reject(error);
    };
    const finish = () => {
      if (settled) return;
      const width = video.videoWidth;
      const quality =
        width >= 3840
          ? '4K'
          : width >= 2560
          ? '2K'
          : width >= 1920
          ? '1080p'
          : width >= 1280
          ? '720p'
          : width >= 854
          ? '480p'
          : width > 0
          ? 'SD'
          : '未知';
      const speed =
        sampleCount >= REQUIRED_SPEED_SAMPLES &&
        (performance.now() < softDeadline ||
          (extending &&
            performance.now() < hardDeadline &&
            extension?.canContinue()))
          ? formatSourceSpeedKbps((sampleBytes * 8) / sampleTimeMs)
          : null;
      cleanup();
      const info: SourceVideoInfo = {
        quality,
        loadSpeed: speed || '速度未测得',
        pingTime: Math.round(pingTime),
        playbackBitrateBps,
        speedSource: speed ? 'browser' : 'none',
        speedUpdatedAt: speed ? Date.now() : undefined,
      };
      resolve(speed ? info : markBrowserSpeedUnmeasured(info));
    };
    const expire = () => {
      if (hasMetadata) {
        finish();
      } else {
        fail(new SourceSpeedProbeTimeoutError());
      }
    };
    const checkExtension = () => {
      const remaining = hardDeadline - performance.now();
      if (remaining <= 0 || !extension?.canContinue()) {
        expire();
        return;
      }
      timeout = setTimeout(checkExtension, Math.min(100, remaining));
    };
    timeout = setTimeout(() => {
      const activeFragmentHasData =
        activeFragment &&
        uncachedUrls.has(activeFragment.url) &&
        activeFragment.stats.loaded > 0;
      if (extension && (receivedFragmentData || activeFragmentHasData)) {
        extending = true;
        checkExtension();
      } else {
        expire();
      }
    }, timeoutMs);
    const hasFinishedSampling = () =>
      sampleCount >= REQUIRED_SPEED_SAMPLES ||
      sampleAttempts >= MAX_SPEED_SAMPLE_ATTEMPTS;
    video.onerror = () => fail(new Error('Failed to load video metadata'));
    video.onloadedmetadata = () => {
      hasMetadata = true;
      if (hasFinishedSampling() || !usesUncachedLoader) finish();
    };

    hls.on(Hls.Events.MANIFEST_LOADED, (_event, { stats, url }) => {
      if (!uncachedUrls.has(url) && !uncachedUrls.has(m3u8Url)) return;
      pingTime = Math.max(0, stats.loading.first - stats.loading.start);
    });
    hls.on(Hls.Events.FRAG_LOADING, (_event, { frag, part }) => {
      if (frag.type === 'main' && frag.sn !== 'initSegment' && !part) {
        // The fragment loader updates this fragment's stats as the body arrives.
        activeFragment = frag;
      }
    });
    hls.on(Hls.Events.FRAG_LOADED, (_event, { frag, part }) => {
      if (frag.type !== 'main' || frag.sn === 'initSegment' || part) return;
      const level = hls.levels[frag.level];
      playbackBitrateBps = level?.averageBitrate || level?.bitrate || undefined;

      if (hasFinishedSampling() || !uncachedUrls.delete(frag.url)) return;
      sampleAttempts += 1;
      const { loaded, loading } = frag.stats;
      receivedFragmentData ||= loaded > 0;
      const elapsed = loading.end - loading.start;
      if (
        loaded >= MIN_SPEED_SAMPLE_BYTES &&
        elapsed >= MIN_SPEED_SAMPLE_TIME_MS
      ) {
        sampleCount += 1;
        sampleBytes += loaded;
        sampleTimeMs += elapsed;
      }
      if (hasMetadata && hasFinishedSampling()) finish();
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (hasMetadata) {
        finish();
      } else {
        fail(new Error(`HLS播放失败: ${data.type}`));
      }
    });
    hls.loadSource(m3u8Url);
    hls.attachMedia(video);
  });
}
