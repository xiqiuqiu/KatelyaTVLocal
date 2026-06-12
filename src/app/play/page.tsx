/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { Heart } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import type { CastStatus } from '@/lib/cast';
import {
  castControlIcon,
  requestCastPlayback,
  resolveCastMediaUrl,
} from '@/lib/cast';
import {
  deleteFavorite,
  generateStorageKey,
  getAllPlayRecords,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import type { M3U8AdFilterDebugInfo } from '@/lib/hls-ad-filter';
import {
  analyzeM3U8AdCandidates,
  applyM3U8AdFiltering,
  formatM3U8AdFilterDebugMessage,
  getM3U8AdFilterDebugInfo,
  observeM3U8AdSignals,
} from '@/lib/hls-ad-filter';
import type { HlsAdSkipWindow } from '@/lib/hls-ad-skip';
import {
  getHlsAdSkipDecision,
  toHlsAdSkipWindows,
} from '@/lib/hls-ad-skip';
import type { HlsPlaybackPolicyResult } from '@/lib/hls-playback-policy';
import {
  detectAppleNativeHlsEnvironment,
  resolveHlsPlaybackPolicy,
} from '@/lib/hls-playback-policy';
import { getHlsRecoveryPlan } from '@/lib/hls-recovery';
import { stopVideoElementLoading } from '@/lib/media-cleanup';
import {
  type NativeJitterEvent,
  type NativeJitterEventType,
  getNativeJitterDecision,
  getNativePlaybackNudgeTime,
  getNativeRecoveryAction,
  getNativeStallSeverity,
  NATIVE_FALSE_PLAYING_CHECK_DELAY_MS,
  NATIVE_JITTER_WINDOW_MS,
  NATIVE_PLAY_RESUME_GRACE_MS,
  NATIVE_WATCHDOG_INTERVAL_MS,
  shouldIgnoreNativeStall,
  shouldResetNativeRecoveryOnPause,
} from '@/lib/native-video-recovery';
import {
  type PlayRecordSaveReason,
  type PlayRecordSaveSnapshot,
  getPlayRecordHeartbeatIntervalMs,
  shouldSavePlayRecord,
} from '@/lib/play-record-save-policy';
import {
  clampSourceSwitchResumeTime,
  getAutoRecoveryResumeTime,
  getNextRecoverySourceCandidate,
  getSourceSwitchResumePlan,
  getSourceSwitchTargetEpisodeIndex,
} from '@/lib/playback-source-switch';
import { fetchSourcePreferencesInBatches } from '@/lib/source-preference-client';
import {
  buildSourceSelectionScores,
  sortSourcesBySelectionScore,
  SourceSelectionScore,
} from '@/lib/source-selection';
import {
  PlaybackFeedbackInput,
  SearchResult,
  SourcePlaybackMode,
  SourcePreferenceResult,
  SourceStatus,
  SourceVideoInfo,
} from '@/lib/types';
import {
  buildHlsProxyUrl,
  createSourceStatus,
  getRememberedSourceStatus,
  getSourceIdentityKey,
  getVideoResolutionFromM3u8,
  processImageUrl,
  rememberSourceDomainPreference,
} from '@/lib/utils';

import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';
import InitialLoadingOverlay from '@/components/player/InitialLoadingOverlay';
import PlayerHeader from '@/components/player/PlayerHeader';
import PlayerLoadingOverlay from '@/components/player/PlayerLoadingOverlay';
import PlayerSidebar from '@/components/player/PlayerSidebar';
import SkipController from '@/components/SkipController';
import Surface from '@/components/ui/Surface';

export const runtime = 'edge';

const SOURCE_PREFERENCE_FAST_BUDGET_MS = 500;
const SOURCE_SELECTION_TOTAL_BUDGET_MS = 2500;
const SOURCE_SELECTION_DEEP_PROBE_TIMEOUT_MS = 1800;
const NATIVE_RECENT_BUFFER_ISSUE_WINDOW_MS = 30000;
const SOURCE_SELECTION_DEEP_PROBE_LIMIT = 3;

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
    recoveryWaitingListener?: EventListener;
    recoveryPlayingListener?: EventListener;
    recoveryErrorListener?: EventListener;
    recoveryTimeupdateListener?: EventListener;
    recoverySeekingListener?: EventListener;
  }
}

const directAdFilterDebugLogKeys = new Set<string>();

interface PlaybackDebugEvent {
  eventType: string;
  message: string;
  createdAt: number;
  currentTime?: number | null;
  details?: Record<string, unknown>;
}

interface PlaybackDebugLogPayload {
  sessionId: string;
  eventType: string;
  sourceKey?: string | null;
  playbackUrl?: string | null;
  title?: string | null;
  runtime?: string | null;
  playlistFilter?: string | null;
  segmentMode?: string | null;
  recoveryProfile?: string | null;
  currentTime?: number | null;
  duration?: number | null;
  readyState?: number | null;
  networkState?: number | null;
  paused?: boolean | null;
  ended?: boolean | null;
  details?: Record<string, unknown>;
  userAgent?: string | null;
}

interface PlaybackDebugEmitOptions {
  playbackUrl?: string | null;
  policy?: HlsPlaybackPolicyResult | null;
}

interface PlaybackDebugCanplaySnapshot {
  playbackUrl: string | null;
  currentTime: number | null;
  readyState: number | null;
  networkState: number | null;
  paused: boolean | null;
  ended: boolean | null;
  emittedAt: number;
}

interface IosAdObservationResponse {
  observeOnly?: boolean;
  removed?: boolean;
  targetUrl?: string;
  removedLineCount?: number;
  candidates?: Parameters<typeof toHlsAdSkipWindows>[0];
  summary?: {
    candidateAdBlocks?: number;
    cueOutCount?: number;
    cueInCount?: number;
    scte35Count?: number;
    daterangeCount?: number;
    cueMarkerBlocks?: number;
    scte35Blocks?: number;
    daterangeBlocks?: number;
    keywordBlocks?: number;
    alternateHostBlocks?: number;
    primaryHost?: string | null;
    removedBlocks?: unknown[];
  };
}

interface SourceChangeOptions {
  autoRecovery?: boolean;
  resumeTime?: number | null;
  reason?: string;
  autoPlayAfterReady?: boolean;
}

function createPlaybackDebugSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `playback-debug-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function formatDebugPlaybackTime(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--:--';
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function logDirectAdObserveDebug(
  playlistUrl: string | undefined,
  originalContent: string,
  playlistType: string | undefined
): M3U8AdFilterDebugInfo | null {
  const debugInfo = observeM3U8AdSignals(originalContent, playlistUrl);

  if (!debugInfo.shouldLog) {
    return null;
  }

  const logKey = JSON.stringify({
    playlistUrl: playlistUrl || '',
    playlistType: playlistType || '',
    removedLineCount: debugInfo.removedLineCount,
    candidateAdBlocks: debugInfo.summary.candidateAdBlocks,
    cueOutCount: debugInfo.summary.cueOutCount,
    cueInCount: debugInfo.summary.cueInCount,
    scte35Count: debugInfo.summary.scte35Count,
    daterangeCount: debugInfo.summary.daterangeCount,
    removedBlocks: debugInfo.summary.removedBlocks.length,
  });

  if (directAdFilterDebugLogKeys.has(logKey)) {
    return null;
  }

  directAdFilterDebugLogKeys.add(logKey);

  const message = `[去广告][直连观测] ${formatM3U8AdFilterDebugMessage(
    debugInfo
  )}，仅记录，未移除分片`;

  console.log(message, {
    playlistUrl,
    playlistType,
    wouldRemoveLineCount: debugInfo.removedLineCount,
    removed: false,
    removedBlocks: debugInfo.summary.removedBlocks,
    summary: debugInfo.summary,
  });

  if (debugInfo.summary.removedBlocks.length > 0) {
    console.table(
      debugInfo.summary.removedBlocks.map((block, index) => ({
        序号: index + 1,
        开始秒: block.startTimeSeconds,
        结束秒: block.endTimeSeconds,
        时长秒: block.durationSeconds,
        片段数: block.segmentCount,
        原因: block.reasons.join(', '),
        规则: block.ruleId || '',
        域名: block.hosts.join(', '),
      }))
    );
  }

  return debugInfo;
}

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);

  // 视频基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  // 当前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  // 是否需要优选
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  // 集数相关
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);
  const [playbackMode, setPlaybackMode] =
    useState<SourcePlaybackMode>('direct');

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);
  const playbackModeRef = useRef<SourcePlaybackMode>('direct');
  const originalVideoUrlRef = useRef('');
  const videoUrlRef = useRef('');
  const playbackDebugSessionIdRef = useRef(createPlaybackDebugSessionId());
  const playbackDebugEnabledRef = useRef(false);
  const playbackDebugLastCanplayRef =
    useRef<PlaybackDebugCanplaySnapshot | null>(null);
  const sourceFallbackAttemptedRef = useRef(false);
  const sourceSwitchSavePendingRef = useRef(false);
  const sourceSwitchAutoPlayPendingRef = useRef(false);
  const playbackPolicyLogKeysRef = useRef(new Set<string>());
  const playbackPolicyRef = useRef<HlsPlaybackPolicyResult | null>(null);
  const nativeAdSkipWindowsRef = useRef<HlsAdSkipWindow[]>([]);
  const nativeAdSkipLastWindowKeyRef = useRef<string | null>(null);
  const nativeAdSkipLastUserSeekAtRef = useRef<number | null>(null);
  const [playbackDebugEnabled, setPlaybackDebugEnabled] = useState(false);
  const [playbackDebugCollapsed, setPlaybackDebugCollapsed] = useState(true);
  const [playbackDebugEvents, setPlaybackDebugEvents] = useState<
    PlaybackDebugEvent[]
  >([]);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  useEffect(() => {
    playbackModeRef.current = playbackMode;
  }, [playbackMode]);

  const isVideoLoadingRef = useRef(true);

  useEffect(() => {
    playbackDebugEnabledRef.current = playbackDebugEnabled;
  }, [playbackDebugEnabled]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/playback-debug', {
      cache: 'no-store',
    })
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled) {
          setPlaybackDebugEnabled(Boolean(payload?.enabled));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlaybackDebugEnabled(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const applyPlaybackMode = (mode: SourcePlaybackMode) => {
    playbackModeRef.current = mode;
    setPlaybackMode(mode);
  };

  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');

  useEffect(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);

  // 总集数
  const totalEpisodes = detail?.episodes?.length || 0;

  // 用于记录是否需要在播放器 ready 后跳转到指定进度
  const resumeTimeRef = useRef<number | null>(null);
  // 上次使用的音量，默认 0.7
  const lastVolumeRef = useRef<number>(0.7);

  // 换源相关状态
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // 优选和测速开关
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 保存优选时的测速结果，避免EpisodeSelector重复测速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, SourceVideoInfo>
  >(new Map());
  const [precomputedSourceStatuses, setPrecomputedSourceStatuses] = useState<
    Map<string, SourceStatus>
  >(new Map());
  const [sourceSelectionScores, setSourceSelectionScores] = useState<
    Map<string, SourceSelectionScore>
  >(new Map());
  const availableSourcesRef = useRef<SearchResult[]>([]);
  const precomputedVideoInfoRef = useRef<Map<string, SourceVideoInfo>>(
    new Map()
  );
  const precomputedSourceStatusesRef = useRef<Map<string, SourceStatus>>(
    new Map()
  );
  const sourceSelectionScoresRef = useRef<Map<string, SourceSelectionScore>>(
    new Map()
  );
  const playbackStartupStartedAtRef = useRef<number | null>(null);
  const startupFeedbackSentRef = useRef(false);
  const waitingRecoveryTimerRef = useRef<number | null>(null);
  const nativeWatchdogTimerRef = useRef<number | null>(null);
  const nativeFalsePlayingTimerRef = useRef<number | null>(null);
  const autoRecoveredSourceKeysRef = useRef<Set<string>>(new Set());
  const hlsRecoveryStateRef = useRef({
    stallCount: 0,
    networkRecoveryAttempts: 0,
    mediaRecoveryAttempts: 0,
    lastErrorAt: 0,
    lastPlaybackTime: 0,
  });
  const nativeRecoveryStateRef = useRef({
    stallCount: 0,
    sourceRecoveryAttempts: 0,
    playIntent: 'paused' as 'playing' | 'paused',
    browserAutoplayLocked: false,
    pauseReason: 'initial' as 'initial' | 'user' | 'browser' | 'buffering',
    ignoreStallUntil: 0,
    lastObservedTime: 0,
    lastProgressAt: 0,
    lastBufferIssueAt: 0,
    lastRecoveryObserveLogAt: 0,
    lastJitterLogAt: 0,
    lastJitterWindowAt: 0,
    jitterWindowCount: 0,
    jitterEvents: [] as NativeJitterEvent[],
  });

  // 折叠状态（仅在 lg 及以上屏幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 换源加载状态
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);
  const lastSavedSnapshotRef = useRef<PlayRecordSaveSnapshot | null>(null);

  // 播放器时间状态（用于跳过功能）
  const [currentPlayTime, setCurrentPlayTime] = useState<number>(0);
  const [videoDuration, setVideoDuration] = useState<number>(0);

  // 跳过设置状态
  const [isSkipSettingMode, setIsSkipSettingMode] = useState<boolean>(false);
  const [castStatus, setCastStatus] = useState<CastStatus>('idle');

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    isVideoLoadingRef.current = isVideoLoading;
  }, [isVideoLoading]);

  useEffect(() => {
    availableSourcesRef.current = availableSources;
  }, [availableSources]);

  useEffect(() => {
    precomputedVideoInfoRef.current = precomputedVideoInfo;
  }, [precomputedVideoInfo]);

  useEffect(() => {
    precomputedSourceStatusesRef.current = precomputedSourceStatuses;
  }, [precomputedSourceStatuses]);

  useEffect(() => {
    sourceSelectionScoresRef.current = sourceSelectionScores;
  }, [sourceSelectionScores]);

  useEffect(() => {
    autoRecoveredSourceKeysRef.current.clear();
  }, [currentEpisodeIndex]);

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  const buildVideoInfoFromPreferenceResult = (
    result: Pick<
      SourcePreferenceResult,
      'qualityLabel' | 'speedLabel' | 'pingTimeMs'
    >
  ): SourceVideoInfo | null => {
    const quality = result.qualityLabel || '未知';
    const loadSpeed = result.speedLabel || '未知';
    const pingTime = result.pingTimeMs ?? 0;

    if (quality === '未知' && loadSpeed === '未知' && pingTime <= 0) {
      return null;
    }

    return {
      quality,
      loadSpeed,
      pingTime,
    };
  };

  const getCurrentSourceKey = () =>
    getSourceIdentityKey(currentSourceRef.current, currentIdRef.current);

  const updateSourceSelectionScores = (
    sources: SearchResult[],
    statuses: Map<string, SourceStatus>,
    measured: Map<string, SourceVideoInfo>
  ) => {
    const nextScores = buildSourceSelectionScores({
      sources,
      statuses,
      measured,
      currentEpisodeIndex: currentEpisodeIndexRef.current,
      getSourceKey: (source) => getSourceIdentityKey(source.source, source.id),
    });
    sourceSelectionScoresRef.current = nextScores;
    setSourceSelectionScores(new Map(nextScores));
    return nextScores;
  };

  const getCurrentPlaybackDomain = () => {
    const directUrl = originalVideoUrlRef.current;
    if (!directUrl) {
      return null;
    }

    try {
      return new URL(directUrl).hostname.toLowerCase();
    } catch {
      return null;
    }
  };

  const clearWaitingRecoveryTimer = () => {
    if (
      typeof window !== 'undefined' &&
      waitingRecoveryTimerRef.current !== null
    ) {
      window.clearTimeout(waitingRecoveryTimerRef.current);
      waitingRecoveryTimerRef.current = null;
    }
  };

  const clearNativeWatchdogTimer = () => {
    if (
      typeof window !== 'undefined' &&
      nativeWatchdogTimerRef.current !== null
    ) {
      window.clearInterval(nativeWatchdogTimerRef.current);
      nativeWatchdogTimerRef.current = null;
    }
  };

  const clearNativeFalsePlayingTimer = () => {
    if (
      typeof window !== 'undefined' &&
      nativeFalsePlayingTimerRef.current !== null
    ) {
      window.clearTimeout(nativeFalsePlayingTimerRef.current);
      nativeFalsePlayingTimerRef.current = null;
    }
  };

  const resetHlsRecoveryCounters = () => {
    clearWaitingRecoveryTimer();
    clearNativeWatchdogTimer();
    clearNativeFalsePlayingTimer();
    hlsRecoveryStateRef.current.stallCount = 0;
    hlsRecoveryStateRef.current.networkRecoveryAttempts = 0;
    hlsRecoveryStateRef.current.mediaRecoveryAttempts = 0;
    hlsRecoveryStateRef.current.lastErrorAt = 0;
    hlsRecoveryStateRef.current.lastPlaybackTime = 0;
    nativeRecoveryStateRef.current.stallCount = 0;
    nativeRecoveryStateRef.current.sourceRecoveryAttempts = 0;
    nativeRecoveryStateRef.current.playIntent = 'paused';
    nativeRecoveryStateRef.current.browserAutoplayLocked = false;
    nativeRecoveryStateRef.current.pauseReason = 'initial';
    nativeRecoveryStateRef.current.ignoreStallUntil = 0;
    nativeRecoveryStateRef.current.lastObservedTime = 0;
    nativeRecoveryStateRef.current.lastProgressAt = 0;
    nativeRecoveryStateRef.current.lastBufferIssueAt = 0;
    nativeRecoveryStateRef.current.lastRecoveryObserveLogAt = 0;
    nativeRecoveryStateRef.current.lastJitterLogAt = 0;
    nativeRecoveryStateRef.current.lastJitterWindowAt = 0;
    nativeRecoveryStateRef.current.jitterWindowCount = 0;
    nativeRecoveryStateRef.current.jitterEvents = [];
  };

  const markPlaybackHealthy = (currentTime?: number) => {
    if (typeof currentTime === 'number') {
      const lastPlaybackTime = hlsRecoveryStateRef.current.lastPlaybackTime;
      if (currentTime > lastPlaybackTime + 0.25) {
        clearWaitingRecoveryTimer();
        hlsRecoveryStateRef.current.stallCount = 0;
        nativeRecoveryStateRef.current.stallCount = 0;
        nativeRecoveryStateRef.current.sourceRecoveryAttempts = 0;
        nativeRecoveryStateRef.current.lastProgressAt = Date.now();
      }
      hlsRecoveryStateRef.current.lastPlaybackTime = currentTime;
      nativeRecoveryStateRef.current.lastObservedTime = currentTime;
      return;
    }

    clearWaitingRecoveryTimer();
    hlsRecoveryStateRef.current.stallCount = 0;
    nativeRecoveryStateRef.current.stallCount = 0;
    nativeRecoveryStateRef.current.sourceRecoveryAttempts = 0;
  };

  const getNextRecoverySource = () => {
    return getNextRecoverySourceCandidate({
      candidates: availableSourcesRef.current,
      currentSourceKey: getCurrentSourceKey(),
      recoveredSourceKeys: autoRecoveredSourceKeysRef.current,
      currentEpisodeIndex: currentEpisodeIndexRef.current,
      getSourceKey: (source) => getSourceIdentityKey(source.source, source.id),
      getEpisodeCount: (source) => source.episodes?.length || 0,
      getStatusKind: (source) => {
        if (!source.episodes) {
          return 'unavailable';
        }
        const sourceKey = getSourceIdentityKey(source.source, source.id);
        const status =
          precomputedSourceStatusesRef.current.get(sourceKey) ||
          getRememberedSourceStatus(source.episodes);
        return status?.kind;
      },
      getCandidateScore: (source) =>
        sourceSelectionScoresRef.current.get(
          getSourceIdentityKey(source.source, source.id)
        )?.score,
    });
  };

  const tryNudgePlayback = (video: HTMLVideoElement | null) => {
    if (!video) {
      return false;
    }

    const buffered = video.buffered;
    const currentTime = video.currentTime || 0;
    const bufferedRanges = Array.from({ length: buffered.length }, (_, index) => ({
      start: buffered.start(index),
      end: buffered.end(index),
    }));

    const nudgedTime = getNativePlaybackNudgeTime({
      currentTime,
      bufferedRanges,
    });
    if (nudgedTime !== null) {
      video.currentTime = nudgedTime;
      return true;
    }

    void video.play().catch(() => undefined);
    return false;
  };

  const isNativeMediaSourceUnavailable = (video: HTMLVideoElement) =>
    video.readyState === 0 && video.networkState === 3;

  const reportPlaybackFeedback = async (input: PlaybackFeedbackInput) => {
    try {
      await fetch('/api/source-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
    } catch (error) {
      console.warn('播放反馈上报失败', error);
    }
  };

  const getPlaybackDebugVideoSnapshot = () => {
    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    return {
      currentTime:
        typeof video?.currentTime === 'number'
          ? Number(video.currentTime.toFixed(2))
          : null,
      duration:
        typeof video?.duration === 'number' && Number.isFinite(video.duration)
          ? Number(video.duration.toFixed(2))
          : null,
      readyState: video?.readyState ?? null,
      networkState: video?.networkState ?? null,
      paused: video?.paused ?? null,
      ended: video?.ended ?? null,
    };
  };

  const sendPlaybackDebugLog = (payload: PlaybackDebugLogPayload) => {
    const body = JSON.stringify(payload);
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon('/api/playback-debug', blob)) {
          return;
        }
      } catch {
        /* fall back to fetch */
      }
    }

    void fetch('/api/playback-debug', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
      keepalive: true,
    }).catch(() => undefined);
  };

  const shouldSkipCanplayDebugLog = (
    playbackUrl: string | null,
    videoSnapshot: ReturnType<typeof getPlaybackDebugVideoSnapshot>
  ) => {
    const last = playbackDebugLastCanplayRef.current;
    const now = Date.now();

    if (!last) {
      playbackDebugLastCanplayRef.current = {
        playbackUrl,
        currentTime: videoSnapshot.currentTime,
        readyState: videoSnapshot.readyState,
        networkState: videoSnapshot.networkState,
        paused: videoSnapshot.paused,
        ended: videoSnapshot.ended,
        emittedAt: now,
      };
      return false;
    }

    const sameUrl = last.playbackUrl === playbackUrl;
    const timeDelta =
      typeof last.currentTime === 'number' &&
      typeof videoSnapshot.currentTime === 'number'
        ? Math.abs(last.currentTime - videoSnapshot.currentTime)
        : 0;
    const samePlaybackWindow = timeDelta < 1;
    const sameState =
      last.readyState === videoSnapshot.readyState &&
      last.networkState === videoSnapshot.networkState &&
      last.paused === videoSnapshot.paused &&
      last.ended === videoSnapshot.ended;
    const withinDebounceWindow = now - last.emittedAt < 2000;
    const shouldSkip =
      sameUrl && samePlaybackWindow && sameState && withinDebounceWindow;

    if (!shouldSkip) {
      playbackDebugLastCanplayRef.current = {
        playbackUrl,
        currentTime: videoSnapshot.currentTime,
        readyState: videoSnapshot.readyState,
        networkState: videoSnapshot.networkState,
        paused: videoSnapshot.paused,
        ended: videoSnapshot.ended,
        emittedAt: now,
      };
    }

    return shouldSkip;
  };

  const emitPlaybackDebugLog = (
    eventType: string,
    message: string,
    details: Record<string, unknown> = {},
    options: PlaybackDebugEmitOptions = {}
  ) => {
    if (!playbackDebugEnabledRef.current) {
      return;
    }

    const videoSnapshot = getPlaybackDebugVideoSnapshot();
    const policy = options.policy ?? playbackPolicyRef.current;
    const detailPlaybackUrl =
      typeof details.playbackUrl === 'string' ? details.playbackUrl : null;
    const effectivePlaybackUrl =
      options.playbackUrl ?? detailPlaybackUrl ?? videoUrlRef.current ?? null;

    if (
      eventType === 'video-canplay' &&
      shouldSkipCanplayDebugLog(effectivePlaybackUrl, videoSnapshot)
    ) {
      return;
    }

    const event: PlaybackDebugEvent = {
      eventType,
      message,
      createdAt: Date.now(),
      currentTime: videoSnapshot.currentTime,
      details,
    };

    setPlaybackDebugEvents((prev) => [event, ...prev].slice(0, 20));

    const payload: PlaybackDebugLogPayload = {
      sessionId: playbackDebugSessionIdRef.current,
      eventType,
      sourceKey: getCurrentSourceKey() || null,
      playbackUrl: effectivePlaybackUrl,
      title: videoTitleRef.current || null,
      runtime: policy?.runtime || null,
      playlistFilter: policy?.playlistFilter || null,
      segmentMode: policy?.segmentMode || null,
      recoveryProfile: policy?.recoveryProfile || null,
      ...videoSnapshot,
      details: {
        message,
        ...details,
      },
      userAgent:
        typeof navigator !== 'undefined' ? navigator.userAgent : null,
    };

    console.info(`[播放调试] ${message}`, payload);
    sendPlaybackDebugLog(payload);
  };

  const emitNativeVideoStateDebugLog = (
    eventType: string,
    message: string,
    details: Record<string, unknown> = {}
  ) => {
    if (playbackPolicyRef.current?.recoveryProfile !== 'native-video') {
      return;
    }

    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    const state = nativeRecoveryStateRef.current;
    emitPlaybackDebugLog(
      eventType,
      message,
      {
        ...details,
        playIntent: state.playIntent,
        pauseReason: state.pauseReason,
        browserAutoplayLocked: state.browserAutoplayLocked,
        ignoreStallUntil: state.ignoreStallUntil,
        isVideoLoading: isVideoLoadingRef.current,
        currentSrc: video?.currentSrc || null,
        currentTime:
          typeof video?.currentTime === 'number'
            ? Number(video.currentTime.toFixed(2))
            : null,
        duration:
          typeof video?.duration === 'number' && Number.isFinite(video.duration)
            ? Number(video.duration.toFixed(2))
            : null,
        readyState: video?.readyState ?? null,
        networkState: video?.networkState ?? null,
        paused: video?.paused ?? null,
        ended: video?.ended ?? null,
      },
      {
        playbackUrl: video?.currentSrc || videoUrlRef.current,
      }
    );
  };

  // 播放源优选函数
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) {
      setPrecomputedSourceStatuses(new Map());
      setPrecomputedVideoInfo(new Map());
      updateSourceSelectionScores(sources, new Map(), new Map());
      return sources[0];
    }

    const startedAt = Date.now();
    const sourceEntries = sources.map((source, originalIndex) => ({
      source,
      originalIndex,
      sourceKey: getSourceIdentityKey(source.source, source.id),
      rememberedStatus: getRememberedSourceStatus(source.episodes),
    }));
    const statusMap = new Map<string, SourceStatus>();
    const videoInfoMap = new Map<string, SourceVideoInfo>();

    sourceEntries.forEach(({ source, sourceKey, rememberedStatus }) => {
      if (!source.episodes || source.episodes.length === 0) {
        statusMap.set(
          sourceKey,
          createSourceStatus('unavailable', {
            reason: '该播放源没有可用剧集',
          })
        );
        return;
      }

      if (rememberedStatus) {
        statusMap.set(sourceKey, rememberedStatus);
      }
    });

    const commitSelectionState = () => {
      setPrecomputedSourceStatuses(new Map(statusMap));
      setPrecomputedVideoInfo(new Map(videoInfoMap));
      return updateSourceSelectionScores(sources, statusMap, videoInfoMap);
    };

    const applyPreferenceResults = (preferenceData: Awaited<
      ReturnType<typeof fetchSourcePreferencesInBatches>
    >) => {
      preferenceData.results.forEach((result) => {
        const measured = buildVideoInfoFromPreferenceResult(result);
        const nextStatus = createSourceStatus(result.kind, {
          reason: result.reason,
          playbackMode: result.kind === 'unavailable' ? undefined : result.kind,
          domain: result.domain || null,
          measured: measured || undefined,
          updatedAt: result.updatedAt,
          rankingSource: result.rankingSource,
          rankScore: result.rankScore,
        });

        statusMap.set(result.sourceKey, nextStatus);
        if (measured) {
          videoInfoMap.set(result.sourceKey, measured);
        }
        rememberSourceDomainPreference(
          result.domain || null,
          result.kind,
          result.reason
        );
      });

      commitSelectionState();
    };

    const requestSources = sourceEntries.map(({ source, sourceKey }) => {
      const episodeIndex = Math.max(
        0,
        Math.min(
          currentEpisodeIndexRef.current,
          Math.max(0, (source.episodes?.length || 1) - 1)
        )
      );
      return {
        sourceKey,
        episodeUrl: source.episodes?.[episodeIndex] || null,
      };
    });

    const preferencePromise = fetchSourcePreferencesInBatches(requestSources, {
      allowLiveProbeFallback: false,
    });
    let preferenceSettled = false;
    try {
      const preferenceData = await Promise.race([
        preferencePromise.then((data) => {
          preferenceSettled = true;
          return data;
        }),
        new Promise<null>((resolve) =>
          window.setTimeout(resolve, SOURCE_PREFERENCE_FAST_BUDGET_MS, null)
        ),
      ]);

      if (preferenceData) {
        applyPreferenceResults(preferenceData);
      }
    } catch (error) {
      preferenceSettled = true;
      console.warn('快速线路优选读取失败，继续使用本地状态', error);
    }

    if (!preferenceSettled) {
      void preferencePromise
        .then(applyPreferenceResults)
        .catch((error) => {
          console.warn('后台线路优选读取失败', error);
        });
    }

    let selectionScores = commitSelectionState();
    const orderedSources = sortSourcesBySelectionScore(sources, selectionScores, (source) =>
      getSourceIdentityKey(source.source, source.id)
    );
    const deepProbeCandidates = orderedSources
      .filter((source) => {
        const sourceKey = getSourceIdentityKey(source.source, source.id);
        const status = statusMap.get(sourceKey);
        return (
          source.episodes?.length &&
          (!status || status.kind === 'direct' || status.kind === 'idle')
        );
      })
      .slice(0, SOURCE_SELECTION_DEEP_PROBE_LIMIT);

    const remainingBudget = Math.max(
      0,
      SOURCE_SELECTION_TOTAL_BUDGET_MS - (Date.now() - startedAt)
    );

    const deepProbePromises = deepProbeCandidates.map(async (source) => {
      const sourceKey = getSourceIdentityKey(source.source, source.id);
      const episodeIndex = Math.max(
        0,
        Math.min(currentEpisodeIndexRef.current, source.episodes.length - 1)
      );
      const episodeUrl = source.episodes[episodeIndex];

      try {
        const testResult = await getVideoResolutionFromM3u8(episodeUrl, {
          timeoutMs: SOURCE_SELECTION_DEEP_PROBE_TIMEOUT_MS,
        });
        videoInfoMap.set(sourceKey, testResult);
        const previousStatus = statusMap.get(sourceKey);
        statusMap.set(
          sourceKey,
          createSourceStatus('direct', {
            reason: previousStatus?.reason || '浏览器可直接播放',
            playbackMode: 'direct',
            domain: previousStatus?.domain || null,
            measured: testResult,
            updatedAt: previousStatus?.updatedAt,
            rankingSource: previousStatus?.rankingSource,
            rankScore: previousStatus?.rankScore,
          })
        );
        rememberSourceDomainPreference(previousStatus?.domain || null, 'direct');
      } catch (error) {
        videoInfoMap.set(sourceKey, {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
          errorReason:
            error instanceof Error ? error.message : '初始化测速失败，可尝试播放',
        });
      } finally {
        selectionScores = commitSelectionState();
      }
    });

    if (deepProbePromises.length > 0 && remainingBudget > 0) {
      await Promise.race([
        Promise.allSettled(deepProbePromises),
        new Promise<void>((resolve) =>
          window.setTimeout(resolve, remainingBudget)
        ),
      ]);
    }

    void Promise.allSettled(deepProbePromises).then(() => {
      commitSelectionState();
    });

    selectionScores = sourceSelectionScoresRef.current.size
      ? sourceSelectionScoresRef.current
      : selectionScores;
    const finalSource = sortSourcesBySelectionScore(
      sources,
      selectionScores,
      (source) => getSourceIdentityKey(source.source, source.id)
    ).find((source) => {
      const status = statusMap.get(getSourceIdentityKey(source.source, source.id));
      return status?.kind !== 'unavailable';
    });

    console.log('播放源优选结果:', {
      selected: finalSource?.source_name,
      waitedMs: Date.now() - startedAt,
      deepProbeCount: deepProbeCandidates.length,
    });

    return finalSource || sources[0];
  };

  // 更新视频地址
  const updateVideoUrl = (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const directUrl = detailData?.episodes[episodeIndex] || '';
    originalVideoUrlRef.current = directUrl;
    sourceFallbackAttemptedRef.current = false;
    nativeAdSkipWindowsRef.current = [];
    nativeAdSkipLastWindowKeyRef.current = null;
    nativeAdSkipLastUserSeekAtRef.current = null;

    const rememberedStatus = detailData
      ? getRememberedSourceStatus(detailData.episodes)
      : null;
    const proxyUrl = buildHlsProxyUrl(directUrl);
    const adFilteringProxyUrl = buildHlsProxyUrl(directUrl, {
      mediaSegmentMode: 'direct',
    });
    const observationUrl = buildHlsProxyUrl(directUrl, {
      filterAds: false,
    });
    const rememberedPlaybackMode =
      rememberedStatus?.kind === 'proxy'
        ? 'proxy'
        : rememberedStatus?.playbackMode || null;
    const playbackPolicy = resolveHlsPlaybackPolicy({
      directUrl,
      proxyUrl,
      adFilteringProxyUrl,
      rememberedPlaybackMode,
      isAppleNativeHlsEnvironment: isAppleNativeHlsPlaybackEnvironment(),
    });

    playbackPolicyRef.current = playbackPolicy;
    applyPlaybackMode(playbackPolicy.mode);
    logHlsPlaybackPolicy(directUrl, playbackPolicy.url, playbackPolicy);
    observeIosAdSignals(directUrl, observationUrl, playbackPolicy);

    const nextUrl = playbackPolicy.url;

    if (nextUrl !== videoUrlRef.current) {
      startupFeedbackSentRef.current = false;
      playbackStartupStartedAtRef.current = Date.now();
      resetHlsRecoveryCounters();
      videoUrlRef.current = nextUrl;
      setVideoUrl(nextUrl);
    }
  };

  const trySwitchToProxyPlayback = () => {
    const directUrl = originalVideoUrlRef.current;
    const proxyUrl = buildHlsProxyUrl(directUrl);
    const currentPlayTime = artPlayerRef.current?.currentTime || 0;
    const currentPolicy = playbackPolicyRef.current;
    const isAlreadyFullProxy = currentPolicy
      ? currentPolicy.segmentMode === 'proxy'
      : playbackModeRef.current === 'proxy';

    if (
      isAlreadyFullProxy ||
      sourceFallbackAttemptedRef.current ||
      !directUrl ||
      !proxyUrl
    ) {
      return false;
    }

    const resumePlan = getSourceSwitchResumePlan({
      currentEpisodeIndex: currentEpisodeIndexRef.current,
      targetEpisodeIndex: currentEpisodeIndexRef.current,
      currentPlayTime,
      existingResumeTime: resumeTimeRef.current,
    });
    resumeTimeRef.current = resumePlan.resumeTime;
    sourceSwitchSavePendingRef.current = resumePlan.saveAfterCanPlay;

    sourceFallbackAttemptedRef.current = true;
    startupFeedbackSentRef.current = false;
    playbackStartupStartedAtRef.current = Date.now();
    playbackPolicyRef.current = currentPolicy
      ? {
          ...currentPolicy,
          mode: 'proxy',
          url: proxyUrl,
          playlistFilter: 'proxy-filter',
          segmentMode: 'proxy',
          forcedProxyForAdFiltering: false,
          reason: 'remembered-proxy',
        }
      : null;
    resetHlsRecoveryCounters();
    applyPlaybackMode('proxy');
    setVideoLoadingStage('sourceChanging');
    setIsVideoLoading(true);
    setError(null);
    emitPlaybackDebugLog(
      'switch-full-proxy',
      '已升级到完整代理播放',
      {
        fromUrl: videoUrlRef.current,
        toUrl: proxyUrl,
        resumeTime: resumePlan.resumeTime,
      },
      {
        playbackUrl: proxyUrl,
        policy: playbackPolicyRef.current,
      }
    );
    videoUrlRef.current = proxyUrl;
    setVideoUrl(proxyUrl);
    return true;
  };

  const trySwitchToNextAvailableSource = (reason: string) => {
    const nextSource = getNextRecoverySource();
    if (!nextSource) {
      emitPlaybackDebugLog('switch-source-unavailable', '无可用候选播放源', {
        reason,
        sourceKey: getCurrentSourceKey(),
        currentEpisodeIndex: currentEpisodeIndexRef.current,
      });
      return false;
    }

    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    const currentPlayTime =
      typeof video?.currentTime === 'number'
        ? video.currentTime
        : artPlayerRef.current?.currentTime || 0;
    const recoveryResumeTime = getAutoRecoveryResumeTime(currentPlayTime);
    if (recoveryResumeTime) {
      resumeTimeRef.current = recoveryResumeTime;
      sourceSwitchSavePendingRef.current = true;
    }

    const currentSourceKey = getCurrentSourceKey();
    if (currentSourceKey) {
      autoRecoveredSourceKeysRef.current.add(currentSourceKey);
    }
    autoRecoveredSourceKeysRef.current.add(
      getSourceIdentityKey(nextSource.source, nextSource.id)
    );

    console.warn(`${reason}，自动切换到播放源: ${nextSource.source_name}`);
    emitPlaybackDebugLog('switch-source', '已自动切换到其他播放源', {
      reason,
      nextSource: nextSource.source,
      nextId: nextSource.id,
      nextTitle: nextSource.title,
      currentEpisodeIndex: currentEpisodeIndexRef.current,
      resumeTime: recoveryResumeTime,
    });
    resetHlsRecoveryCounters();
    void handleSourceChange(nextSource.source, nextSource.id, nextSource.title, {
      autoRecovery: true,
      resumeTime: recoveryResumeTime,
      reason,
      autoPlayAfterReady: true,
    });
    return true;
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除旧的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始终允许远程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾经有禁用属性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  const isAppleNativeHlsPlaybackEnvironment = () =>
    detectAppleNativeHlsEnvironment({
      userAgent:
        typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      platform:
        typeof navigator !== 'undefined' ? navigator.platform : undefined,
      userAgentDataPlatform:
        typeof navigator !== 'undefined'
          ? (navigator as Navigator & {
              userAgentData?: { platform?: string };
            }).userAgentData?.platform
          : undefined,
      maxTouchPoints:
        typeof navigator !== 'undefined'
          ? navigator.maxTouchPoints
          : undefined,
      hasWebKitPointConversion:
        typeof window !== 'undefined' &&
        typeof (window as any).webkitConvertPointFromNodeToPage === 'function',
    });

  const logHlsPlaybackPolicy = (
    directUrl: string,
    proxyUrl: string | null,
    policy: HlsPlaybackPolicyResult
  ) => {
    const logKey = JSON.stringify({
      directUrl,
      proxyUrl,
      mode: policy.mode,
      runtime: policy.runtime,
      playlistFilter: policy.playlistFilter,
      segmentMode: policy.segmentMode,
      recoveryProfile: policy.recoveryProfile,
      reason: policy.reason,
    });

    if (playbackPolicyLogKeysRef.current.has(logKey)) {
      return;
    }

    playbackPolicyLogKeysRef.current.add(logKey);

    console.info('[播放策略] 当前播放链路', {
      directUrl,
      playbackUrl: proxyUrl,
      playbackMode: policy.mode,
      runtime: policy.runtime,
      playlistFilter: policy.playlistFilter,
      segmentMode: policy.segmentMode,
      recoveryProfile: policy.recoveryProfile,
      reason: policy.reason,
    });

    emitPlaybackDebugLog(
      'playback-policy',
      '已选择播放策略',
      {
        directUrl,
        playbackUrl: policy.url,
        playbackMode: policy.mode,
        runtime: policy.runtime,
        playlistFilter: policy.playlistFilter,
        segmentMode: policy.segmentMode,
        recoveryProfile: policy.recoveryProfile,
        reason: policy.reason,
      },
      {
        playbackUrl: policy.url,
        policy,
      }
    );

    if (policy.reason === 'apple-native-hls-ios-skip') {
      console.info(
        '[播放策略][iOS] 当前终端使用原生 HLS 直连播放，旁路分析广告时间窗并自动跳过',
        {
          directUrl,
          playbackMode: policy.mode,
          runtime: policy.runtime,
          segmentMode: policy.segmentMode,
        }
      );
      return;
    }

    if (policy.reason === 'proxy-unavailable') {
      const adStrategy =
        policy.playlistFilter === 'ios-skip'
          ? '使用广告时间窗跳过'
          : policy.playlistFilter === 'client-filter'
            ? '使用客户端广告过滤'
            : '继续直连播放';
      console.warn(
        `[去广告][播放策略] 代理地址不可用，暂时使用直连播放（${adStrategy}）`,
        {
          directUrl,
          playbackMode: policy.mode,
          playlistFilter: policy.playlistFilter,
        }
      );
    }
  };

  const trySkipNativeAdWindow = (
    video: HTMLVideoElement,
    playbackUrl: string
  ) => {
    if (playbackPolicyRef.current?.playlistFilter !== 'ios-skip') {
      return false;
    }

    const decision = getHlsAdSkipDecision({
      currentTimeSeconds: video.currentTime || 0,
      windows: nativeAdSkipWindowsRef.current,
      lastSkippedWindowKey: nativeAdSkipLastWindowKeyRef.current,
      lastUserSeekAtMs: nativeAdSkipLastUserSeekAtRef.current,
      nowMs: Date.now(),
    });

    if (!decision.shouldSkip || decision.targetTimeSeconds == null) {
      return false;
    }

    const fromTime = video.currentTime || 0;
    nativeAdSkipLastWindowKeyRef.current = decision.windowKey;
    video.currentTime = decision.targetTimeSeconds;
    emitPlaybackDebugLog(
      'ios-ad-skip',
      'iOS 原生 HLS 已跳过高置信广告时间窗',
      {
        fromTime: Number(fromTime.toFixed(2)),
        targetTime: Number(decision.targetTimeSeconds.toFixed(2)),
        window: decision.window || null,
        windowKey: decision.windowKey,
      },
      {
        playbackUrl,
      }
    );
    return true;
  };

  const observeIosAdSignals = (
    directUrl: string,
    proxyUrl: string | null,
    policy: HlsPlaybackPolicyResult,
    retryAttempt = 0
  ) => {
    if (
      policy.runtime !== 'native-hls' ||
      policy.playlistFilter !== 'ios-skip' ||
      !directUrl ||
      !proxyUrl
    ) {
      return;
    }

    const observationUrl = `${proxyUrl}${
      proxyUrl.includes('?') ? '&' : '?'
    }observeOnly=1`;
    const sourceKey = getCurrentSourceKey();
    const episodeIndex = currentEpisodeIndexRef.current;

    void fetch(observationUrl, {
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`observe failed: ${response.status}`);
        }
        return (await response.json()) as IosAdObservationResponse;
      })
      .then((payload) => {
        const skipWindows = toHlsAdSkipWindows(payload.candidates || []);
        nativeAdSkipWindowsRef.current = skipWindows;
        nativeAdSkipLastWindowKeyRef.current = null;
        emitPlaybackDebugLog(
          'ios-ad-observe',
          'iOS 直连播放广告信号观测完成',
          {
            directUrl,
            observationUrl,
            sourceKey,
            episodeIndex,
            removed: false,
            skipWindowCount: skipWindows.length,
            skipWindows,
            targetUrl: payload.targetUrl || directUrl,
            removedLineCount: payload.removedLineCount ?? 0,
            summary: payload.summary || null,
            retryAttempt,
          },
          {
            playbackUrl: directUrl,
            policy,
          }
        );

        const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
        if (video) {
          trySkipNativeAdWindow(video, directUrl);
        }
      })
      .catch((error) => {
        emitPlaybackDebugLog(
          'ios-ad-observe-failed',
          'iOS 直连播放广告信号观测失败',
          {
            directUrl,
            observationUrl,
            sourceKey,
            episodeIndex,
            retryAttempt,
            error:
              error instanceof Error
                ? error.message
                : typeof error === 'string'
                ? error
                : 'unknown',
          },
          {
            playbackUrl: directUrl,
            policy,
          }
        );

        if (retryAttempt === 0 && typeof window !== 'undefined') {
          window.setTimeout(() => {
            observeIosAdSignals(directUrl, proxyUrl, policy, 1);
          }, 3000);
        }
      });
  };

  const showPlayerNotice = (art: any, message: string) => {
    if (art?.notice) {
      art.notice.show = message;
    }
  };

  const updateCastControlElement = (
    element: HTMLElement | undefined,
    status: CastStatus,
    label: string
  ) => {
    if (!element) return;
    element.dataset.castStatus = status;
    element.setAttribute('aria-label', label);
  };

  const removeNativeVideoRecoveryListeners = (video: HTMLVideoElement) => {
    if (video.recoveryWaitingListener) {
      video.removeEventListener('waiting', video.recoveryWaitingListener);
      video.recoveryWaitingListener = undefined;
    }

    if (video.recoveryPlayingListener) {
      video.removeEventListener('playing', video.recoveryPlayingListener);
      video.recoveryPlayingListener = undefined;
    }

    if (video.recoveryErrorListener) {
      video.removeEventListener('error', video.recoveryErrorListener);
      video.recoveryErrorListener = undefined;
    }

    if (video.recoveryTimeupdateListener) {
      video.removeEventListener('timeupdate', video.recoveryTimeupdateListener);
      video.recoveryTimeupdateListener = undefined;
    }

    if (video.recoverySeekingListener) {
      video.removeEventListener('seeking', video.recoverySeekingListener);
      video.recoverySeekingListener = undefined;
    }
  };

  const disposeCurrentPlayer = () => {
    const player = artPlayerRef.current;
    const video = player?.video as HTMLVideoElement | undefined;

    if (video) {
      removeNativeVideoRecoveryListeners(video);
      stopVideoElementLoading(video);
    }

    if (player) {
      try {
        player.destroy();
      } catch (error) {
        console.warn('销毁播放器失败:', error);
      }
      artPlayerRef.current = null;
    }
  };

  const requestNativeRecoveryAutoplay = (
    video: HTMLVideoElement | null | undefined,
    context: Record<string, unknown>
  ) => {
    if (!video || playbackPolicyRef.current?.runtime !== 'native-hls') {
      return;
    }

    void video
      .play()
      .then(() => {
        emitPlaybackDebugLog(
          'native-autoplay-resumed',
          '自动切源后已恢复播放',
          context,
          {
            playbackUrl: video.currentSrc || video.src || videoUrlRef.current,
          }
        );
      })
      .catch((error) => {
        const state = nativeRecoveryStateRef.current;
        state.playIntent = 'paused';
        state.browserAutoplayLocked = true;
        state.pauseReason = 'browser';
        state.ignoreStallUntil = 0;
        state.stallCount = 0;
        emitPlaybackDebugLog(
          'native-browser-autoplay-locked',
          '自动切源后浏览器阻止了自动播放，需要用户手动继续',
          {
            ...context,
            errorName: error instanceof Error ? error.name : null,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          {
            playbackUrl: video.currentSrc || video.src || videoUrlRef.current,
          }
        );
        emitPlaybackDebugLog(
          'native-autoplay-blocked',
          '自动切源后浏览器阻止了自动播放，需要用户手动继续',
          {
            ...context,
            errorName: error instanceof Error ? error.name : null,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          {
            playbackUrl: video.currentSrc || video.src || videoUrlRef.current,
          }
        );
      });
  };

  const isNativeVideoRecoveryActive = () =>
    playbackPolicyRef.current?.recoveryProfile === 'native-video';

  const getNativeVideoElement = () =>
    artPlayerRef.current?.video as HTMLVideoElement | undefined;

  const getNativeRecoveryPlaybackUrl = (video?: HTMLVideoElement | null) =>
    videoUrlRef.current ||
    video?.currentSrc ||
    playbackPolicyRef.current?.url ||
    '';

  const setNativePlaybackIntent = (intent: 'playing' | 'paused') => {
    const state = nativeRecoveryStateRef.current;
    const now = Date.now();
    state.playIntent = intent;
    if (intent === 'playing') {
      state.browserAutoplayLocked = false;
      state.pauseReason = 'initial';
      state.ignoreStallUntil = now + NATIVE_PLAY_RESUME_GRACE_MS;
      state.lastProgressAt = now;
      return;
    }

    state.pauseReason = 'user';
    state.ignoreStallUntil = 0;
  };

  const recordNativeJitterEvent = (
    type: NativeJitterEventType,
    video: HTMLVideoElement,
    playbackUrl: string,
    reason: string
  ) => {
    const state = nativeRecoveryStateRef.current;
    const now = Date.now();
    const mediaSourceUnavailable = isNativeMediaSourceUnavailable(video);

    state.jitterEvents.push({
      type,
      atMs: now,
      currentTime: Number((video.currentTime || 0).toFixed(2)),
      readyState: video.readyState,
    });

    const decision = getNativeJitterDecision({
      events: state.jitterEvents,
      nowMs: now,
      previousJitterWindows: 0,
    });
    state.jitterEvents = decision.events;

    if (!decision.isJitter) {
      return;
    }

    const isNewJitterWindow =
      state.lastJitterWindowAt <= 0 ||
      now - state.lastJitterWindowAt >= NATIVE_JITTER_WINDOW_MS;
    if (isNewJitterWindow) {
      state.jitterWindowCount += 1;
      state.lastJitterWindowAt = now;
    }

    if (now - state.lastJitterLogAt >= 8000) {
      state.lastJitterLogAt = now;
      emitPlaybackDebugLog(
        'native-jitter-detected',
        '原生播放器出现连续缓冲抖动',
        {
          reason,
          eventType: type,
          eventCount: decision.eventCount,
          rollbackCount: decision.rollbackCount,
          maxRollbackSeconds: decision.maxRollbackSeconds,
          jitterWindowCount: state.jitterWindowCount,
          reasons: decision.reasons,
          currentTime: Number((video.currentTime || 0).toFixed(2)),
          readyState: video.readyState,
          networkState: video.networkState,
          paused: video.paused,
          ended: video.ended,
          playIntent: state.playIntent,
          mediaSourceUnavailable,
        },
        {
          playbackUrl,
        }
      );
    }

  };

  const scheduleNativeRecoveryFromArtEvent = (
    reason: string,
    jitterEventType?: NativeJitterEventType
  ) => {
    if (!isNativeVideoRecoveryActive() || typeof window === 'undefined') {
      return;
    }

    const video = getNativeVideoElement();
    if (!video) {
      emitPlaybackDebugLog('native-recovery-missing-video', reason, {
        reason,
      });
      return;
    }

    const playbackUrl = getNativeRecoveryPlaybackUrl(video);
    const state = nativeRecoveryStateRef.current;
    state.lastBufferIssueAt = Date.now();
    clearWaitingRecoveryTimer();

    if (jitterEventType) {
      recordNativeJitterEvent(jitterEventType, video, playbackUrl, reason);
    }

    emitPlaybackDebugLog(
      'native-buffer-observed',
      reason,
      {
        source: 'artplayer-event',
        currentTime: Number((video.currentTime || 0).toFixed(2)),
        readyState: video.readyState,
        networkState: video.networkState,
        paused: video.paused,
        ended: video.ended,
        playIntent: state.playIntent,
      },
      {
        playbackUrl,
      }
    );
  };

  const scheduleNativeFalsePlayingCheck = () => {
    if (!isNativeVideoRecoveryActive() || typeof window === 'undefined') {
      return;
    }

    const video = getNativeVideoElement();
    if (!video) {
      return;
    }

    clearNativeFalsePlayingTimer();
    const startTime = video.currentTime || 0;
    const playbackUrl = getNativeRecoveryPlaybackUrl(video);

    nativeFalsePlayingTimerRef.current = window.setTimeout(() => {
      nativeFalsePlayingTimerRef.current = null;
      const currentVideo = getNativeVideoElement();
      if (!currentVideo || currentVideo.ended || currentVideo.paused) {
        return;
      }

      const currentTime = currentVideo.currentTime || 0;
      if (currentTime > startTime + 0.25) {
        return;
      }

      const state = nativeRecoveryStateRef.current;
      const now = Date.now();
      const mediaSourceUnavailable = isNativeMediaSourceUnavailable(currentVideo);
      if (
        shouldIgnoreNativeStall({
          playIntent: state.playIntent,
          mediaSourceUnavailable,
          nowMs: now,
          ignoreStallUntilMs: state.ignoreStallUntil,
        })
      ) {
        return;
      }

      emitPlaybackDebugLog(
        'native-false-playing',
        '原生播放器报告播放中但播放时间未推进',
        {
          startTime: Number(startTime.toFixed(2)),
          currentTime: Number(currentTime.toFixed(2)),
          readyState: currentVideo.readyState,
          networkState: currentVideo.networkState,
          paused: currentVideo.paused,
          ended: currentVideo.ended,
        },
        {
          playbackUrl,
        }
      );

      state.lastBufferIssueAt = now;
    }, NATIVE_FALSE_PLAYING_CHECK_DELAY_MS);
  };

  const executeNativeLowFrequencyRecovery = (
    video: HTMLVideoElement,
    playbackUrl: string,
    reason: string,
    severity: 'observe' | 'soft-stall' | 'hard-stall' | 'source-failed',
    stalledForMs: number
  ) => {
    const state = nativeRecoveryStateRef.current;
    const decision = getNativeRecoveryAction({
      severity,
      playIntent: state.playIntent,
      browserAutoplayLocked: state.browserAutoplayLocked,
      hasAlternativeSource: Boolean(getNextRecoverySource()),
      sourceRecoveryAttempts: state.sourceRecoveryAttempts,
    });
    const details = {
      reason,
      recoveryMode: severity,
      action: decision.action,
      currentTime: Number((video.currentTime || 0).toFixed(2)),
      readyState: video.readyState,
      networkState: video.networkState,
      paused: video.paused,
      ended: video.ended,
      playIntent: state.playIntent,
      pauseReason: state.pauseReason,
      browserAutoplayLocked: state.browserAutoplayLocked,
      stallObservedForMs: stalledForMs,
      sourceRecoveryAttempts: state.sourceRecoveryAttempts,
    };

    if (decision.action === 'observe') {
      const now = Date.now();
      const shouldThrottleObserveLog =
        severity === 'observe' || severity === 'soft-stall';
      if (
        shouldThrottleObserveLog &&
        now - state.lastRecoveryObserveLogAt < 15000
      ) {
        return false;
      }
      state.lastRecoveryObserveLogAt = now;
      emitPlaybackDebugLog(
        severity === 'hard-stall' || severity === 'source-failed'
          ? 'native-recovery-suppressed'
          : 'native-buffer-observed',
        decision.reason,
        {
          ...details,
          recoverySuppressedReason: decision.reason,
        },
        {
          playbackUrl,
        }
      );
      return false;
    }

    emitPlaybackDebugLog(
      severity === 'hard-stall' ? 'native-hard-stall' : 'native-recovery',
      decision.reason,
      details,
      {
        playbackUrl,
      }
    );

    if (decision.action === 'resume-playback') {
      state.sourceRecoveryAttempts += 1;
      state.ignoreStallUntil = Date.now() + NATIVE_PLAY_RESUME_GRACE_MS;
      void video.play().catch((error) => {
        state.playIntent = 'paused';
        state.browserAutoplayLocked = true;
        state.pauseReason = 'browser';
        state.ignoreStallUntil = 0;
        emitPlaybackDebugLog(
          'native-browser-autoplay-locked',
          '原生播放器恢复播放被浏览器阻止，需要用户手动继续',
          {
            ...details,
            errorName: error instanceof Error ? error.name : null,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          {
            playbackUrl,
          }
        );
      });
      return true;
    }

    if (decision.action === 'switch-source') {
      state.sourceRecoveryAttempts = 0;
      return trySwitchToNextAvailableSource(decision.reason);
    }

    return false;
  };

  const attachNativeVideoRecovery = (
    video: HTMLVideoElement,
    playbackUrl: string
  ) => {
    removeNativeVideoRecoveryListeners(video);
    clearWaitingRecoveryTimer();
    clearNativeWatchdogTimer();

    const state = nativeRecoveryStateRef.current;
    const now = Date.now();
    state.stallCount = 0;
    state.sourceRecoveryAttempts = 0;
    state.playIntent = video.paused ? 'paused' : 'playing';
    state.browserAutoplayLocked = false;
    state.pauseReason = video.paused ? 'user' : 'initial';
    state.ignoreStallUntil = video.paused ? 0 : now + NATIVE_PLAY_RESUME_GRACE_MS;
    state.lastObservedTime = video.currentTime || 0;
    state.lastProgressAt = now;
    state.lastBufferIssueAt = 0;
    state.lastRecoveryObserveLogAt = 0;
    state.lastJitterLogAt = 0;
    state.lastJitterWindowAt = 0;
    state.jitterWindowCount = 0;
    state.jitterEvents = [];

    const recordProgressIfAdvanced = () => {
      const currentTime = video.currentTime || 0;
      if (currentTime > state.lastObservedTime + 0.25) {
        state.lastObservedTime = currentTime;
        state.lastProgressAt = Date.now();
        state.stallCount = 0;
        state.sourceRecoveryAttempts = 0;
        clearNativeFalsePlayingTimer();
        markPlaybackHealthy(currentTime);
        return true;
      }

      state.lastObservedTime = currentTime;
      return false;
    };

    const handleError = () => {
      clearWaitingRecoveryTimer();
      state.lastBufferIssueAt = Date.now();
      executeNativeLowFrequencyRecovery(
        video,
        playbackUrl,
        '原生播放器报告错误',
        'source-failed',
        Date.now() - state.lastProgressAt
      );
    };
    const handlePlaying = () => {
      recordProgressIfAdvanced();
      scheduleNativeFalsePlayingCheck();
    };
    const handleTimeupdate = () => {
      if (trySkipNativeAdWindow(video, playbackUrl)) {
        return;
      }
      recordProgressIfAdvanced();
    };
    const handleSeeking = () => {
      nativeAdSkipLastUserSeekAtRef.current = Date.now();
    };

    video.recoveryPlayingListener = handlePlaying;
    video.recoveryErrorListener = handleError;
    video.recoveryTimeupdateListener = handleTimeupdate;
    video.recoverySeekingListener = handleSeeking;
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('error', handleError);
    video.addEventListener('timeupdate', handleTimeupdate);
    video.addEventListener('seeking', handleSeeking);

    if (typeof window !== 'undefined') {
      nativeWatchdogTimerRef.current = window.setInterval(() => {
        const now = Date.now();
        const mediaSourceUnavailable = isNativeMediaSourceUnavailable(video);
        const stalledForMs = now - state.lastProgressAt;

        if (
          shouldIgnoreNativeStall({
            playIntent: state.playIntent,
            mediaSourceUnavailable,
            nowMs: now,
            ignoreStallUntilMs: state.ignoreStallUntil,
          })
        ) {
          return;
        }

        if (recordProgressIfAdvanced()) {
          return;
        }

        const severity = getNativeStallSeverity({
          ended: video.ended,
          paused: video.paused,
          mediaSourceUnavailable,
          readyState: video.readyState,
          networkState: video.networkState,
          stalledForMs,
          hasRecentProgress: false,
        });

        if (severity === 'observe') {
          return;
        }

        executeNativeLowFrequencyRecovery(
          video,
          playbackUrl,
          `原生播放器播放时间 ${Math.round(stalledForMs / 1000)} 秒未推进`,
          severity,
          stalledForMs
        );
      }, NATIVE_WATCHDOG_INTERVAL_MS);
    }

    console.info('[播放策略][native] 已启用原生 HLS 卡死监控', {
      playbackUrl,
      segmentMode: playbackPolicyRef.current?.segmentMode,
      playlistFilter: playbackPolicyRef.current?.playlistFilter,
    });
    emitPlaybackDebugLog(
      'native-watchdog-enabled',
      '已启用原生 HLS 卡死监控',
      {
        playbackUrl,
        segmentMode: playbackPolicyRef.current?.segmentMode,
        playlistFilter: playbackPolicyRef.current?.playlistFilter,
      },
      {
        playbackUrl,
      }
    );
  };

  const createCustomHlsJsLoader = (HlsModule: any) =>
    class CustomHlsJsLoader extends HlsModule.DefaultConfig.loader {
      constructor(config: any) {
        super(config);
        const load = this.load.bind(this);
        this.load = function (context: any, config: any, callbacks: any) {
          // 拦截manifest和level请求
          if (
            (context as any).type === 'manifest' ||
            (context as any).type === 'level'
          ) {
            const onSuccess = callbacks.onSuccess;
            callbacks.onSuccess = function (
              response: any,
              stats: any,
              context: any
            ) {
              // 如果是m3u8文件，按播放策略决定是否改写播放器实际使用的playlist。
              if (response.data && typeof response.data === 'string') {
                const originalContent = response.data;
                const playlistUrl = response.url || context?.url;
                const policy = playbackPolicyRef.current;
                const shouldFilter =
                  policy?.runtime === 'hlsjs' &&
                  policy.playlistFilter === 'client-filter';
                const analysis = shouldFilter
                  ? analyzeM3U8AdCandidates(originalContent, playlistUrl)
                  : null;
                const filteredContent = analysis
                  ? applyM3U8AdFiltering(originalContent, analysis)
                  : originalContent;
                if (shouldFilter) {
                  response.data = filteredContent;
                }
                const debugInfo = shouldFilter
                  ? getM3U8AdFilterDebugInfo(
                      originalContent,
                      filteredContent,
                      playlistUrl
                    )
                  : logDirectAdObserveDebug(
                      playlistUrl,
                      originalContent,
                      context?.type
                    );
                if (debugInfo) {
                  emitPlaybackDebugLog(
                    shouldFilter ? 'hlsjs-ad-filter' : 'hlsjs-ad-observe',
                    shouldFilter
                      ? 'HLS.js 直连播放已应用广告过滤'
                      : 'HLS.js 直连播放广告信号观测完成',
                    {
                      playlistUrl,
                      playlistType: context?.type || null,
                      removed: shouldFilter,
                      removedLineCount: debugInfo.removedLineCount,
                      wouldRemoveLineCount: shouldFilter
                        ? undefined
                        : debugInfo.removedLineCount,
                      candidates: analysis?.candidates || [],
                      summary: debugInfo.summary,
                      sourceKey: getCurrentSourceKey() || null,
                      episodeIndex: currentEpisodeIndexRef.current,
                    },
                    {
                      playbackUrl: playlistUrl || videoUrlRef.current,
                    }
                  );
                }
              }
              return onSuccess(response, stats, context, null);
            };
          }
          // 执行原始load方法
          load(context, config, callbacks);
        };
      }
    };

  // 当集数索引变化时自动更新视频地址
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  // 进入页面时直接获取全部源信息
  useEffect(() => {
    const fetchSourceDetail = async (
      source: string,
      id: string
    ): Promise<SearchResult[]> => {
      try {
        const detailResponse = await fetch(
          `/api/detail?source=${source}&id=${id}`
        );
        if (!detailResponse.ok) {
          throw new Error('获取视频详情失败');
        }
        const detailData = (await detailResponse.json()) as SearchResult;
        setAvailableSources([detailData]);
        return [detailData];
      } catch (err) {
        console.error('获取视频详情失败:', err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };
    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      // 根据搜索词获取全部源信息
      try {
        setSourceSearchLoading(true);
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );
        if (!response.ok) {
          throw new Error('搜索失败');
        }
        const data = await response.json();

        // 处理搜索结果，根据规则过滤
        const results = data.results.filter(
          (result: SearchResult) =>
            result.title.replaceAll(' ', '').toLowerCase() ===
              videoTitleRef.current.replaceAll(' ', '').toLowerCase() &&
            (videoYearRef.current
              ? result.year.toLowerCase() === videoYearRef.current.toLowerCase()
              : true) &&
            (searchType
              ? (searchType === 'tv' && result.episodes.length > 1) ||
                (searchType === 'movie' && result.episodes.length === 1)
              : true)
        );
        setAvailableSources(results);
        return results;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setSourceSearchLoading(true);
      setLoading(true);
      setPrecomputedVideoInfo(new Map());
      setPrecomputedSourceStatuses(new Map());
      setSourceSelectionScores(new Map());
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId ? '正在获取视频详情...' : '正在搜索播放源...'
      );

      let sourcesInfo = await fetchSourcesData(searchTitle || videoTitle);
      if (
        currentSource &&
        currentId &&
        !sourcesInfo.some(
          (source) => source.source === currentSource && source.id === currentId
        )
      ) {
        sourcesInfo = await fetchSourceDetail(currentSource, currentId);
      }
      if (sourcesInfo.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      let detailData: SearchResult = sourcesInfo[0];
      // 指定源和id且无需优选
      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (source) => source.source === currentSource && source.id === currentId
        );
        if (target) {
          detailData = target;
        } else {
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }
      }

      // 未指定源和 id 或需要优选，且开启优选开关
      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('正在优选最佳播放源...');

        detailData = await preferBestSource(sourcesInfo);
      } else {
        updateSourceSelectionScores(
          sourcesInfo,
          precomputedSourceStatusesRef.current,
          precomputedVideoInfoRef.current
        );
      }

      console.log(detailData.source, detailData.id);

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setDetail(detailData);
      if (currentEpisodeIndex >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      // 规范URL参数
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('准备就绪，即将开始播放...');

      // 短暂延迟让用户看到完成状态
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    };

    initAll();
  }, []);

  // 播放记录处理
  useEffect(() => {
    // 仅在初次挂载时检查播放记录
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;

      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSource, currentId);
        const record = allRecords[key];

        if (record) {
          const targetIndex = record.index - 1;
          const targetTime = record.play_time;

          // 更新当前选集索引
          if (targetIndex !== currentEpisodeIndex) {
            setCurrentEpisodeIndex(targetIndex);
          }

          // 保存待恢复的播放进度，待播放器就绪后跳转
          resumeTimeRef.current = targetTime;
        }
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }
    };

    initFromHistory();
  }, []);

  // 处理换源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string,
    options: SourceChangeOptions = {}
  ) => {
    try {
      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);
      sourceSwitchSavePendingRef.current = false;
      sourceSwitchAutoPlayPendingRef.current = false;

      // 记录当前播放进度（仅在同一集数切换时恢复）
      const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
      const currentPlayTime =
        typeof video?.currentTime === 'number'
          ? video.currentTime
          : artPlayerRef.current?.currentTime || 0;
      console.log('换源前当前播放时间:', currentPlayTime);

      const sourceList =
        availableSourcesRef.current.length > 0
          ? availableSourcesRef.current
          : availableSources;
      const newDetail = sourceList.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setIsVideoLoading(false);
        setError('未找到匹配结果');
        return;
      }

      const rememberedStatus = getRememberedSourceStatus(newDetail.episodes);
      if (rememberedStatus?.kind === 'unavailable') {
        setIsVideoLoading(false);
        setError(rememberedStatus.reason || '该播放源当前不可用');
        return;
      }

      // 尝试跳转到当前正在播放的集数
      const activeEpisodeIndex = currentEpisodeIndexRef.current;
      const targetIndex = getSourceSwitchTargetEpisodeIndex({
        currentEpisodeIndex: activeEpisodeIndex,
        episodeCount: newDetail.episodes?.length || 0,
        requireCurrentEpisode: Boolean(options.autoRecovery),
      });

      if (targetIndex === null) {
        setIsVideoLoading(false);
        emitPlaybackDebugLog(
          'switch-source-skip-episode-mismatch',
          '候选播放源不包含当前集，已跳过自动切源',
          {
            reason: options.reason,
            nextSource: newSource,
            nextId: newId,
            currentEpisodeIndex: activeEpisodeIndex,
            nextEpisodeCount: newDetail.episodes?.length || 0,
          }
        );
        return;
      }
      sourceFallbackAttemptedRef.current = false;

      const plannedResumeTime =
        typeof options.resumeTime === 'number' && options.resumeTime > 0
          ? options.resumeTime
          : resumeTimeRef.current;
      const resumePlan = getSourceSwitchResumePlan({
        currentEpisodeIndex: activeEpisodeIndex,
        targetEpisodeIndex: targetIndex,
        currentPlayTime,
        existingResumeTime: plannedResumeTime,
      });
      resumeTimeRef.current = resumePlan.resumeTime;
      sourceSwitchSavePendingRef.current = resumePlan.saveAfterCanPlay;
      sourceSwitchAutoPlayPendingRef.current = Boolean(
        options.autoPlayAfterReady
      );

      if (options.autoRecovery) {
        emitPlaybackDebugLog('switch-source-resume-planned', '已规划自动切源恢复点', {
          reason: options.reason,
          nextSource: newSource,
          nextId: newId,
          currentEpisodeIndex: activeEpisodeIndex,
          targetEpisodeIndex: targetIndex,
          currentPlayTime,
          resumeTime: resumePlan.resumeTime,
          autoPlayAfterReady: sourceSwitchAutoPlayPendingRef.current,
        });
      }

      // 更新URL参数（不刷新页面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      // 隐藏换源加载状态
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 集数切换
  // ---------------------------------------------------------------------------
  // 处理集数切换
  const handleEpisodeChange = (episodeNumber: number) => {
    // episodeNumber是显示的集数（从1开始），需要转换为索引（从0开始）
    const episodeIndex = episodeNumber - 1;
    if (episodeIndex >= 0 && episodeIndex < totalEpisodes) {
      // 在更换集数前保存当前播放进度
      if (artPlayerRef.current && artPlayerRef.current.paused) {
        saveCurrentPlayProgress('episode-change');
      }
      setCurrentEpisodeIndex(episodeIndex);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress('episode-change');
      }
      setCurrentEpisodeIndex(idx - 1);
    }
  };

  const handleNextEpisode = () => {
    console.log('尝试切换到下一集');
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress('episode-change');
      }
      setCurrentEpisodeIndex(idx + 1);
    }
  };

  // ---------------------------------------------------------------------------
  // 键盘快捷键
  // ---------------------------------------------------------------------------
  // 处理全局快捷键
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略输入框中的按键事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 播放记录相关
  // ---------------------------------------------------------------------------
  const getRuntimeStorageType = () => {
    if (typeof window !== 'undefined') {
      return (window as any).RUNTIME_CONFIG?.STORAGE_TYPE || null;
    }

    return process.env.NEXT_PUBLIC_STORAGE_TYPE || null;
  };

  // 保存播放进度
  const saveCurrentPlayProgress = async (
    reason: PlayRecordSaveReason = 'heartbeat',
    options?: {
      keepalive?: boolean;
    }
  ) => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = Math.floor(player.currentTime || 0);
    const duration = Math.floor(player.duration || 0);

    // 如果播放时间太短（少于5秒）或者视频时长无效，不保存
    if (currentTime < 1 || !duration) {
      return;
    }

    const saveTime = Date.now();
    const snapshot = {
      key: generateStorageKey(currentSourceRef.current, currentIdRef.current),
      episodeIndex: currentEpisodeIndexRef.current,
      playTime: currentTime,
      totalTime: duration,
      savedAt: saveTime,
    } satisfies PlayRecordSaveSnapshot;

    if (!shouldSavePlayRecord(lastSavedSnapshotRef.current, snapshot, reason)) {
      return;
    }

    try {
      await savePlayRecord(
        currentSourceRef.current,
        currentIdRef.current,
        {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          index: currentEpisodeIndexRef.current + 1, // 转换为1基索引
          total_episodes: detailRef.current?.episodes.length || 1,
          play_time: currentTime,
          total_time: duration,
          save_time: saveTime,
          search_title: searchTitle,
        },
        options
      );

      lastSaveTimeRef.current = saveTime;
      lastSavedSnapshotRef.current = snapshot;
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  useEffect(() => {
    // 页面即将卸载时保存播放进度
    const handleBeforeUnload = () => {
      void saveCurrentPlayProgress('beforeunload', { keepalive: true });
    };

    // 页面可见性变化时保存播放进度
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void saveCurrentPlayProgress('visibility-hidden', {
          keepalive: true,
        });
      }
    };

    // 添加事件监听器
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件监听器
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 收藏相关
  // ---------------------------------------------------------------------------
  // 每当 source 或 id 变化时检查收藏状态
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 监听收藏数据更新事件
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，删除收藏
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        // 如果未收藏，添加收藏
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  useEffect(() => {
    if (
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 确保选集索引有效
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }
    console.log(videoUrl);

    let cancelled = false;

    const setupPlayer = async () => {
      try {
        const [artplayerModule, hlsModule] = await Promise.all([
          import('artplayer'),
          import('hls.js'),
        ]);
        const Artplayer = artplayerModule.default as any;
        const Hls = hlsModule.default as any;

        if (cancelled) return;

        const playbackPolicy = playbackPolicyRef.current;
        const isNativeHlsRuntime = playbackPolicy?.runtime === 'native-hls';

        // hls.js 运行时且播放器已存在时，直接使用 switch 方法切换
        if (!isNativeHlsRuntime && artPlayerRef.current) {
          artPlayerRef.current.switch = videoUrl;
          artPlayerRef.current.title = `${videoTitle} - 第${
            currentEpisodeIndex + 1
          }集`;
          artPlayerRef.current.poster = videoCover;
          if (artPlayerRef.current?.video) {
            ensureVideoSource(
              artPlayerRef.current.video as HTMLVideoElement,
              videoUrl
            );
          }
          return;
        }

        // native HLS 运行时或首次创建：销毁之前的播放器实例并创建新的
        disposeCurrentPlayer();

        const CustomHlsJsLoader = createCustomHlsJsLoader(Hls);

        // 创建新的播放器实例
        Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
        Artplayer.USE_RAF = true;

        artPlayerRef.current = new Artplayer({
          container: artRef.current,
          url: videoUrl,
          poster: videoCover,
          volume: 0.7,
          isLive: false,
          muted: false,
          autoplay: true,
          pip: true,
          autoSize: false,
          autoMini: false,
          screenshot: false,
          setting: true,
          loop: false,
          flip: false,
          playbackRate: true,
          aspectRatio: false,
          fullscreen: true,
          fullscreenWeb: true,
          subtitleOffset: false,
          miniProgressBar: false,
          mutex: true,
          playsInline: true,
          autoPlayback: false,
          airplay: true,
          theme: 'rgb(var(--ui-success))',
          lang: 'zh-cn',
          hotkey: false,
          fastForward: true,
          autoOrientation: true,
          lock: true,
          moreVideoAttr: {
            crossOrigin: 'anonymous',
          },
          // HLS 支持配置
          customType: {
            m3u8: function (video: HTMLVideoElement, url: string) {
              if (playbackPolicyRef.current?.runtime === 'native-hls') {
                if (video.hls) {
                  video.hls.destroy();
                  video.hls = undefined;
                }
                ensureVideoSource(video, url);
                video.src = url;
                attachNativeVideoRecovery(video, url);
                void video.play().catch(() => undefined);
                return;
              }

              if (!Hls) {
                console.error('HLS.js 未加载');
                return;
              }

              if (video.hls) {
                video.hls.destroy();
              }
              const hls = new Hls({
                debug: false, // 关闭日志
                enableWorker: true, // WebWorker 解码，降低主线程压力
                lowLatencyMode: false, // 点播场景优先稳定性，避免低缓冲导致频繁卡顿

                /* 缓冲/内存相关 */
                maxBufferLength: 60, // 增大前向缓冲，提升波动网络下的连续播放稳定性
                backBufferLength: 90, // 适度保留已播放缓冲，降低 seek/恢复时的二次卡顿
                maxBufferSize: 90 * 1000 * 1000, // 约 90MB，换取更稳的点播缓冲空间

                /* 自定义loader */
                loader: CustomHlsJsLoader as any,
              });

              hls.loadSource(url);
              hls.attachMedia(video);
              video.hls = hls;

              ensureVideoSource(video, url);

              const executeRecoveryPlan = (reason: string, action: string) => {
                switch (action) {
                  case 'nudge-playback': {
                    console.warn(`${reason}，尝试微调播放位置`);
                    const nudged = tryNudgePlayback(video);
                    if (!nudged) {
                      hls.startLoad(Math.max(0, video.currentTime - 1));
                    }
                    void video.play().catch(() => undefined);
                    return true;
                  }
                  case 'restart-load':
                    console.warn(`${reason}，尝试重新拉取分片`);
                    hlsRecoveryStateRef.current.networkRecoveryAttempts += 1;
                    hls.startLoad(Math.max(0, video.currentTime - 1));
                    void video.play().catch(() => undefined);
                    return true;
                  case 'recover-media':
                    console.warn(`${reason}，尝试恢复媒体解码器`);
                    hlsRecoveryStateRef.current.mediaRecoveryAttempts += 1;
                    hls.recoverMediaError();
                    void video.play().catch(() => undefined);
                    return true;
                  case 'switch-proxy':
                    if (trySwitchToProxyPlayback()) {
                      console.warn(`${reason}，已切换到代理重试`);
                      hls.destroy();
                      return true;
                    }
                    return trySwitchToNextAvailableSource(
                      `${reason}，代理回退不可用`
                    );
                  case 'switch-source':
                    return trySwitchToNextAvailableSource(reason);
                  case 'destroy':
                    console.error(reason);
                    hls.destroy();
                    setError('当前播放源不可恢复，请稍后重试或手动换源');
                    return true;
                  default:
                    return false;
                }
              };

              const triggerRecovery = (
                reason: string,
                errorType?: string,
                errorDetails?: string,
                fatal = false
              ) => {
                const now = Date.now();
                if (
                  hlsRecoveryStateRef.current.lastErrorAt > 0 &&
                  now - hlsRecoveryStateRef.current.lastErrorAt > 20000
                ) {
                  hlsRecoveryStateRef.current.stallCount = 0;
                  hlsRecoveryStateRef.current.networkRecoveryAttempts = 0;
                  hlsRecoveryStateRef.current.mediaRecoveryAttempts = 0;
                }
                hlsRecoveryStateRef.current.lastErrorAt = now;

                if (
                  errorDetails === 'bufferStalledError' ||
                  errorDetails === 'bufferNudgeOnStall' ||
                  errorDetails === 'waitingTimeout'
                ) {
                  hlsRecoveryStateRef.current.stallCount += 1;
                }

                const plan = getHlsRecoveryPlan({
                  fatal,
                  errorType,
                  errorDetails,
                  playbackMode: playbackModeRef.current,
                  stallCount: hlsRecoveryStateRef.current.stallCount,
                  networkRecoveryAttempts:
                    hlsRecoveryStateRef.current.networkRecoveryAttempts,
                  mediaRecoveryAttempts:
                    hlsRecoveryStateRef.current.mediaRecoveryAttempts,
                  hasAlternativeSource: Boolean(getNextRecoverySource()),
                });

                if (plan.action === 'ignore') {
                  return;
                }

                emitPlaybackDebugLog(
                  'hls-recovery',
                  reason || plan.reason,
                  {
                    action: plan.action,
                    planReason: plan.reason,
                    errorType,
                    errorDetails,
                    fatal,
                    stallCount: hlsRecoveryStateRef.current.stallCount,
                    networkRecoveryAttempts:
                      hlsRecoveryStateRef.current.networkRecoveryAttempts,
                    mediaRecoveryAttempts:
                      hlsRecoveryStateRef.current.mediaRecoveryAttempts,
                  },
                  {
                    playbackUrl: video.currentSrc || videoUrlRef.current,
                  }
                );
                executeRecoveryPlan(reason || plan.reason, plan.action);
              };

              if (video.recoveryWaitingListener) {
                video.removeEventListener(
                  'waiting',
                  video.recoveryWaitingListener
                );
              }

              if (video.recoveryPlayingListener) {
                video.removeEventListener(
                  'playing',
                  video.recoveryPlayingListener
                );
              }

              const handleVideoWaiting = () => {
                clearWaitingRecoveryTimer();
                if (typeof window === 'undefined') {
                  return;
                }

                waitingRecoveryTimerRef.current = window.setTimeout(() => {
                  waitingRecoveryTimerRef.current = null;
                  triggerRecovery(
                    '播放器等待缓冲超时',
                    'mediaError',
                    'waitingTimeout',
                    false
                  );
                }, 4000);
              };

              const handleVideoPlaying = () => {
                markPlaybackHealthy(video.currentTime || 0);
              };

              video.recoveryWaitingListener = handleVideoWaiting;
              video.recoveryPlayingListener = handleVideoPlaying;
              video.addEventListener('waiting', handleVideoWaiting);
              video.addEventListener('playing', handleVideoPlaying);

              hls.on(Hls.Events.ERROR, function (event: any, data: any) {
                console.error('HLS Error:', event, data);
                triggerRecovery(
                  data?.fatal ? 'HLS 致命错误' : 'HLS 播放异常',
                  data?.type,
                  data?.details,
                  Boolean(data?.fatal)
                );
              });
            },
          },
          icons: {
            loading:
              '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
          },
          // 控制栏配置
          controls: [
            {
              position: 'left',
              index: 13,
              html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
              tooltip: '播放下一集',
              click: function () {
                handleNextEpisode();
              },
            },
            {
              position: 'right',
              index: 9,
              html: castControlIcon,
              tooltip:
                castStatus === 'connected'
                  ? '已投屏'
                  : castStatus === 'connecting'
                  ? '正在连接投屏'
                  : '投屏',
              click: async function (this: any, component: any) {
                const castControlElement = component?.$parent as
                  | HTMLElement
                  | undefined;
                const directUrl = originalVideoUrlRef.current;
                const playbackUrl = videoUrlRef.current;
                const proxyUrl = buildHlsProxyUrl(directUrl);
                const castMediaUrl = resolveCastMediaUrl({
                  directUrl,
                  proxyUrl,
                  playbackUrl,
                });

                setCastStatus('connecting');
                updateCastControlElement(
                  castControlElement,
                  'connecting',
                  '正在连接投屏'
                );

                if (this.video && castMediaUrl.url) {
                  ensureVideoSource(
                    this.video as HTMLVideoElement,
                    castMediaUrl.url
                  );
                }

                const result = await requestCastPlayback({
                  video: this.video as HTMLVideoElement | null | undefined,
                  media: {
                    title: videoTitleRef.current || videoTitle || '正在播放',
                    subtitle: `第 ${currentEpisodeIndexRef.current + 1} 集 · ${
                      detailRef.current?.source_name || ''
                    }`.trim(),
                    poster: detailRef.current?.poster || videoCover,
                    directUrl,
                    proxyUrl,
                    playbackUrl,
                  },
                  onNotice: (message) => showPlayerNotice(this, message),
                });

                setCastStatus(result.status);
                updateCastControlElement(
                  castControlElement,
                  result.status,
                  result.status === 'connected' ? '已投屏' : '投屏'
                );
                showPlayerNotice(this, result.message);
              },
            },
          ],
        });

        // 监听播放器事件
        artPlayerRef.current.on('ready', () => {
          setError(null);
          // 更新视频时长
          const duration = artPlayerRef.current.duration || 0;
          setVideoDuration(duration);
        });

        artPlayerRef.current.on('video:volumechange', () => {
          lastVolumeRef.current = artPlayerRef.current.volume;
        });

        artPlayerRef.current.on('video:waiting', () => {
          emitNativeVideoStateDebugLog(
            'native-video-waiting',
            '原生播放器进入等待缓冲状态'
          );
          scheduleNativeRecoveryFromArtEvent(
            '原生播放器等待缓冲超时',
            'waiting'
          );
        });

        artPlayerRef.current.on('video:stalled', () => {
          emitNativeVideoStateDebugLog(
            'native-video-stalled',
            '原生播放器报告媒体数据停滞'
          );
          scheduleNativeRecoveryFromArtEvent(
            '原生播放器分片加载停滞',
            'stalled'
          );
        });

        artPlayerRef.current.on('video:suspend', () => {
          emitNativeVideoStateDebugLog(
            'native-video-suspend',
            '原生播放器暂停拉取媒体数据'
          );
          scheduleNativeRecoveryFromArtEvent(
            '原生播放器暂停拉取媒体数据',
            'suspend'
          );
        });

        artPlayerRef.current.on('video:play', () => {
          setNativePlaybackIntent('playing');
          emitNativeVideoStateDebugLog(
            'native-video-play',
            '原生播放器收到播放请求'
          );
          scheduleNativeFalsePlayingCheck();
        });

        artPlayerRef.current.on('video:pause', () => {
          const video = artPlayerRef.current.video as HTMLVideoElement | undefined;
          const state = nativeRecoveryStateRef.current;
          const now = Date.now();
          const mediaSourceUnavailable = video
            ? isNativeMediaSourceUnavailable(video)
            : false;
          const recentlyHadBufferIssue =
            state.lastBufferIssueAt > 0 &&
            now - state.lastBufferIssueAt <= NATIVE_RECENT_BUFFER_ISSUE_WINDOW_MS;
          const shouldResetRecovery = shouldResetNativeRecoveryOnPause({
            isVideoLoading: isVideoLoadingRef.current,
            mediaSourceUnavailable,
            recentlyHadBufferIssue,
          });

          if (shouldResetRecovery) {
            setNativePlaybackIntent('paused');
            clearWaitingRecoveryTimer();
            clearNativeFalsePlayingTimer();
            state.stallCount = 0;
            state.sourceRecoveryAttempts = 0;
            state.lastProgressAt = now;
          } else {
            state.pauseReason = 'buffering';
          }
          emitNativeVideoStateDebugLog(
            'native-video-pause',
            shouldResetRecovery
              ? '原生播放器进入暂停状态'
              : '原生播放器在缓冲异常后进入暂停状态，保留恢复状态'
          );
        });

        // 监听播放时间更新（用于跳过功能）
        artPlayerRef.current.on('video:timeupdate', () => {
          const currentTime = artPlayerRef.current.currentTime || 0;
          setCurrentPlayTime(currentTime);
          markPlaybackHealthy(currentTime);

          // 同时更新时长（防止ready事件中获取不到）
          const duration = artPlayerRef.current.duration || 0;
          if (duration > 0 && videoDuration !== duration) {
            setVideoDuration(duration);
          }
        });

        // 监听视频可播放事件，这时恢复播放进度更可靠
        artPlayerRef.current.on('video:canplay', () => {
          markPlaybackHealthy(artPlayerRef.current.currentTime || 0);
          emitPlaybackDebugLog(
            'video-canplay',
            '视频进入可播放状态',
            {
              duration: artPlayerRef.current.duration || 0,
            },
            {
              playbackUrl:
                artPlayerRef.current?.video?.currentSrc || videoUrlRef.current,
            }
          );

          // 若存在需要恢复的播放进度，则跳转
          let appliedResumeTime: number | null = null;
          if (resumeTimeRef.current && resumeTimeRef.current > 0) {
            try {
              const duration = artPlayerRef.current.duration || 0;
              const target = clampSourceSwitchResumeTime({
                resumeTime: resumeTimeRef.current,
                duration,
              });
              artPlayerRef.current.currentTime = target;
              appliedResumeTime = target;
              console.log('成功恢复播放进度到:', resumeTimeRef.current);
              emitPlaybackDebugLog(
                'switch-source-resume-applied',
                '已在新播放源应用恢复进度',
                {
                  resumeTime: target,
                  originalResumeTime: resumeTimeRef.current,
                  duration,
                  sourceKey: getCurrentSourceKey(),
                },
                {
                  playbackUrl:
                    artPlayerRef.current?.video?.currentSrc || videoUrlRef.current,
                }
              );
            } catch (err) {
              console.warn('恢复播放进度失败:', err);
            }
          }
          resumeTimeRef.current = null;

          setTimeout(() => {
            if (
              Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) >
              0.01
            ) {
              artPlayerRef.current.volume = lastVolumeRef.current;
            }
            artPlayerRef.current.notice.show = '';
          }, 0);

          // 隐藏换源加载状态
          setIsVideoLoading(false);

          const shouldAutoPlayAfterSourceSwitch =
            sourceSwitchAutoPlayPendingRef.current;
          sourceSwitchAutoPlayPendingRef.current = false;
          if (shouldAutoPlayAfterSourceSwitch) {
            requestNativeRecoveryAutoplay(
              artPlayerRef.current?.video as HTMLVideoElement | undefined,
              {
                trigger: 'video-canplay',
                resumeTime: appliedResumeTime,
                sourceKey: getCurrentSourceKey(),
              }
            );
          }

          if (sourceSwitchSavePendingRef.current) {
            sourceSwitchSavePendingRef.current = false;
            setTimeout(() => {
              void saveCurrentPlayProgress('resume-sync');
            }, 0);
          }

          if (!startupFeedbackSentRef.current) {
            startupFeedbackSentRef.current = true;
            const currentVideoInfo = precomputedVideoInfoRef.current.get(
              getCurrentSourceKey()
            );
            const startedAt = playbackStartupStartedAtRef.current;
            void reportPlaybackFeedback({
              sourceKey: getCurrentSourceKey(),
              playbackDomain: getCurrentPlaybackDomain(),
              title: videoTitleRef.current,
              playbackMode: playbackModeRef.current,
              startupSuccess: true,
              startupTimeMs:
                startedAt && startedAt > 0 ? Date.now() - startedAt : undefined,
              switchedToProxy: playbackModeRef.current === 'proxy',
              browserQuality:
                currentVideoInfo &&
                !currentVideoInfo.hasError &&
                currentVideoInfo.quality !== '未知'
                  ? currentVideoInfo.quality
                  : undefined,
              browserPingMs:
                currentVideoInfo && currentVideoInfo.pingTime > 0
                  ? currentVideoInfo.pingTime
                  : undefined,
              browserSpeedLabel:
                currentVideoInfo &&
                !currentVideoInfo.hasError &&
                currentVideoInfo.loadSpeed !== '未知'
                  ? currentVideoInfo.loadSpeed
                  : undefined,
            });
          }
        });

        artPlayerRef.current.on('video:playing', () => {
          markPlaybackHealthy(artPlayerRef.current.currentTime || 0);
          emitNativeVideoStateDebugLog(
            'native-video-playing',
            '原生播放器恢复播放推进'
          );
          scheduleNativeFalsePlayingCheck();
        });

        artPlayerRef.current.on('error', (err: any) => {
          console.error('播放器错误:', err);
          emitPlaybackDebugLog(
            'player-error',
            '播放器报告错误',
            {
              error:
                err instanceof Error
                  ? err.message
                  : typeof err === 'string'
                  ? err
                  : String(err || 'unknown'),
            },
            {
              playbackUrl:
                artPlayerRef.current?.video?.currentSrc || videoUrlRef.current,
            }
          );
          const video = artPlayerRef.current?.video as
            | HTMLVideoElement
            | undefined;

          if (playbackPolicyRef.current?.recoveryProfile === 'native-video' && video) {
            if (
              executeNativeLowFrequencyRecovery(
                video,
                videoUrlRef.current,
                '播放器报告原生播放错误',
                'source-failed',
                Date.now() - nativeRecoveryStateRef.current.lastProgressAt
              )
            ) {
              return;
            }
          }

          if (trySwitchToProxyPlayback()) {
            console.log('播放器错误，已切换到代理重试');
            return;
          }

          if (trySwitchToNextAvailableSource('播放器错误，代理回退不可用')) {
            return;
          }

          if (!startupFeedbackSentRef.current) {
            startupFeedbackSentRef.current = true;
            void reportPlaybackFeedback({
              sourceKey: getCurrentSourceKey(),
              playbackDomain: getCurrentPlaybackDomain(),
              title: videoTitleRef.current,
              playbackMode: playbackModeRef.current,
              startupSuccess: false,
              startupTimeMs:
                playbackStartupStartedAtRef.current &&
                playbackStartupStartedAtRef.current > 0
                  ? Date.now() - playbackStartupStartedAtRef.current
                  : undefined,
              switchedToProxy: playbackModeRef.current === 'proxy',
              sessionError:
                err instanceof Error
                  ? err.message
                  : typeof err === 'string'
                  ? err
                  : '播放器启动失败',
            });
          }
        });

        // 监听视频播放结束事件，自动播放下一集
        artPlayerRef.current.on('video:ended', () => {
          const d = detailRef.current;
          const idx = currentEpisodeIndexRef.current;
          if (d && d.episodes && idx < d.episodes.length - 1) {
            setTimeout(() => {
              setCurrentEpisodeIndex(idx + 1);
            }, 1000);
          }
        });

        artPlayerRef.current.on('video:timeupdate', () => {
          const now = Date.now();
          const interval = getPlayRecordHeartbeatIntervalMs(
            getRuntimeStorageType()
          );
          if (now - lastSaveTimeRef.current > interval) {
            saveCurrentPlayProgress('heartbeat');
            lastSaveTimeRef.current = now;
          }
        });

        artPlayerRef.current.on('pause', () => {
          saveCurrentPlayProgress('pause');
        });

        if (artPlayerRef.current?.video) {
          ensureVideoSource(
            artPlayerRef.current.video as HTMLVideoElement,
            videoUrl
          );
          if (playbackPolicyRef.current?.runtime === 'native-hls') {
            const video = artPlayerRef.current.video as HTMLVideoElement;
            if (!video.currentSrc && !video.src) {
              video.src = videoUrl;
            }
            attachNativeVideoRecovery(video, videoUrl);
            emitPlaybackDebugLog(
              'native-watchdog-forced',
              '已在播放器创建后确认原生 HLS 监控',
              {
                currentSrc: video.currentSrc || video.src || null,
                readyState: video.readyState,
                networkState: video.networkState,
              },
              {
                playbackUrl: video.currentSrc || videoUrl,
              }
            );
          }
        }
      } catch (err) {
        console.error('创建播放器失败:', err);
        setError('播放器初始化失败');
      }
    };

    setupPlayer();

    return () => {
      cancelled = true;
    };
  }, [videoUrl, loading]);

  // 当组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }

      clearWaitingRecoveryTimer();
      clearNativeWatchdogTimer();
      clearNativeFalsePlayingTimer();
      disposeCurrentPlayer();
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        <InitialLoadingOverlay message={loadingMessage} stage={loadingStage} />
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex min-h-[70vh] items-center justify-center'>
          <Surface
            variant='frosted'
            className='mx-auto w-full max-w-lg px-6 py-8 text-center'
          >
            {/* 错误图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto flex h-24 w-24 items-center justify-center rounded-ui-lg bg-red-500 shadow-2xl transition-transform duration-300 hover:scale-105'>
                <div className='text-white text-4xl'>😵</div>
                {/* 脉冲效果 */}
                <div className='absolute -inset-2 animate-pulse rounded-ui-lg bg-red-500 opacity-20'></div>
              </div>

              {/* 浮动错误粒子 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-red-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-yellow-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            {/* 错误信息 */}
            <div className='mb-8 space-y-4'>
              <h2 className='text-2xl font-bold text-[rgb(var(--ui-text))]'>
                哎呀，出现了一些问题
              </h2>
              <div className='rounded-ui-md border border-red-500/25 bg-red-500/10 p-4'>
                <p className='font-medium text-red-200'>{error}</p>
              </div>
              <p className='text-sm text-[rgb(var(--ui-text-muted))]'>
                请检查网络连接或尝试刷新页面
              </p>
            </div>

            {/* 操作按钮 */}
            <div className='space-y-3'>
              <button
                onClick={() =>
                  videoTitle
                    ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    : router.back()
                }
                className='w-full rounded-ui-md bg-[rgb(var(--ui-accent))] px-6 py-3 font-medium text-[rgb(var(--ui-on-accent))] shadow-ui-soft transition-all duration-200 hover:scale-[1.02] hover:brightness-110'
              >
                {videoTitle ? '🔍 返回搜索' : '← 返回上页'}
              </button>

              <button
                onClick={() => window.location.reload()}
                className='w-full rounded-ui-md border border-white/10 bg-white/5 px-6 py-3 font-medium text-[rgb(var(--ui-text))] transition-colors duration-200 hover:bg-white/10'
              >
                🔄 重新尝试
              </button>
            </div>
          </Surface>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/play'>
      <div className='space-y-6'>
        <PlayerHeader
          title={videoTitle || '影片标题'}
          subtitle={[
            totalEpisodes > 1 ? `第 ${currentEpisodeIndex + 1} 集` : null,
            detail?.source_name || null,
            detail?.year || videoYear || null,
          ]
            .filter(Boolean)
            .join(' · ')}
          actions={
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggleFavorite();
              }}
              className='inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-[rgb(var(--ui-text))] transition hover:bg-white/10'
              aria-label={favorited ? '取消收藏' : '收藏影片'}
              type='button'
            >
              <FavoriteIcon filled={favorited} />
              <span>{favorited ? '已收藏' : '收藏'}</span>
            </button>
          }
        />

        <div className='grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]'>
          <Surface variant='raised' className='min-w-0 overflow-hidden p-3'>
            <div className='relative aspect-video min-h-[260px] w-full overflow-hidden md:min-h-[360px] lg:min-h-[460px] 2xl:min-h-[620px]'>
              <div
                ref={artRef}
                className='play-page-player h-full w-full overflow-hidden rounded-ui-md bg-black shadow-ui-strong'
              ></div>

              {/* 跳过片头片尾控制器 */}
              {currentSource && currentId && videoTitle && (
                <SkipController
                  source={currentSource}
                  id={currentId}
                  title={videoTitle}
                  artPlayerRef={artPlayerRef}
                  currentTime={currentPlayTime}
                  duration={videoDuration}
                  isSettingMode={isSkipSettingMode}
                  onSettingModeChange={setIsSkipSettingMode}
                  onNextEpisode={handleNextEpisode}
                />
              )}

              {/* 换源加载蒙层 */}
              {isVideoLoading && (
                <PlayerLoadingOverlay stage={videoLoadingStage} />
              )}

              {playbackDebugEnabled && (
                <div className='absolute bottom-3 right-3 z-30 text-xs text-amber-50'>
                  {playbackDebugCollapsed ? (
                    <button
                      type='button'
                      onClick={() => setPlaybackDebugCollapsed(false)}
                      className='rounded-full border border-amber-400/40 bg-black/75 px-3 py-1.5 font-medium text-amber-100 shadow-ui-strong backdrop-blur transition hover:bg-black/90'
                    >
                      调试 · {playbackDebugEvents.length}
                    </button>
                  ) : (
                    <div className='w-[min(300px,calc(100vw-2rem))] overflow-hidden rounded-ui-md border border-amber-400/40 bg-black/80 p-2.5 shadow-ui-strong backdrop-blur'>
                      <div className='mb-2 flex items-center justify-between gap-2'>
                        <span className='font-semibold'>播放调试</span>
                        <button
                          type='button'
                          onClick={() => setPlaybackDebugCollapsed(true)}
                          className='rounded border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] text-amber-100 transition hover:bg-white/20'
                        >
                          收起
                        </button>
                      </div>
                      <div className='mb-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-amber-100/90'>
                        <div>
                          位置：{formatDebugPlaybackTime(currentPlayTime)}
                        </div>
                        <div>模式：{playbackMode}</div>
                        <div>
                          运行：
                          {playbackPolicyRef.current?.runtime || '-'}
                        </div>
                        <div>
                          分片：
                          {playbackPolicyRef.current?.segmentMode || '-'}
                        </div>
                        <div className='col-span-2 truncate'>
                          过滤：
                          {playbackPolicyRef.current?.playlistFilter || '-'}
                        </div>
                      </div>
                      <div className='max-h-24 space-y-1 overflow-hidden'>
                        {playbackDebugEvents.length === 0 ? (
                          <div className='text-amber-100/70'>
                            等待播放事件...
                          </div>
                        ) : (
                          playbackDebugEvents.slice(0, 3).map((event) => (
                            <div
                              key={`${event.createdAt}-${event.eventType}`}
                              className='rounded bg-white/5 px-2 py-1'
                            >
                              <div className='flex justify-between gap-2'>
                                <span className='truncate font-medium'>
                                  {event.eventType}
                                </span>
                                <span>
                                  {formatDebugPlaybackTime(event.currentTime)}
                                </span>
                              </div>
                              <div className='truncate text-amber-100/80'>
                                {event.message}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Surface>

          <PlayerSidebar className='min-w-0 2xl:sticky 2xl:top-24 2xl:self-start'>
            <div className='mb-4 flex items-center justify-between gap-3'>
              <div>
                <p className='text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--ui-accent-warm))]'>
                  播放控制
                </p>
                <h2 className='mt-1 text-lg font-semibold text-[rgb(var(--ui-text))]'>
                  选集与线路
                </h2>
              </div>
              {!isEpisodeSelectorCollapsed && (
                <button
                  onClick={() =>
                    setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
                  }
                  className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-[rgb(var(--ui-text-muted))] transition hover:bg-white/10 hover:text-[rgb(var(--ui-text))]'
                  title='隐藏选集面板'
                  type='button'
                >
                  隐藏
                </button>
              )}
            </div>

            <div
              className={`transition-all duration-300 ease-in-out ${
                isEpisodeSelectorCollapsed ? 'hidden' : 'block'
              }`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
                precomputedSourceStatuses={precomputedSourceStatuses}
                sourceSelectionScores={sourceSelectionScores}
              />
            </div>

            {isEpisodeSelectorCollapsed && (
              <button
                onClick={() => setIsEpisodeSelectorCollapsed(false)}
                className='w-full rounded-ui-md border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-[rgb(var(--ui-text))] transition hover:bg-white/10'
                title='显示选集面板'
                type='button'
              >
                显示选集
              </button>
            )}
          </PlayerSidebar>
        </div>

        {/* 详情展示 */}
        <Surface
          variant='plain'
          className='grid grid-cols-1 gap-4 overflow-hidden p-4 md:grid-cols-4'
        >
          {/* 文字区 */}
          <div className='md:col-span-3'>
            <div className='p-6 flex flex-col min-h-0'>
              {/* 标题 */}
              <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full'>
                {videoTitle || '影片标题'}
              </h1>

              {/* 关键信息行 */}
              <div className='flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0'>
                {detail?.class && (
                  <span className='font-semibold text-[rgb(var(--ui-success))]'>
                    {detail.class}
                  </span>
                )}
                {(detail?.year || videoYear) && (
                  <span>{detail?.year || videoYear}</span>
                )}
                {detail?.source_name && (
                  <span className='rounded border border-[rgba(var(--ui-text-muted),0.6)] px-2 py-[1px]'>
                    {detail.source_name}
                  </span>
                )}
                {detail?.type_name && <span>{detail.type_name}</span>}
              </div>
              {/* 剧情简介 */}
              {detail?.desc && (
                <div
                  className='mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {detail.desc}
                </div>
              )}
            </div>
          </div>

          {/* 封面展示 */}
          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-4 pr-6'>
              <div className='flex aspect-[2/3] items-center justify-center overflow-hidden rounded-ui-md bg-[rgb(var(--ui-surface))]'>
                {videoCover ? (
                  <img
                    src={processImageUrl(videoCover)}
                    alt={videoTitle}
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <span className='text-[rgb(var(--ui-text-muted))]'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </Surface>
      </div>
    </PageLayout>
  );
}

// FavoriteIcon 组件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7 text-[rgb(var(--ui-critical))]'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='currentColor'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-7 w-7 stroke-[1] text-[rgb(var(--ui-text-muted))]' />
  );
};

const PlayFallback = () => {
  return (
    <PageLayout activePath='/play'>
      <InitialLoadingOverlay message='正在准备播放环境...' stage='searching' />
    </PageLayout>
  );
};

export default function PlayPage() {
  return (
    <Suspense fallback={<PlayFallback />}>
      <PlayPageClient />
    </Suspense>
  );
}
