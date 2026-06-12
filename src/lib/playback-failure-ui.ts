export type PlaybackFailureAction = 'switch-source' | 'retry' | 'back';

export type PlaybackFailureReason =
  | 'playback-unavailable'
  | 'source-unrecoverable'
  | 'source-unavailable'
  | 'switch-failed'
  | 'player-init-failed'
  | 'invalid-episode'
  | 'invalid-video-url'
  | 'missing-params'
  | 'no-results'
  | 'no-alternative-source'
  | 'generic';

export interface PlaybackFailureViewModel {
  title: string;
  message: string;
  primaryAction: PlaybackFailureAction;
  secondaryAction: PlaybackFailureAction;
}

const KNOWN_REASON_CODES = new Set<PlaybackFailureReason>([
  'playback-unavailable',
  'source-unrecoverable',
  'source-unavailable',
  'switch-failed',
  'player-init-failed',
  'invalid-episode',
  'invalid-video-url',
  'missing-params',
  'no-results',
  'no-alternative-source',
  'generic',
]);

export function normalizePlaybackFailureReason(raw: string): PlaybackFailureReason {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 'generic';
  }

  if (KNOWN_REASON_CODES.has(trimmed as PlaybackFailureReason)) {
    return trimmed as PlaybackFailureReason;
  }

  const lower = trimmed.toLowerCase();

  if (
    trimmed === '缺少必要参数' ||
    lower.includes('missing required') ||
    lower.includes('missing param')
  ) {
    return 'missing-params';
  }

  if (
    trimmed === '未找到匹配结果' ||
    lower.includes('not found') ||
    lower.includes('no match')
  ) {
    return 'no-results';
  }

  if (
    trimmed === '当前没有其他可用线路' ||
    lower.includes('no alternative') ||
    lower.includes('no available source')
  ) {
    return 'no-alternative-source';
  }

  if (
    trimmed === '播放器初始化失败' ||
    lower.includes('player init') ||
    lower.includes('artplayer')
  ) {
    return 'player-init-failed';
  }

  if (
    trimmed.includes('选集索引无效') ||
    lower.includes('invalid episode')
  ) {
    return 'invalid-episode';
  }

  if (trimmed === '视频地址无效' || lower.includes('invalid video url')) {
    return 'invalid-video-url';
  }

  if (
    trimmed === '换源失败' ||
    lower.includes('switch source') ||
    lower.includes('source change')
  ) {
    return 'switch-failed';
  }

  if (
    trimmed.includes('不可恢复') ||
    lower.includes('unrecoverable') ||
    lower.includes('destroy')
  ) {
    return 'source-unrecoverable';
  }

  if (
    trimmed.includes('不可用') ||
    lower.includes('unavailable') ||
    /\b403\b/.test(trimmed) ||
    /\b404\b/.test(trimmed) ||
    lower.includes('aborted') ||
    lower.includes('fragloaderror') ||
    lower.includes('networkerror') ||
    lower.includes('manifestloaderror') ||
    lower.includes('status=')
  ) {
    return 'source-unavailable';
  }

  if (
    lower.includes('hls') ||
    lower.includes('playback') ||
    lower.includes('播放失败') ||
    lower.includes('播放源') ||
    lower.includes('timeout') ||
    lower.includes('stall')
  ) {
    return 'playback-unavailable';
  }

  return 'generic';
}

export function getPlaybackFailureViewModel({
  hasAlternativeSource,
  hasSearchTitle,
  reason = 'generic',
}: {
  error: string;
  hasAlternativeSource: boolean;
  hasSearchTitle: boolean;
  reason?: PlaybackFailureReason;
}): PlaybackFailureViewModel {
  if (hasAlternativeSource) {
    return {
      title: '当前线路播放失败',
      message: '可以先切换到其他可用线路，或稍后重新尝试当前线路。',
      primaryAction: 'switch-source',
      secondaryAction: 'retry',
    };
  }

  if (reason === 'missing-params' || reason === 'no-results') {
    return {
      title: '暂时找不到可播放内容',
      message: hasSearchTitle
        ? '没有找到匹配的播放源，可以返回搜索页换个关键词试试。'
        : '没有找到匹配的播放源，请检查链接或稍后重试。',
      primaryAction: 'retry',
      secondaryAction: 'back',
    };
  }

  return {
    title: '视频暂时无法播放',
    message: hasSearchTitle
      ? '当前影片暂时没有可用线路，可以返回搜索页尝试其他结果。'
      : '当前影片暂时没有可用线路，请稍后重试。',
    primaryAction: 'retry',
    secondaryAction: 'back',
  };
}

export function shouldShowPlaybackStallActions({
  isVideoLoading,
  loadingStartedAt,
  now,
  thresholdMs = 10_000,
}: {
  isVideoLoading: boolean;
  loadingStartedAt: number | null;
  now: number;
  thresholdMs?: number;
}): boolean {
  if (!isVideoLoading || !loadingStartedAt) {
    return false;
  }

  return now - loadingStartedAt >= thresholdMs;
}

export function shouldAutoSwitchOnLoadingStall({
  hasAlternativeSource,
  autoSwitchAttempted,
}: {
  hasAlternativeSource: boolean;
  autoSwitchAttempted: boolean;
}): boolean {
  return hasAlternativeSource && !autoSwitchAttempted;
}

export const PLAYBACK_USER_SEEK_GRACE_MS = 15_000;

export function shouldSuppressPlaybackStallEscalation({
  isUserPaused,
  isUserSeeking,
  lastUserSeekAt,
  now,
  seekGraceMs = PLAYBACK_USER_SEEK_GRACE_MS,
}: {
  isUserPaused: boolean;
  isUserSeeking: boolean;
  lastUserSeekAt: number | null;
  now: number;
  seekGraceMs?: number;
}): boolean {
  if (isUserPaused || isUserSeeking) {
    return true;
  }

  if (lastUserSeekAt && now - lastUserSeekAt < seekGraceMs) {
    return true;
  }

  return false;
}

export function getEffectivePlaybackLoadingElapsedMs({
  loadingStartedAt,
  now,
  excludedMs,
}: {
  loadingStartedAt: number;
  now: number;
  excludedMs: number;
}): number {
  return Math.max(0, now - loadingStartedAt - excludedMs);
}

export function shouldEscalatePlaybackLoadingStall({
  loadingStartedAt,
  now,
  thresholdMs = 10_000,
  excludedMs,
  isUserPaused,
  isUserSeeking,
  lastUserSeekAt,
}: {
  loadingStartedAt: number;
  now: number;
  thresholdMs?: number;
  excludedMs: number;
  isUserPaused: boolean;
  isUserSeeking: boolean;
  lastUserSeekAt: number | null;
}): boolean {
  if (
    shouldSuppressPlaybackStallEscalation({
      isUserPaused,
      isUserSeeking,
      lastUserSeekAt,
      now,
    })
  ) {
    return false;
  }

  return (
    getEffectivePlaybackLoadingElapsedMs({
      loadingStartedAt,
      now,
      excludedMs,
    }) >= thresholdMs
  );
}
