/* eslint-disable @typescript-eslint/no-explicit-any */

export type CastProvider = 'airplay' | 'google-cast' | 'remote-playback';
export type CastStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'unsupported'
  | 'failed'
  | 'cancelled';

export interface CastMediaCandidate {
  directUrl?: string;
  playbackUrl?: string;
  proxyUrl?: string | null;
}

export interface CastMediaInfo extends CastMediaCandidate {
  title: string;
  subtitle?: string;
  poster?: string;
}

export interface CastMediaUrlResult {
  url: string | null;
  reason?: string;
  source?: 'direct' | 'proxy' | 'playback';
}

export interface CastPlaybackResult {
  provider?: CastProvider;
  status: CastStatus;
  message: string;
}

interface CastPlaybackOptions {
  video: HTMLVideoElement | null | undefined;
  media: CastMediaInfo;
  onNotice?: (message: string) => void;
}

export const castControlIcon =
  '<i class="art-icon flex" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M2 8.5V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><path d="M2 16a6 6 0 0 1 6 6"/><path d="M2 20a2 2 0 0 1 2 2"/></svg></i>';

declare global {
  interface HTMLVideoElement {
    webkitShowPlaybackTargetPicker?: () => void;
  }
}

let castFrameworkPromise: Promise<boolean> | null = null;

function normalizeCandidateUrl(url: string | undefined | null): URL | null {
  if (!url) return null;

  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

export function isCastableMediaUrl(url: string | undefined | null): boolean {
  const parsed = normalizeCandidateUrl(url);
  if (!parsed) return false;

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  return !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname);
}

export function resolveCastMediaUrl(
  media: CastMediaCandidate
): CastMediaUrlResult {
  const candidates: Array<{
    source: CastMediaUrlResult['source'];
    url?: string | null;
  }> = [
    { source: 'direct', url: media.directUrl },
    { source: 'proxy', url: media.proxyUrl },
    { source: 'playback', url: media.playbackUrl },
  ];

  const selected = candidates.find((candidate) =>
    isCastableMediaUrl(candidate.url)
  );

  if (!selected?.url) {
    return {
      url: null,
      reason: '没有可供电视访问的播放地址',
    };
  }

  return {
    url: selected.url,
    source: selected.source,
  };
}

function getCastContentType(url: string): string {
  const pathname = normalizeCandidateUrl(url)?.pathname.toLowerCase() || '';
  if (pathname.endsWith('.m3u8')) return 'application/x-mpegURL';
  if (pathname.endsWith('.mp4')) return 'video/mp4';
  if (pathname.endsWith('.webm')) return 'video/webm';
  return 'application/x-mpegURL';
}

function notify(
  onNotice: CastPlaybackOptions['onNotice'],
  message: string
): void {
  onNotice?.(message);
}

function getCastWindow(): any {
  return typeof window === 'undefined' ? null : (window as any);
}

function loadGoogleCastFramework(): Promise<boolean> {
  const castWindow = getCastWindow();
  if (!castWindow?.document) return Promise.resolve(false);
  if (!castWindow.chrome && !castWindow.cast?.framework) {
    return Promise.resolve(false);
  }
  if (castWindow.cast?.framework && castWindow.chrome?.cast?.media) {
    return Promise.resolve(true);
  }
  if (castFrameworkPromise) return castFrameworkPromise;

  castFrameworkPromise = new Promise<boolean>((resolve) => {
    const existingScript = castWindow.document.querySelector(
      'script[data-katelyatv-google-cast="true"]'
    );
    let settled = false;
    const timeout = castWindow.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, 3500);

    castWindow.__onGCastApiAvailable = (available: boolean) => {
      if (settled) return;
      settled = true;
      castWindow.clearTimeout(timeout);
      resolve(Boolean(available && castWindow.cast?.framework));
    };

    if (existingScript) return;

    const script = castWindow.document.createElement('script');
    script.src =
      'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    script.async = true;
    script.dataset.katelyatvGoogleCast = 'true';
    script.onerror = () => {
      if (settled) return;
      settled = true;
      castWindow.clearTimeout(timeout);
      resolve(false);
    };
    castWindow.document.head.appendChild(script);
  });

  return castFrameworkPromise;
}

async function requestGoogleCastPlayback(
  media: CastMediaInfo,
  castUrl: string,
  onNotice?: (message: string) => void
): Promise<CastPlaybackResult> {
  const castWindow = getCastWindow();
  const available = await loadGoogleCastFramework();
  if (!available || !castWindow?.cast?.framework || !castWindow?.chrome?.cast) {
    return {
      provider: 'google-cast',
      status: 'unsupported',
      message: '当前浏览器没有可用的 Chromecast 能力',
    };
  }

  const castContext = castWindow.cast.framework.CastContext.getInstance();
  castContext.setOptions({
    receiverApplicationId:
      castWindow.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: castWindow.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });

  try {
    notify(onNotice, '正在连接 Chromecast 设备');
    await castContext.requestSession();

    const session = castContext.getCurrentSession();
    if (!session) {
      return {
        provider: 'google-cast',
        status: 'failed',
        message: 'Chromecast 连接失败',
      };
    }

    const mediaInfo = new castWindow.chrome.cast.media.MediaInfo(
      castUrl,
      getCastContentType(castUrl)
    );
    mediaInfo.metadata =
      new castWindow.chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = media.title;
    mediaInfo.metadata.subtitle = media.subtitle || '';
    if (media.poster) {
      mediaInfo.metadata.images = [
        new castWindow.chrome.cast.Image(media.poster),
      ];
    }

    const request = new castWindow.chrome.cast.media.LoadRequest(mediaInfo);
    await session.loadMedia(request);

    return {
      provider: 'google-cast',
      status: 'connected',
      message: '已开始投屏',
    };
  } catch (err) {
    const errorCode = (err as any)?.code || (err as any)?.description || '';
    const message =
      errorCode === 'cancel' || errorCode === 'CANCEL'
        ? '已取消投屏'
        : 'Chromecast 连接失败，请确认电视和浏览器在同一网络';
    return {
      provider: 'google-cast',
      status:
        errorCode === 'cancel' || errorCode === 'CANCEL'
          ? 'cancelled'
          : 'failed',
      message,
    };
  }
}

async function requestRemotePlayback(
  video: HTMLVideoElement,
  onNotice?: (message: string) => void
): Promise<CastPlaybackResult> {
  const remote = (video as any).remote;
  if (typeof remote?.prompt !== 'function') {
    return {
      provider: 'remote-playback',
      status: 'unsupported',
      message: '当前浏览器不支持网页投屏',
    };
  }

  try {
    notify(onNotice, '正在打开系统投屏面板');
    await remote.prompt();
    return {
      provider: 'remote-playback',
      status: 'connected',
      message: '已打开系统投屏面板',
    };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotFoundError') {
      return {
        provider: 'remote-playback',
        status: 'failed',
        message: '没有找到可用的投屏设备',
      };
    }
    if (name === 'NotAllowedError') {
      return {
        provider: 'remote-playback',
        status: 'failed',
        message: '浏览器阻止了投屏，请重新点击投屏按钮',
      };
    }
    if (name === 'AbortError') {
      return {
        provider: 'remote-playback',
        status: 'cancelled',
        message: '已取消投屏',
      };
    }
    return {
      provider: 'remote-playback',
      status: 'failed',
      message: '投屏启动失败，请检查浏览器和设备支持',
    };
  }
}

export async function requestCastPlayback({
  video,
  media,
  onNotice,
}: CastPlaybackOptions): Promise<CastPlaybackResult> {
  if (!video) {
    return {
      status: 'failed',
      message: '播放器还没有准备好',
    };
  }

  video.disableRemotePlayback = false;
  video.removeAttribute('disableRemotePlayback');

  if (typeof video.webkitShowPlaybackTargetPicker === 'function') {
    video.webkitShowPlaybackTargetPicker();
    return {
      provider: 'airplay',
      status: 'connected',
      message: '请选择可用的 AirPlay 设备',
    };
  }

  const resolvedUrl = resolveCastMediaUrl(media);
  if (!resolvedUrl.url) {
    return {
      status: 'unsupported',
      message: resolvedUrl.reason || '没有可投屏的播放地址',
    };
  }

  const googleCastResult = await requestGoogleCastPlayback(
    media,
    resolvedUrl.url,
    onNotice
  );
  if (googleCastResult.status !== 'unsupported') {
    return googleCastResult;
  }

  return requestRemotePlayback(video, onNotice);
}
