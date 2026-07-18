/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { AlertCircle, ArrowLeft, Heart, RefreshCw, Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useReducer, useRef, useState } from 'react';

import type { CastStatus } from '@/lib/cast';
import {
  castControlIcon,
  requestCastPlayback,
  resolveCastMediaUrl,
} from '@/lib/cast';
import {
  mergeAdSkipWindowsForLoad,
  type PersistedAdSkipWindow,
} from '@/lib/ad-skip-window';
import {
  deleteFavorite,
  generateStorageKey,
  getAdSkipConfig,
  getAllPlayRecords,
  isFavorited,
  recordAdSkipWindowConfirmation,
  saveFavorite,
  savePlayRecordKeys,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import type { M3U8AdFilterDebugInfo } from '@/lib/hls-ad-filter';
import {
  analyzeM3U8AdCandidates,
  formatM3U8AdFilterDebugMessage,
  observeM3U8AdSignals,
  snapClickToAdStructureBlock,
} from '@/lib/hls-ad-filter';
import {
  getHlsAdSkipWindowKey,
  type HlsAdSkipWindow,
  toHlsAdSkipWindows,
  toUserMarkAdSkipWindow,
} from '@/lib/hls-ad-skip';
import type { HlsPlaybackPolicyResult } from '@/lib/hls-playback-policy';
import {
  detectAppleNativeHlsEnvironment,
  detectPlaybackProbePlatform,
  resolveHlsPlaybackPolicy,
} from '@/lib/hls-playback-policy';
import {
  type HlsRecoveryAction,
  getHlsRecoveryGuardPlaybackUrl,
  getHlsRecoveryPlan,
  getHlsRecoveryProgressUpdate,
  shouldTriggerHlsWaitingRecovery,
} from '@/lib/hls-recovery';
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
  shouldReportNativePlaybackFailureFeedback,
  shouldResetNativeRecoveryOnPause,
} from '@/lib/native-video-recovery';
import {
  type PlayRecordSaveReason,
  type PlayRecordSaveSnapshot,
  getPlayRecordHeartbeatIntervalMs,
  shouldSavePlayRecord,
} from '@/lib/play-record-save-policy';
import {
  type PlaybackAttemptEvent,
  type PlaybackAttemptReporter,
  createPlaybackAttemptReporter,
  isPlaybackAttemptEnhancedReportingEnabled,
  sanitizePlaybackEvidenceUrl,
  summarizeUserAgent,
} from '@/lib/playback-attempt';
import {
  type PlaybackHistoryRecord,
  resolvePlaybackHistoryRecovery,
} from '@/lib/playback-history-recovery';
import {
  type PlaybackSessionEffect,
  type PlaybackSessionState,
  type VideoSnapshot,
  applySameSourceRecoverAction,
  createInitialPlaybackSessionState,
  executePlaybackSessionEffects,
  getPlaybackIntentAuthorityMode,
  getPlaybackRecoveryAuthorityMode,
  isPlaybackIntentSessionAuthorityEnabled,
  isPlaybackRecoverySessionAuthorityEnabled,
  reducePlaybackSession,
  resolveAdapterAutomaticEffectAllowed,
  resolveNativeJitterRouting,
} from '@/lib/playback-session';
import {
  clampSourceSwitchResumeTime,
  getSourceSwitchResumePlan,
  getSourceSwitchTargetEpisodeIndex,
  shouldIgnoreSourceChangeTimeout,
} from '@/lib/playback-source-switch';
import {
  type PlaybackBadPoint,
  planStallEscapeResume,
  readPersistedPlaybackBadPoints,
  rememberPlaybackBadPoint,
  writePersistedPlaybackBadPoints,
} from '@/lib/playback-stuck-escape';
import {
  createProgressiveSourceProbeFailureStatus,
  selectProgressiveSourceProbeCandidates,
  shouldStartProgressiveSourceProbe,
} from '@/lib/progressive-source-probe';
import { classifySearchResult } from '@/lib/search-category';
import {
  clearAttemptedLedgersOnEpisodeChange,
  clearAttemptedLedgersOnTitleChange,
} from '@/lib/source-availability/attempted-ledgers';
import { selectRecoveryCandidate } from '@/lib/source-availability/index';
import { fetchSourcePreferencesInBatches } from '@/lib/source-preference-client';
import { buildVideoInfoFromPreferenceResult } from '@/lib/source-preference-video-info';
import {
  buildSourceSelectionScores,
  sortSourcesBySelectionScore,
  SourceSelectionScore,
} from '@/lib/source-selection';
import {
  PlaybackFeedbackInput,
  SearchResult,
  SourcePlaybackMode,
  SourceStatus,
  SourceVideoInfo,
} from '@/lib/types';
import {
  buildHlsProxyUrl,
  createPlayableSourceStatus,
  createSourceStatus,
  getRememberedSourceStatusForSource,
  getSourceDomainFromEpisodes,
  getSourceIdentityKey,
  getVideoResolutionFromM3u8,
  rememberSourceDomainPreference,
  rememberSourcePlaybackQuality,
} from '@/lib/utils';
import {
  adaptWatchProgressPlayhead,
  buildWatchProgressContentKey,
  getWatchProgressAuthorityMode,
  isWatchProgressDualWriteEnabled,
  planEpisodeChangeSave,
  planLatestWatchProgressForContent,
  planWatchProgressWrite,
} from '@/lib/watch-progress';

import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';
import PlayDetailSection from '@/components/PlayDetailSection';
import InitialLoadingOverlay from '@/components/player/InitialLoadingOverlay';
import PlayerHeader from '@/components/player/PlayerHeader';
import PlayerLoadingOverlay from '@/components/player/PlayerLoadingOverlay';
import PlayerSidebar from '@/components/player/PlayerSidebar';
import PlayRecommendations from '@/components/PlayRecommendations';
import SkipController from '@/components/SkipController';
import Surface from '@/components/ui/Surface';

export const runtime = 'edge';

const SOURCE_PREFERENCE_FAST_BUDGET_MS = 500;
const SOURCE_SELECTION_DEEP_PROBE_TIMEOUT_MS = 1800;
const SOURCE_CHANGE_TIMEOUT_MS = 25000;
const PROGRESSIVE_SOURCE_PROBE_STABLE_DELAY_MS = 10000;
const PROGRESSIVE_SOURCE_PROBE_INTERVAL_MS = 20000;
const NATIVE_RECENT_BUFFER_ISSUE_WINDOW_MS = 30000;
const HLS_MANUAL_INTERACTION_GRACE_MS = 4000;
const HLS_SEEK_BUFFER_GRACE_MS = 10000;
const PROGRESSIVE_SOURCE_PROBE_LIMIT = 1;

type VideoLoadingStage = 'initing' | 'sourceChanging';

type VideoPlaybackUiState = {
  videoUrl: string;
  isVideoLoading: boolean;
  videoLoadingStage: VideoLoadingStage;
  playbackMode: SourcePlaybackMode;
};

type VideoPlaybackUiAction =
  | { type: 'url.clear' }
  | {
      type: 'url.start';
      videoUrl: string;
      playbackMode: SourcePlaybackMode;
      stage: VideoLoadingStage;
    }
  | { type: 'loading.start'; stage: VideoLoadingStage }
  | { type: 'loading.end' }
  | { type: 'playbackMode.set'; mode: SourcePlaybackMode };

const initialVideoPlaybackUiState: VideoPlaybackUiState = {
  videoUrl: '',
  isVideoLoading: true,
  videoLoadingStage: 'initing',
  playbackMode: 'direct',
};

function reduceVideoPlaybackUi(
  state: VideoPlaybackUiState,
  action: VideoPlaybackUiAction
): VideoPlaybackUiState {
  switch (action.type) {
    case 'url.clear':
      return { ...state, videoUrl: '' };
    case 'url.start':
      return {
        videoUrl: action.videoUrl,
        playbackMode: action.playbackMode,
        isVideoLoading: true,
        videoLoadingStage: action.stage,
      };
    case 'loading.start':
      return {
        ...state,
        isVideoLoading: true,
        videoLoadingStage: action.stage,
      };
    case 'loading.end':
      return { ...state, isVideoLoading: false };
    case 'playbackMode.set':
      return state.playbackMode === action.mode
        ? state
        : { ...state, playbackMode: action.mode };
    default:
      return state;
  }
}

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
    recoveryWaitingListener?: EventListener;
    recoveryPlayingListener?: EventListener;
    recoveryCanplayListener?: EventListener;
    recoveryErrorListener?: EventListener;
    recoveryTimeupdateListener?: EventListener;
    recoverySeekingListener?: EventListener;
    recoverySeekedListener?: EventListener;
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
  sourceChangeAttemptId?: number | null;
  contentKey?: string | null;
  episodeIndex?: number | null;
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
  /** Raw media playlist for session-local mark/snap (#37). */
  playlistContent?: string;
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

type PlaybackErrorKind =
  | 'missing-params'
  | 'not-found'
  | 'history-expired'
  | 'source-unavailable'
  | 'player'
  | 'generic';

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
  const [errorKind, setErrorKind] = useState<PlaybackErrorKind>('generic');
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
  const isFromPlayRecordEntry = searchParams.get('from') === 'playrecord';

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
  const [videoPlaybackUi, dispatchVideoPlaybackUi] = useReducer(
    reduceVideoPlaybackUi,
    initialVideoPlaybackUiState
  );
  const { videoUrl, isVideoLoading, videoLoadingStage, playbackMode } =
    videoPlaybackUi;

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);
  const playbackModeRef = useRef<SourcePlaybackMode>('direct');
  const originalVideoUrlRef = useRef('');
  const videoUrlRef = useRef('');
  const playbackAttemptReporterRef = useRef<PlaybackAttemptReporter>(
    createPlaybackAttemptReporter({
      enhancedReportingEnabled: isPlaybackAttemptEnhancedReportingEnabled(),
    })
  );
  const playbackDebugEnabledRef = useRef(false);
  const playbackAttemptChannelSkipEmittedRef = useRef(false);
  const playbackDebugLastCanplayRef =
    useRef<PlaybackDebugCanplaySnapshot | null>(null);
  const sourceFallbackAttemptedRef = useRef(false);
  const sourceSwitchSavePendingRef = useRef(false);
  const sourceDurationBeforeSwitchRef = useRef<number | null>(null);
  const sourceSwitchAutoPlayPendingRef = useRef(false);
  const playbackPolicyLogKeysRef = useRef(new Set<string>());
  const playbackPolicyRef = useRef<HlsPlaybackPolicyResult | null>(null);
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

  const setPlaybackError = (
    message: string,
    kind: PlaybackErrorKind = 'generic'
  ) => {
    setErrorKind(kind);
    setError(message);
  };

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
    dispatchVideoPlaybackUi({ type: 'playbackMode.set', mode });
  };

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
  const sourceChangeTimeoutTimerRef = useRef<number | null>(null);
  const sourceChangeAttemptIdRef = useRef(0);
  const lastPlaybackFailureFeedbackRef = useRef<{
    sourceKey: string;
    sessionError: string;
    reportedAt: number;
  } | null>(null);
  const progressiveSourceProbeTimerRef = useRef<number | null>(null);
  const progressiveSourceProbeInFlightRef = useRef(false);
  const progressiveSourceProbeStableStartedAtRef = useRef(0);
  const progressiveSourceProbeAttemptedKeysRef = useRef<Set<string>>(new Set());
  const autoRecoveredSourceKeysRef = useRef<Set<string>>(new Set());
  const attemptedLedgerTitleKeyRef = useRef<string | null>(null);
  const playbackSessionStateRef = useRef<PlaybackSessionState>(
    createInitialPlaybackSessionState({
      badPoints:
        typeof window !== 'undefined'
          ? readPersistedPlaybackBadPoints(window.sessionStorage)
          : [],
    })
  );
  const systemSeekInFlightRef = useRef(false);
  const hlsAutoSourceSwitchSessionRef = useRef<number | null>(null);
  const hlsRecoveryStateRef = useRef({
    stallCount: 0,
    stallWindowStartedAt: 0,
    stallWindowCount: 0,
    networkRecoveryAttempts: 0,
    mediaRecoveryAttempts: 0,
    lastErrorAt: 0,
    lastPlaybackTime: 0,
    lastProgressAt: 0,
    healthyWindowStartedAt: 0,
    healthyWindowStartedTime: 0,
    lastHealthyProgressAt: 0,
    lastRecoveryAction: 'ignore' as HlsRecoveryAction,
    lastRecoveryActionAt: 0,
    playbackSessionId: 0,
    userPausedAt: 0,
    userSeekingAt: 0,
    seekBufferGraceUntil: 0,
    manualInteractionUntil: 0,
    isSeeking: false,
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
  // 可撤销自动跳过提示（#36）：短时展示，一键恢复到窗口起点
  const [adSkipUndoToast, setAdSkipUndoToast] = useState<{
    windowKey: string;
    restoreTimeSeconds: number;
    dismissAfterMs: number;
  } | null>(null);
  const adSkipUndoDismissTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const adSkipLoadGenerationRef = useRef(0);
  const lastLoadedAnalyzerAdSkipSignatureRef = useRef<string | null>(null);
  // 最近一次媒体播放列表原文：手动标记广告时吸附到结构块边界（#37）
  const latestMediaPlaylistRef = useRef<{
    content: string;
    url: string;
  } | null>(null);

  const clearAdSkipUndoDismissTimer = () => {
    if (adSkipUndoDismissTimerRef.current) {
      clearTimeout(adSkipUndoDismissTimerRef.current);
      adSkipUndoDismissTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearAdSkipUndoDismissTimer();
    };
  }, []);

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
    const nextLedgers = clearAttemptedLedgersOnEpisodeChange({
      autoRecoveryAttempted: autoRecoveredSourceKeysRef.current,
      probeSchedulingAttempted: progressiveSourceProbeAttemptedKeysRef.current,
    });
    autoRecoveredSourceKeysRef.current = nextLedgers.autoRecoveryAttempted;
    progressiveSourceProbeAttemptedKeysRef.current =
      nextLedgers.probeSchedulingAttempted;
    playbackSessionStateRef.current = {
      ...playbackSessionStateRef.current,
      recoveredSourceKeys: new Set(nextLedgers.autoRecoveryAttempted),
      currentEpisodeIndex,
    };
    resetProgressiveSourceProbeStability();
  }, [currentEpisodeIndex]);

  useEffect(() => {
    const reporter = playbackAttemptReporterRef.current;
    return () => {
      const ended = reporter.endAttempt('leave');
      if (!ended || !playbackDebugEnabledRef.current) {
        return;
      }
      void fetch('/api/playback-debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: ended.sessionId,
          eventType: ended.eventType,
          sourceKey: ended.sourceKey ?? null,
          sourceChangeAttemptId: ended.sourceChangeAttemptId,
          contentKey: ended.contentKey ?? null,
          episodeIndex: ended.episodeIndex ?? null,
          runtime: ended.runtime ?? null,
          details: {
            message: 'Playback attempt ended on leave',
            ...ended.details,
          },
          userAgent: summarizeUserAgent(
            typeof navigator !== 'undefined' ? navigator.userAgent : null
          ),
        }),
        keepalive: true,
      }).catch(() => undefined);
    };
  }, []);

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  const getCurrentSourceKey = () =>
    getSourceIdentityKey(currentSourceRef.current, currentIdRef.current);

  const persistSessionBadPoints = (badPoints: PlaybackBadPoint[]) => {
    playbackSessionStateRef.current = {
      ...playbackSessionStateRef.current,
      badPoints,
    };
    if (typeof window !== 'undefined') {
      writePersistedPlaybackBadPoints(badPoints, window.sessionStorage);
    }
  };

  const rememberCurrentPlaybackBadPoint = (
    timeSeconds: number,
    sourceKey: string | null = getCurrentSourceKey()
  ) => {
    const nextBadPoints = rememberPlaybackBadPoint(
      playbackSessionStateRef.current.badPoints,
      {
        sourceKey,
        timeSeconds,
        nowMs: Date.now(),
      }
    );
    persistSessionBadPoints(nextBadPoints);
    return nextBadPoints;
  };

  const getCurrentVideoSnapshot = (): VideoSnapshot => {
    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    return {
      currentTime:
        typeof video?.currentTime === 'number'
          ? video.currentTime
          : artPlayerRef.current?.currentTime || 0,
      duration: typeof video?.duration === 'number' ? video.duration : null,
      readyState:
        typeof video?.readyState === 'number' ? video.readyState : null,
      networkState:
        typeof video?.networkState === 'number' ? video.networkState : null,
      paused: typeof video?.paused === 'boolean' ? video.paused : null,
      ended: typeof video?.ended === 'boolean' ? video.ended : null,
      playbackUrl:
        video?.currentSrc || video?.src || videoUrlRef.current || null,
    };
  };

  const buildPlaybackSessionSourceStatuses = (sources: SearchResult[]) => {
    const statuses = new Map(precomputedSourceStatusesRef.current);
    sources.forEach((source) => {
      const sourceKey = getSourceIdentityKey(source.source, source.id);
      const rememberedStatus = getRememberedSourceStatusForSource(
        sourceKey,
        source.episodes || []
      );
      if (
        rememberedStatus?.kind === 'unavailable' ||
        !statuses.has(sourceKey)
      ) {
        if (rememberedStatus) {
          statuses.set(sourceKey, rememberedStatus);
        }
      }
    });
    return statuses;
  };

  const getPlaybackContentKey = () =>
    buildWatchProgressContentKey({
      title: videoTitleRef.current || searchTitle || '',
      year: videoYearRef.current || '',
    });

  const settleSystemRecoverySeekIfNeeded = () => {
    if (!isPlaybackRecoverySessionAuthorityEnabled()) {
      return;
    }
    const inFlight = playbackSessionStateRef.current.recoveryInFlight;
    if (inFlight === 'R1' || inFlight === 'R2') {
      dispatchPlaybackSessionEvent({
        type: 'recovery.effectSettled',
        kind: inFlight,
        nowMs: Date.now(),
      });
      // Defense in depth: if anything still parks on resume after R2, clear it
      // in the same seeked tick (a second seeked will not fire).
      if (playbackSessionStateRef.current.recoveryInFlight === 'resume') {
        dispatchPlaybackSessionEvent({
          type: 'recovery.effectSettled',
          kind: 'resume',
          nowMs: Date.now(),
        });
      }
      return;
    }
    if (
      inFlight === 'resume' ||
      playbackSessionStateRef.current.recoveryResumeTime != null
    ) {
      dispatchPlaybackSessionEvent({
        type: 'recovery.effectSettled',
        kind: 'resume',
        nowMs: Date.now(),
      });
    }
  };

  const applySessionRecoveryResumeTime = (resumeTime: number) => {
    resumeTimeRef.current = resumeTime;
    sourceSwitchSavePendingRef.current = true;
    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    if (video && Number.isFinite(resumeTime) && resumeTime > 0) {
      systemSeekInFlightRef.current = true;
      video.currentTime = resumeTime;
    }
  };

  const applySessionSameSourceRecover = (
    effect: Extract<PlaybackSessionEffect, { type: 'sameSourceRecover' }>
  ) => {
    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    const hls = video?.hls as
      | {
          startLoad?: (startPosition?: number) => void;
          recoverMediaError?: () => void;
        }
      | undefined;

    let seeksPlayhead = false;
    applySameSourceRecoverAction(effect.action, effect.targetTime, {
      nudgePlayback: (targetTime) => {
        if (!video) {
          return;
        }
        if (targetTime != null) {
          systemSeekInFlightRef.current = true;
          seeksPlayhead = true;
          video.currentTime = targetTime;
        } else {
          seeksPlayhead = tryNudgePlayback(video);
        }
        void video.play().catch(() => undefined);
      },
      restartLoad: () => {
        hlsRecoveryStateRef.current.networkRecoveryAttempts += 1;
        hls?.startLoad?.(Math.max(0, (video?.currentTime || 0) - 1));
        void video?.play().catch(() => undefined);
      },
      recoverMedia: () => {
        hlsRecoveryStateRef.current.mediaRecoveryAttempts += 1;
        hls?.recoverMediaError?.();
        void video?.play().catch(() => undefined);
      },
      resumePlayback: (targetTime) => {
        if (video && targetTime != null) {
          systemSeekInFlightRef.current = true;
          seeksPlayhead = true;
          video.currentTime = targetTime;
        } else if (video) {
          seeksPlayhead = tryNudgePlayback(video);
        }
        void video?.play().catch(() => undefined);
      },
      escapeBadPoint: (targetTime) => {
        seeksPlayhead = true;
        applySessionRecoveryResumeTime(targetTime);
      },
    });

    // Seek-based R1/R2 stays in-flight until system seek settles (Ad Skip mutex).
    // Non-seek actions settle immediately so the ladder can continue.
    if (!seeksPlayhead) {
      dispatchPlaybackSessionEvent({
        type: 'recovery.effectSettled',
        kind: effect.stage,
        nowMs: Date.now(),
      });
    }
  };

  const resolveAdSkipWindowByKey = (
    windowKey: string
  ): HlsAdSkipWindow | undefined =>
    playbackSessionStateRef.current.adSkipWindows.find(
      (window) => getHlsAdSkipWindowKey(window) === windowKey
    );

  const persistAdSkipWindowConfirmation = (
    window: Pick<
      HlsAdSkipWindow,
      'startTimeSeconds' | 'endTimeSeconds' | 'ruleId'
    >,
    kind: 'confirm' | 'undo'
  ) => {
    const source = currentSourceRef.current;
    const id = currentIdRef.current;
    if (!source || !id) {
      return;
    }
    void recordAdSkipWindowConfirmation({
      source,
      id,
      episodeIndex: currentEpisodeIndexRef.current,
      window: {
        startTimeSeconds: window.startTimeSeconds,
        endTimeSeconds: window.endTimeSeconds,
        ruleId: window.ruleId,
      },
      kind,
    });
  };

  const dispatchPlaybackSessionEvent = (
    event: Parameters<typeof reducePlaybackSession>[1]
  ) => {
    const previousBadPoints = playbackSessionStateRef.current.badPoints;
    const result = reducePlaybackSession(
      playbackSessionStateRef.current,
      event
    );
    playbackSessionStateRef.current = result.state;
    autoRecoveredSourceKeysRef.current = new Set(
      result.state.recoveredSourceKeys
    );
    if (result.state.badPoints !== previousBadPoints) {
      if (typeof window !== 'undefined') {
        writePersistedPlaybackBadPoints(
          result.state.badPoints,
          window.sessionStorage
        );
      }
    }

    executePlaybackSessionEffects(result.effects, {
      onSwitchSource: () => {
        // Callers that need auto-switch consume switchSource from the result.
      },
      onSameSourceRecover: (effect) => {
        applySessionSameSourceRecover(effect);
      },
      onApplyRecoveryResume: (effect) => {
        applySessionRecoveryResumeTime(effect.resumeTime);
      },
      onCancelAdSkip: () => {
        // Session already emits adSkip.cancelled via emitDebugEvent.
      },
      onEmitDebugEvent: (effect) => {
        emitPlaybackDebugLog(effect.eventType, effect.message, effect.details);
      },
      onSkipAdWindow: (effect) => {
        // 全平台统一：Ad Skip Window 一律通过 seek 跳过（退役物理删分片）。
        const video = artPlayerRef.current?.video as
          | HTMLVideoElement
          | undefined;
        if (!video) {
          return;
        }
        const fromTime = video.currentTime || 0;
        systemSeekInFlightRef.current = true;
        video.currentTime = effect.targetTime;
        emitPlaybackDebugLog(
          'adSkip.completed',
          '已通过 seek 跳过广告时间窗',
          {
            windowKey: effect.windowKey,
            fromTime: Number(fromTime.toFixed(2)),
            targetTime: Number(effect.targetTime.toFixed(2)),
            platform: effect.platform,
          },
          {
            playbackUrl: videoUrlRef.current,
          }
        );
      },
      onShowAdSkipUndo: (effect) => {
        clearAdSkipUndoDismissTimer();
        setAdSkipUndoToast({
          windowKey: effect.windowKey,
          restoreTimeSeconds: effect.restoreTimeSeconds,
          dismissAfterMs: effect.dismissAfterMs,
        });
        adSkipUndoDismissTimerRef.current = setTimeout(() => {
          setAdSkipUndoToast((current) =>
            current?.windowKey === effect.windowKey ? null : current
          );
          adSkipUndoDismissTimerRef.current = null;
          // Keep Session recoverableAdSkip aligned with toast lifetime.
          dispatchPlaybackSessionEvent({
            type: 'adSkipUndo.dismissed',
            windowKey: effect.windowKey,
          });
          // Un-undone auto-skip / confirm: persist for crowd reuse (#38).
          // user-mark already persisted on mark — skip double-count.
          const window = resolveAdSkipWindowByKey(effect.windowKey);
          if (window && window.origin !== 'user-mark') {
            persistAdSkipWindowConfirmation(window, 'confirm');
          }
        }, effect.dismissAfterMs);
      },
      onRestoreAdSkipWindow: (effect) => {
        const video = artPlayerRef.current?.video as
          | HTMLVideoElement
          | undefined;
        if (!video) {
          return;
        }
        systemSeekInFlightRef.current = true;
        video.currentTime = effect.targetTime;
        clearAdSkipUndoDismissTimer();
        setAdSkipUndoToast(null);
      },
    });

    // Windows reload / undo / toast dismiss clear Session recoverable — drop UI.
    if (!result.state.recoverableAdSkip) {
      clearAdSkipUndoDismissTimer();
      setAdSkipUndoToast((current) => (current ? null : current));
    }

    return result;
  };

  /** Load shared persisted windows and merge with analyzer seeds (#38). */
  const loadMergedAdSkipWindows = async (
    analyzerWindows: HlsAdSkipWindow[]
  ) => {
    const generation = ++adSkipLoadGenerationRef.current;
    const source = currentSourceRef.current;
    const id = currentIdRef.current;
    const episodeIndex = currentEpisodeIndexRef.current;

    let persisted: PersistedAdSkipWindow[] = [];
    if (source && id) {
      try {
        const config = await getAdSkipConfig(source, id, episodeIndex);
        persisted = config?.windows ?? [];
      } catch {
        persisted = [];
      }
    }

    if (generation !== adSkipLoadGenerationRef.current) {
      return;
    }

    dispatchPlaybackSessionEvent({
      type: 'adSkipWindows.loaded',
      windows: mergeAdSkipWindowsForLoad({
        persisted,
        analyzer: analyzerWindows,
      }),
    });
  };

  const handleUndoAdSkip = () => {
    if (!adSkipUndoToast) {
      return;
    }
    const window = resolveAdSkipWindowByKey(adSkipUndoToast.windowKey);
    dispatchPlaybackSessionEvent({
      type: 'user.undoAdSkip',
      windowKey: adSkipUndoToast.windowKey,
      nowMs: Date.now(),
    });
    if (window) {
      persistAdSkipWindowConfirmation(window, 'undo');
    }
  };

  const handleMarkAdSkip = () => {
    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    const playlist = latestMediaPlaylistRef.current;
    const clickTimeSeconds = video?.currentTime ?? currentPlayTime;
    if (!playlist?.content || !Number.isFinite(clickTimeSeconds)) {
      artPlayerRef.current &&
        (artPlayerRef.current.notice.show =
          '暂无法标记：播放列表尚未就绪');
      emitPlaybackDebugLog('adSkip.mark-miss', '手动标记广告缺少播放列表', {
        clickTimeSeconds,
        hasPlaylist: Boolean(playlist?.content),
      });
      return;
    }

    const snapped = snapClickToAdStructureBlock(
      playlist.content,
      clickTimeSeconds,
      playlist.url
    );
    if (!snapped) {
      artPlayerRef.current &&
        (artPlayerRef.current.notice.show =
          '当前位置不在可识别的广告结构块内');
      emitPlaybackDebugLog(
        'adSkip.mark-miss',
        '手动标记广告未命中结构块（弱信号）',
        {
          clickTimeSeconds,
          playlistUrl: playlist.url,
        }
      );
      return;
    }

    const platform =
      playbackPolicyRef.current?.runtime === 'native-hls'
        ? 'apple-native'
        : 'hlsjs';
    const markedWindow = toUserMarkAdSkipWindow(snapped);
    dispatchPlaybackSessionEvent({
      type: 'user.markAdSkip',
      nowMs: Date.now(),
      platform,
      window: markedWindow,
    });
    persistAdSkipWindowConfirmation(markedWindow, 'confirm');
  };

  const syncPlaybackSessionSources = () => {
    const sources = availableSourcesRef.current;
    dispatchPlaybackSessionEvent({
      type: 'sources.loaded',
      sources,
      currentSourceKey: getCurrentSourceKey(),
      currentEpisodeIndex: currentEpisodeIndexRef.current,
      contentKey: getPlaybackContentKey(),
      sourceStatuses: buildPlaybackSessionSourceStatuses(sources),
      sourceScores: sourceSelectionScoresRef.current,
      measuredVideoInfo: precomputedVideoInfoRef.current,
      recoveredSourceKeys: autoRecoveredSourceKeysRef.current,
    });
  };

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

  function scheduleSourceChangeTimeout({
    source,
    targetIndex,
    resumeTime,
    reason,
  }: {
    source: SearchResult;
    targetIndex: number;
    resumeTime: number | null;
    reason?: string;
  }) {
    clearSourceChangeTimeoutTimer();
    if (typeof window === 'undefined') {
      return;
    }

    const sourceAttempt = playbackAttemptReporterRef.current.beginSourceAttempt({
      sourceKey: getSourceIdentityKey(source.source, source.id),
      reason: reason?.includes('auto') ? 'auto' : 'manual',
      episodeIndex: targetIndex,
      runtime: playbackPolicyRef.current?.runtime || null,
      contentKey: getPlaybackContentKey(),
    });
    publishPlaybackAttemptEvent(sourceAttempt, 'Source change started');
    const timeoutAttemptId = sourceAttempt.sourceChangeAttemptId || 1;
    sourceChangeAttemptIdRef.current = timeoutAttemptId;
    const timeoutSourceKey = getSourceIdentityKey(source.source, source.id);
    dispatchPlaybackSessionEvent({
      type: 'sourceChange.started',
      attemptId: timeoutAttemptId,
      sourceKey: timeoutSourceKey,
    });

    sourceChangeTimeoutTimerRef.current = window.setTimeout(() => {
      sourceChangeTimeoutTimerRef.current = null;
      syncPlaybackSessionSources();
      const timeoutResult = dispatchPlaybackSessionEvent({
        type: 'timer.sourceChangeTimeout',
        attemptId: timeoutAttemptId,
        sourceKey: timeoutSourceKey,
        nowMs: Date.now(),
        snapshot: getCurrentVideoSnapshot(),
      });

      if (
        shouldIgnoreSourceChangeTimeout({
          attemptId: timeoutAttemptId,
          currentAttemptId: sourceChangeAttemptIdRef.current,
          isVideoLoading: isVideoLoadingRef.current,
          timeoutSourceKey,
          currentSourceKey: getCurrentSourceKey(),
        })
      ) {
        return;
      }

      const isNativeVideo =
        playbackPolicyRef.current?.recoveryProfile === 'native-video';
      reportCurrentPlaybackFailureFeedback(
        isNativeVideo ? 'ios-source-change-timeout' : 'source-change-timeout',
        {
          force: true,
        }
      );
      dispatchVideoPlaybackUi({ type: 'loading.end' });
      emitPlaybackDebugLog(
        'switch-source-timeout',
        isNativeVideo
          ? '原生播放器换源后长时间未进入可播放状态'
          : '播放源换源后长时间未进入可播放状态',
        {
          reason,
          sourceKey: timeoutSourceKey,
          source: source.source,
          id: source.id,
          currentEpisodeIndex: targetIndex,
          resumeTime,
          runtime: playbackPolicyRef.current?.runtime,
          recoveryProfile: playbackPolicyRef.current?.recoveryProfile,
        }
      );

      const switchEffect = timeoutResult.effects.find(
        (
          effect
        ): effect is Extract<PlaybackSessionEffect, { type: 'switchSource' }> =>
          effect.type === 'switchSource'
      );
      if (switchEffect) {
        void handleSourceChange(
          switchEffect.source.source,
          switchEffect.source.id,
          switchEffect.source.title,
          {
            autoRecovery: true,
            resumeTime: switchEffect.resumeTime,
            reason: '播放源加载超时，自动切换到其他播放源',
            autoPlayAfterReady: true,
          }
        ).then((switched) => {
          if (!switched) {
            dispatchPlaybackSessionEvent({
              type: 'recovery.switchFailed',
              sourceKey: switchEffect.sourceKey,
            });
          }
        });
        return;
      }

      void trySwitchToNextAvailableSource(
        isNativeVideo
          ? 'iOS 原生播放源加载超时，自动切换到其他播放源'
          : '播放源加载超时，自动切换到其他播放源'
      );
    }, SOURCE_CHANGE_TIMEOUT_MS);
  }

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

  const clearSourceChangeTimeoutTimer = () => {
    if (
      typeof window !== 'undefined' &&
      sourceChangeTimeoutTimerRef.current !== null
    ) {
      window.clearTimeout(sourceChangeTimeoutTimerRef.current);
      sourceChangeTimeoutTimerRef.current = null;
    }
  };

  const clearProgressiveSourceProbeTimer = () => {
    if (
      typeof window !== 'undefined' &&
      progressiveSourceProbeTimerRef.current !== null
    ) {
      window.clearTimeout(progressiveSourceProbeTimerRef.current);
      progressiveSourceProbeTimerRef.current = null;
    }
  };

  const resetProgressiveSourceProbeStability = () => {
    clearProgressiveSourceProbeTimer();
    progressiveSourceProbeStableStartedAtRef.current = 0;
  };

  const resetHlsRecoveryCounters = () => {
    clearWaitingRecoveryTimer();
    clearNativeWatchdogTimer();
    clearNativeFalsePlayingTimer();
    clearSourceChangeTimeoutTimer();
    resetProgressiveSourceProbeStability();
    hlsRecoveryStateRef.current.stallCount = 0;
    hlsRecoveryStateRef.current.stallWindowStartedAt = 0;
    hlsRecoveryStateRef.current.stallWindowCount = 0;
    hlsRecoveryStateRef.current.networkRecoveryAttempts = 0;
    hlsRecoveryStateRef.current.mediaRecoveryAttempts = 0;
    hlsRecoveryStateRef.current.lastErrorAt = 0;
    hlsRecoveryStateRef.current.lastPlaybackTime = 0;
    hlsRecoveryStateRef.current.lastProgressAt = 0;
    hlsRecoveryStateRef.current.healthyWindowStartedAt = 0;
    hlsRecoveryStateRef.current.healthyWindowStartedTime = 0;
    hlsRecoveryStateRef.current.lastHealthyProgressAt = 0;
    hlsRecoveryStateRef.current.lastRecoveryAction = 'ignore';
    hlsRecoveryStateRef.current.lastRecoveryActionAt = 0;
    hlsRecoveryStateRef.current.userPausedAt = 0;
    hlsRecoveryStateRef.current.userSeekingAt = 0;
    hlsRecoveryStateRef.current.seekBufferGraceUntil = 0;
    hlsRecoveryStateRef.current.manualInteractionUntil = 0;
    hlsRecoveryStateRef.current.isSeeking = false;
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

  const startHlsPlaybackSession = () => {
    clearWaitingRecoveryTimer();
    resetProgressiveSourceProbeStability();
    const state = hlsRecoveryStateRef.current;
    state.playbackSessionId += 1;
    state.userPausedAt = 0;
    state.userSeekingAt = 0;
    state.seekBufferGraceUntil = 0;
    state.manualInteractionUntil = 0;
    state.isSeeking = false;
  };

  const markHlsUserPause = (currentTime?: number) => {
    const now = Date.now();
    dispatchPlaybackSessionEvent({ type: 'user.pause' });
    const state = hlsRecoveryStateRef.current;
    clearWaitingRecoveryTimer();
    state.userPausedAt = now;
    state.manualInteractionUntil = now + HLS_MANUAL_INTERACTION_GRACE_MS;
    state.isSeeking = false;
    state.seekBufferGraceUntil = 0;
    resetHlsStallWindow('user-pause', currentTime);
  };

  const markHlsUserPlay = () => {
    const now = Date.now();
    dispatchPlaybackSessionEvent({ type: 'user.play' });
    const state = hlsRecoveryStateRef.current;
    clearWaitingRecoveryTimer();
    state.userPausedAt = 0;
    state.manualInteractionUntil = now + HLS_MANUAL_INTERACTION_GRACE_MS;
  };

  const markHlsUserSeeking = (currentTime?: number) => {
    const now = Date.now();
    dispatchPlaybackSessionEvent({ type: 'user.seekStarted', nowMs: now });
    const state = hlsRecoveryStateRef.current;
    clearWaitingRecoveryTimer();
    state.userSeekingAt = now;
    state.isSeeking = true;
    state.manualInteractionUntil = now + HLS_MANUAL_INTERACTION_GRACE_MS;
    state.seekBufferGraceUntil = now + HLS_SEEK_BUFFER_GRACE_MS;
    resetHlsStallWindow('user-seeking', currentTime);
  };

  const markHlsUserSeeked = (currentTime?: number) => {
    const now = Date.now();
    dispatchPlaybackSessionEvent({ type: 'user.seekSettled', nowMs: now });
    const state = hlsRecoveryStateRef.current;
    clearWaitingRecoveryTimer();
    state.isSeeking = false;
    state.manualInteractionUntil = now + HLS_MANUAL_INTERACTION_GRACE_MS;
    state.seekBufferGraceUntil = now + HLS_SEEK_BUFFER_GRACE_MS;
    resetHlsStallWindow('user-seeked', currentTime);
  };

  const isSessionAutomaticEffectAllowed = (
    kind: 'ad-skip' | 'same-source-recovery' | 'auto-source-switch',
    nowMs: number,
    legacyIsUserPaused: boolean
  ) =>
    resolveAdapterAutomaticEffectAllowed({
      kind,
      nowMs,
      sessionState: playbackSessionStateRef.current,
      legacyIsUserPaused,
    });

  const markPlaybackHealthy = (currentTime?: number) => {
    if (
      isPlaybackRecoverySessionAuthorityEnabled() &&
      playbackSessionStateRef.current.stallEpisodeActive
    ) {
      dispatchPlaybackSessionEvent({
        type: 'recovery.progressHealthy',
        nowMs: Date.now(),
        snapshot: {
          currentTime:
            typeof currentTime === 'number'
              ? currentTime
              : getCurrentVideoSnapshot().currentTime,
        },
      });
    }

    if (typeof currentTime === 'number') {
      const lastPlaybackTime = hlsRecoveryStateRef.current.lastPlaybackTime;
      if (currentTime > lastPlaybackTime + 0.25) {
        clearWaitingRecoveryTimer();
        nativeRecoveryStateRef.current.stallCount = 0;
        nativeRecoveryStateRef.current.sourceRecoveryAttempts = 0;
        nativeRecoveryStateRef.current.lastProgressAt = Date.now();
      }
      hlsRecoveryStateRef.current.lastPlaybackTime = currentTime;
      nativeRecoveryStateRef.current.lastObservedTime = currentTime;
      return;
    }

    clearWaitingRecoveryTimer();
    nativeRecoveryStateRef.current.stallCount = 0;
    nativeRecoveryStateRef.current.sourceRecoveryAttempts = 0;
  };

  const resetHlsStallWindow = (reason: string, currentTime?: number) => {
    const state = hlsRecoveryStateRef.current;
    const hadActiveWindow = state.stallWindowCount > 0 || state.stallCount > 0;
    state.stallCount = 0;
    state.stallWindowStartedAt = 0;
    state.stallWindowCount = 0;
    state.networkRecoveryAttempts = 0;
    state.mediaRecoveryAttempts = 0;
    state.lastErrorAt = 0;
    state.lastRecoveryAction = 'ignore';
    state.lastRecoveryActionAt = 0;
    if (typeof currentTime === 'number') {
      state.lastPlaybackTime = currentTime;
      state.lastProgressAt = Date.now();
      state.healthyWindowStartedAt = state.lastProgressAt;
      state.healthyWindowStartedTime = currentTime;
      state.lastHealthyProgressAt = state.lastProgressAt;
    }

    if (hadActiveWindow) {
      emitPlaybackDebugLog('hls-stall-window-reset', 'HLS.js 卡顿窗口已重置', {
        reason,
        currentTime: Number((currentTime || 0).toFixed(2)),
      });
    }
  };

  const markHlsPlaybackProgress = (currentTime: number) => {
    const state = hlsRecoveryStateRef.current;
    const now = Date.now();
    const update = getHlsRecoveryProgressUpdate({
      currentTime,
      now,
      lastProgressTime: state.lastPlaybackTime,
      lastProgressAt: state.lastProgressAt,
      healthyWindowStartedAt: state.healthyWindowStartedAt,
      healthyWindowStartedTime: state.healthyWindowStartedTime,
      hasActiveStallWindow: state.stallWindowCount > 0 || state.stallCount > 0,
    });

    state.lastPlaybackTime = update.lastProgressTime;
    state.lastProgressAt = update.lastProgressAt;
    state.healthyWindowStartedAt = update.healthyWindowStartedAt;
    state.healthyWindowStartedTime = update.healthyWindowStartedTime;

    if (update.healthy) {
      state.lastHealthyProgressAt = now;
      resetHlsStallWindow('playback-progress-healthy', currentTime);
    }
  };

  const getNextRecoverySource = () => {
    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    const currentPlayTime =
      typeof video?.currentTime === 'number'
        ? video.currentTime
        : artPlayerRef.current?.currentTime || 0;
    const selected = selectRecoveryCandidate({
      sources: availableSourcesRef.current,
      currentSourceKey: getCurrentSourceKey(),
      currentEpisodeIndex: currentEpisodeIndexRef.current,
      statuses: buildPlaybackSessionSourceStatuses(availableSourcesRef.current),
      measured: precomputedVideoInfoRef.current,
      sourceSelectionScores: sourceSelectionScoresRef.current,
      attemptedSourceKeys: autoRecoveredSourceKeysRef.current,
      allowUnverifiedFallback:
        isVideoLoadingRef.current || currentPlayTime < 1,
    });
    return selected?.source;
  };

  const tryNudgePlayback = (video: HTMLVideoElement | null) => {
    if (!video) {
      return false;
    }

    const buffered = video.buffered;
    const currentTime = video.currentTime || 0;
    const escape = planStallEscapeResume({
      currentPlayTime: currentTime,
      badPoints: playbackSessionStateRef.current.badPoints,
      sourceKey: getCurrentSourceKey(),
      mode: 'same-source',
    });
    if (escape.action === 'skip-forward' && escape.resumeTime != null) {
      if (escape.recordBadPointAt != null) {
        rememberCurrentPlaybackBadPoint(escape.recordBadPointAt);
      }
      systemSeekInFlightRef.current = true;
      video.currentTime = escape.resumeTime;
      return true;
    }
    if (escape.recordBadPointAt != null) {
      rememberCurrentPlaybackBadPoint(escape.recordBadPointAt);
    }

    const bufferedRanges = Array.from(
      { length: buffered.length },
      (_, index) => ({
        start: buffered.start(index),
        end: buffered.end(index),
      })
    );

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

  const reportCurrentPlaybackFailureFeedback = (
    sessionError: string,
    options: { force?: boolean } = {}
  ) => {
    const sourceKey = getCurrentSourceKey();
    if (!sourceKey) {
      return;
    }

    const now = Date.now();
    const last = lastPlaybackFailureFeedbackRef.current;
    if (
      !options.force &&
      last &&
      last.sourceKey === sourceKey &&
      last.sessionError === sessionError &&
      now - last.reportedAt < 60000
    ) {
      return;
    }

    lastPlaybackFailureFeedbackRef.current = {
      sourceKey,
      sessionError,
      reportedAt: now,
    };

    const startupTimeMs =
      playbackStartupStartedAtRef.current &&
      playbackStartupStartedAtRef.current > 0
        ? now - playbackStartupStartedAtRef.current
        : undefined;

    rememberCurrentSourcePlaybackQuality({
      mode: 'unavailable',
      startupTimeMs,
      lastError: sessionError,
      confidence: 'medium',
    });
    void reportPlaybackFeedback({
      sourceKey,
      playbackDomain: getCurrentPlaybackDomain(),
      title: videoTitleRef.current,
      playbackMode: playbackModeRef.current,
      startupSuccess: false,
      startupTimeMs,
      switchedToProxy: playbackModeRef.current === 'proxy',
      sessionError,
    });
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

  const sendPlaybackDebugLog = async (payload: PlaybackDebugLogPayload) => {
    try {
      const response = await fetch('/api/playback-debug', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      let transport: {
        saved?: boolean;
        skipped?: boolean;
        reason?: string;
      } = {};
      try {
        transport = (await response.json()) as typeof transport;
      } catch {
        transport = {
          saved: false,
          skipped: true,
          reason: 'network-error',
        };
      }

      if (transport.skipped) {
        const skipped = playbackAttemptReporterRef.current.resolveTransportResult(
          {
            eventType: payload.eventType,
            transport,
          }
        );
        if (skipped) {
          setPlaybackDebugEvents((prev) =>
            [
              {
                eventType: skipped.eventType,
                message: `channel.skipped:${String(skipped.details?.reason || 'unknown')}`,
                createdAt: Date.now(),
                details: skipped.details,
              },
              ...prev,
            ].slice(0, 20)
          );
        }
      }
    } catch {
      const skipped = playbackAttemptReporterRef.current.resolveTransportResult({
        eventType: payload.eventType,
        transport: {
          saved: false,
          skipped: true,
          reason: 'network-error',
        },
      });
      if (skipped) {
        setPlaybackDebugEvents((prev) =>
          [
            {
              eventType: skipped.eventType,
              message: 'channel.skipped:network-error',
              createdAt: Date.now(),
              details: skipped.details,
            },
            ...prev,
          ].slice(0, 20)
        );
      }
    }
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

  const publishPlaybackAttemptEvent = (
    reported: PlaybackAttemptEvent,
    message = reported.eventType
  ) => {
    const videoSnapshot = getPlaybackDebugVideoSnapshot();
    const policy = playbackPolicyRef.current;
    const sanitizedPlayback = sanitizePlaybackEvidenceUrl(
      typeof reported.playbackUrl === 'string' ? reported.playbackUrl : null
    );

    if (!playbackDebugEnabledRef.current) {
      if (!playbackAttemptChannelSkipEmittedRef.current) {
        playbackAttemptChannelSkipEmittedRef.current = true;
        const skipped =
          playbackAttemptReporterRef.current.resolveTransportResult({
            eventType: reported.eventType,
            transport: { saved: false, skipped: true, reason: 'admin-off' },
          });
        if (skipped) {
          setPlaybackDebugEvents((prev) =>
            [
              {
                eventType: skipped.eventType,
                message: 'channel.skipped:admin-off',
                createdAt: Date.now(),
                details: skipped.details,
              },
              ...prev,
            ].slice(0, 20)
          );
        }
      }
      return;
    }

    setPlaybackDebugEvents((prev) =>
      [
        {
          eventType: reported.eventType,
          message,
          createdAt: Date.now(),
          currentTime: videoSnapshot.currentTime,
          details: reported.details,
        },
        ...prev,
      ].slice(0, 20)
    );

    void sendPlaybackDebugLog({
      sessionId: reported.sessionId,
      eventType: reported.eventType,
      sourceKey: reported.sourceKey ?? null,
      sourceChangeAttemptId: reported.sourceChangeAttemptId,
      contentKey: reported.contentKey ?? null,
      episodeIndex: reported.episodeIndex ?? null,
      playbackUrl: sanitizedPlayback.playbackUrl,
      title: videoTitleRef.current || null,
      runtime: reported.runtime ?? policy?.runtime ?? null,
      playlistFilter: policy?.playlistFilter || null,
      segmentMode: policy?.segmentMode || null,
      recoveryProfile: policy?.recoveryProfile || null,
      ...videoSnapshot,
      details: {
        message,
        ...reported.details,
      },
      userAgent: summarizeUserAgent(
        typeof navigator !== 'undefined' ? navigator.userAgent : null
      ),
    });
  };

  const emitPlaybackDebugLog = (
    eventType: string,
    message: string,
    details: Record<string, unknown> = {},
    options: PlaybackDebugEmitOptions = {}
  ) => {
    const policy = options.policy ?? playbackPolicyRef.current;
    const detailPlaybackUrl =
      typeof details.playbackUrl === 'string' ? details.playbackUrl : null;
    const effectivePlaybackUrl =
      options.playbackUrl ?? detailPlaybackUrl ?? videoUrlRef.current ?? null;

    if (
      eventType === 'video-canplay' &&
      shouldSkipCanplayDebugLog(
        effectivePlaybackUrl,
        getPlaybackDebugVideoSnapshot()
      )
    ) {
      return;
    }

    const isProbeEvent = eventType.startsWith('progressive-source-probe');
    const reported = isProbeEvent
      ? playbackAttemptReporterRef.current.reportProbeEvent({
          eventType,
          sourceKey: getCurrentSourceKey() || null,
          details: { message, ...details },
        })
      : playbackAttemptReporterRef.current.report({
          eventType,
          details: { message, ...details },
          contentKey: getPlaybackContentKey(),
          episodeIndex: currentEpisodeIndexRef.current,
          sourceKey: getCurrentSourceKey() || null,
          runtime: policy?.runtime || null,
          playbackUrl: effectivePlaybackUrl,
        });

    publishPlaybackAttemptEvent(reported, message);
  };

  useEffect(() => {
    const titleKey = `${videoTitle}::${videoYear}`;
    const previousTitleKey = attemptedLedgerTitleKeyRef.current;
    attemptedLedgerTitleKeyRef.current = titleKey;

    if (previousTitleKey === null) {
      playbackAttemptChannelSkipEmittedRef.current = false;
      const started = playbackAttemptReporterRef.current.beginAttempt({
        contentKey: buildWatchProgressContentKey({
          title: videoTitle,
          year: videoYear,
        }),
        episodeIndex: currentEpisodeIndexRef.current,
        sourceKey: getSourceIdentityKey(
          currentSourceRef.current,
          currentIdRef.current
        ),
        runtime: playbackPolicyRef.current?.runtime || null,
      });
      publishPlaybackAttemptEvent(started, 'Playback attempt started');
      return;
    }

    if (previousTitleKey === titleKey) {
      return;
    }

    playbackAttemptChannelSkipEmittedRef.current = false;
    const { ended, started } = playbackAttemptReporterRef.current.changeTitle({
      contentKey: buildWatchProgressContentKey({
        title: videoTitle,
        year: videoYear,
      }),
      episodeIndex: currentEpisodeIndexRef.current,
      sourceKey: getSourceIdentityKey(
        currentSourceRef.current,
        currentIdRef.current
      ),
      runtime: playbackPolicyRef.current?.runtime || null,
    });
    publishPlaybackAttemptEvent(
      ended,
      'Playback attempt ended on title change'
    );
    publishPlaybackAttemptEvent(started, 'Playback attempt started');

    const nextLedgers = clearAttemptedLedgersOnTitleChange();
    autoRecoveredSourceKeysRef.current = nextLedgers.autoRecoveryAttempted;
    progressiveSourceProbeAttemptedKeysRef.current =
      nextLedgers.probeSchedulingAttempted;
    playbackSessionStateRef.current = {
      ...playbackSessionStateRef.current,
      recoveredSourceKeys: new Set(),
    };
    resetProgressiveSourceProbeStability();
  }, [videoTitle, videoYear]);

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

  const rememberCurrentSourcePlaybackQuality = (input: {
    mode: SourcePlaybackMode | 'unavailable';
    startupTimeMs?: number;
    browserSpeedLabel?: string;
    confidence?: 'low' | 'medium' | 'high';
    lastError?: string;
  }) => {
    rememberSourcePlaybackQuality(
      getCurrentSourceKey(),
      getCurrentPlaybackDomain(),
      input
    );
  };

  const runProgressiveSourceProbe = async () => {
    const probePlatform = getPlaybackProbePlatform();
    if (probePlatform === 'apple-native') {
      clearProgressiveSourceProbeTimer();
      progressiveSourceProbeStableStartedAtRef.current = 0;
      return;
    }

    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    const now = Date.now();
    const hlsState = hlsRecoveryStateRef.current;
    const sessionId = hlsState.playbackSessionId;
    const shouldStart = shouldStartProgressiveSourceProbe({
      now,
      stablePlaybackStartedAt: progressiveSourceProbeStableStartedAtRef.current,
      stablePlaybackDelayMs: PROGRESSIVE_SOURCE_PROBE_STABLE_DELAY_MS,
      isPaused: Boolean(video?.paused),
      isEnded: Boolean(video?.ended),
      isSeeking: Boolean(video?.seeking) || hlsState.isSeeking,
      isVideoLoading: isVideoLoadingRef.current,
      isRecoveryActive:
        waitingRecoveryTimerRef.current !== null ||
        hlsState.stallCount > 0 ||
        hlsState.stallWindowCount > 0 ||
        nativeRecoveryStateRef.current.stallCount > 0,
      inFlight: progressiveSourceProbeInFlightRef.current,
    });

    if (!shouldStart) {
      return;
    }

    const candidates = selectProgressiveSourceProbeCandidates({
      sources: availableSourcesRef.current,
      currentSourceKey: getCurrentSourceKey(),
      attemptedSourceKeys: progressiveSourceProbeAttemptedKeysRef.current,
      statuses: precomputedSourceStatusesRef.current,
      scores: sourceSelectionScoresRef.current,
      currentEpisodeIndex: currentEpisodeIndexRef.current,
      limit: PROGRESSIVE_SOURCE_PROBE_LIMIT,
      getSourceKey: (source) => getSourceIdentityKey(source.source, source.id),
    });
    const candidate = candidates[0];

    if (!candidate) {
      progressiveSourceProbeStableStartedAtRef.current = Date.now();
      return;
    }

    const sourceKey = getSourceIdentityKey(candidate.source, candidate.id);
    const episodeUrl = candidate.episodes[currentEpisodeIndexRef.current];
    const domain = getSourceDomainFromEpisodes(candidate.episodes);
    const previousStatus =
      precomputedSourceStatusesRef.current.get(sourceKey) ?? null;
    progressiveSourceProbeAttemptedKeysRef.current.add(sourceKey);
    progressiveSourceProbeInFlightRef.current = true;

    const previousStatuses = new Map(precomputedSourceStatusesRef.current);
    previousStatuses.set(
      sourceKey,
      createSourceStatus('probing', {
        domain,
        reason: '后台测速中',
      })
    );
    setPrecomputedSourceStatuses(previousStatuses);

    emitPlaybackDebugLog(
      'progressive-source-probe-start',
      '开始后台测速候选源',
      {
        sourceKey,
        source: candidate.source,
        sourceId: candidate.id,
        domain,
      }
    );

    try {
      const testResult = await getVideoResolutionFromM3u8(episodeUrl, {
        timeoutMs: SOURCE_SELECTION_DEEP_PROBE_TIMEOUT_MS,
      });

      if (hlsRecoveryStateRef.current.playbackSessionId === sessionId) {
        const nextVideoInfo = new Map(precomputedVideoInfoRef.current);
        nextVideoInfo.set(sourceKey, testResult);
        setPrecomputedVideoInfo(nextVideoInfo);

        const nextStatuses = new Map(precomputedSourceStatusesRef.current);
        nextStatuses.set(
          sourceKey,
          createSourceStatus('direct', {
            reason: '本机后台测速通过',
            playbackMode: 'direct',
            domain,
            measured: testResult,
            fromMemory: true,
            localConfidence: 'medium',
          })
        );
        setPrecomputedSourceStatuses(nextStatuses);
        updateSourceSelectionScores(
          availableSourcesRef.current,
          nextStatuses,
          nextVideoInfo
        );
        rememberSourcePlaybackQuality(sourceKey, domain, {
          mode: 'direct',
          browserSpeedLabel: testResult.loadSpeed,
          confidence: 'medium',
        });
        emitPlaybackDebugLog(
          'progressive-source-probe-success',
          '候选源后台测速通过',
          {
            sourceKey,
            quality: testResult.quality,
            loadSpeed: testResult.loadSpeed,
            pingTime: testResult.pingTime,
          }
        );
      }
    } catch (error) {
      if (hlsRecoveryStateRef.current.playbackSessionId === sessionId) {
        const reason = error instanceof Error ? error.message : '后台测速失败';
        const nextStatuses = new Map(precomputedSourceStatusesRef.current);
        nextStatuses.set(
          sourceKey,
          createProgressiveSourceProbeFailureStatus({
            domain,
            reason,
          })
        );
        const nextVideoInfo = new Map(precomputedVideoInfoRef.current);
        nextVideoInfo.set(sourceKey, {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
          errorReason: reason,
        });
        setPrecomputedSourceStatuses(nextStatuses);
        setPrecomputedVideoInfo(nextVideoInfo);
        updateSourceSelectionScores(
          availableSourcesRef.current,
          nextStatuses,
          nextVideoInfo
        );
        rememberSourcePlaybackQuality(sourceKey, domain, {
          mode: 'unavailable',
          lastError: reason,
          confidence: 'low',
        });
        emitPlaybackDebugLog(
          'progressive-source-probe-failed',
          '候选源后台测速失败',
          {
            sourceKey,
            reason,
          }
        );
      }
    } finally {
      progressiveSourceProbeInFlightRef.current = false;
      if (hlsRecoveryStateRef.current.playbackSessionId !== sessionId) {
        progressiveSourceProbeAttemptedKeysRef.current.delete(sourceKey);
        const restoredStatuses = new Map(precomputedSourceStatusesRef.current);
        if (restoredStatuses.get(sourceKey)?.kind === 'probing') {
          if (previousStatus) {
            restoredStatuses.set(sourceKey, previousStatus);
          } else {
            restoredStatuses.delete(sourceKey);
          }
          setPrecomputedSourceStatuses(restoredStatuses);
        }
      } else if (typeof window !== 'undefined') {
        clearProgressiveSourceProbeTimer();
        progressiveSourceProbeTimerRef.current = window.setTimeout(() => {
          progressiveSourceProbeTimerRef.current = null;
          void runProgressiveSourceProbe();
        }, PROGRESSIVE_SOURCE_PROBE_INTERVAL_MS);
      }
    }
  };

  const scheduleProgressiveSourceProbe = () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (progressiveSourceProbeStableStartedAtRef.current <= 0) {
      progressiveSourceProbeStableStartedAtRef.current = Date.now();
    }

    if (progressiveSourceProbeTimerRef.current !== null) {
      return;
    }

    const delay = Math.max(
      0,
      PROGRESSIVE_SOURCE_PROBE_STABLE_DELAY_MS -
        (Date.now() - progressiveSourceProbeStableStartedAtRef.current)
    );
    progressiveSourceProbeTimerRef.current = window.setTimeout(() => {
      progressiveSourceProbeTimerRef.current = null;
      void runProgressiveSourceProbe();
    }, delay);
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
      rememberedStatus: getRememberedSourceStatusForSource(
        getSourceIdentityKey(source.source, source.id),
        source.episodes
      ),
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

    const applyPreferenceResults = (
      preferenceData: Awaited<
        ReturnType<typeof fetchSourcePreferencesInBatches>
      >
    ) => {
      preferenceData.results.forEach((result) => {
        const existingStatus = statusMap.get(result.sourceKey);
        const measured = buildVideoInfoFromPreferenceResult(result);
        const canRescueFromMemory =
          existingStatus?.kind === 'unavailable' &&
          result.kind !== 'unavailable';

        if (existingStatus?.fromMemory && !canRescueFromMemory) {
          statusMap.set(result.sourceKey, {
            ...existingStatus,
            rankScore: result.rankScore,
            rankingSource: result.rankingSource,
            updatedAt: Math.max(
              existingStatus.updatedAt || 0,
              result.updatedAt || 0
            ),
          });
          return;
        }

        const statusOptions = {
          reason: result.reason,
          playbackMode: result.kind === 'unavailable' ? undefined : result.kind,
          domain: result.domain || existingStatus?.domain || null,
          measured: measured || undefined,
          updatedAt: result.updatedAt,
          rankingSource: result.rankingSource,
          rankScore: result.rankScore,
        };
        const nextStatus =
          canRescueFromMemory && (!measured || measured.speedPending)
            ? createPlayableSourceStatus({
                ...statusOptions,
                reason: result.reason || '后端检测通过，可尝试播放',
              })
            : createSourceStatus(result.kind, statusOptions);

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
      void preferencePromise.then(applyPreferenceResults).catch((error) => {
        console.warn('后台线路优选读取失败', error);
      });
    }

    let selectionScores = commitSelectionState();
    selectionScores = sourceSelectionScoresRef.current.size
      ? sourceSelectionScoresRef.current
      : selectionScores;
    const finalSource = sortSourcesBySelectionScore(
      sources,
      selectionScores,
      (source) => getSourceIdentityKey(source.source, source.id)
    ).find((source) => {
      const status = statusMap.get(
        getSourceIdentityKey(source.source, source.id)
      );
      return status?.kind !== 'unavailable';
    });

    console.log('播放源优选结果:', {
      selected: finalSource?.source_name,
      waitedMs: Date.now() - startedAt,
      progressiveProbe: true,
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
      dispatchVideoPlaybackUi({ type: 'url.clear' });
      return;
    }
    const directUrl = detailData?.episodes[episodeIndex] || '';
    originalVideoUrlRef.current = directUrl;
    sourceFallbackAttemptedRef.current = false;
    lastLoadedAnalyzerAdSkipSignatureRef.current = null;
    void loadMergedAdSkipWindows([]);

    const rememberedStatus = detailData
      ? getRememberedSourceStatusForSource(
          getSourceIdentityKey(detailData.source, detailData.id),
          detailData.episodes
        )
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
    logHlsPlaybackPolicy(directUrl, playbackPolicy.url, playbackPolicy);
    observeIosAdSignals(directUrl, observationUrl, playbackPolicy);

    const nextUrl = playbackPolicy.url;

    if (nextUrl !== videoUrlRef.current) {
      startupFeedbackSentRef.current = false;
      playbackStartupStartedAtRef.current = Date.now();
      startHlsPlaybackSession();
      resetHlsRecoveryCounters();
      scheduleSourceChangeTimeout({
        source: detailData,
        targetIndex: episodeIndex,
        resumeTime: resumeTimeRef.current,
        reason: '播放源起播超时',
      });
      videoUrlRef.current = nextUrl;
      playbackModeRef.current = playbackPolicy.mode;
      // 换集/换址时一次写入 URL、加载态与播放模式，避免同 effect 内多次 setState
      dispatchVideoPlaybackUi({
        type: 'url.start',
        videoUrl: nextUrl,
        playbackMode: playbackPolicy.mode,
        stage: 'initing',
      });
    } else {
      applyPlaybackMode(playbackPolicy.mode);
    }
  };

  const updateVideoUrlRef = useRef(updateVideoUrl);
  updateVideoUrlRef.current = updateVideoUrl;

  const trySwitchToNextAvailableSource = async (reason: string) => {
    const currentSessionId = hlsRecoveryStateRef.current.playbackSessionId;
    if (hlsAutoSourceSwitchSessionRef.current === currentSessionId) {
      emitPlaybackDebugLog(
        'switch-source-ignored',
        '当前 HLS.js 播放会话已触发过自动切源',
        {
          reason,
          playbackSessionId: currentSessionId,
          sourceKey: getCurrentSourceKey(),
          currentEpisodeIndex: currentEpisodeIndexRef.current,
        }
      );
      return false;
    }

    const video = artPlayerRef.current?.video as HTMLVideoElement | undefined;
    const currentPlayTime =
      typeof video?.currentTime === 'number'
        ? video.currentTime
        : artPlayerRef.current?.currentTime || 0;

    syncPlaybackSessionSources();
    const sessionResult = dispatchPlaybackSessionEvent({
      type: 'recovery.runtimeEvidence',
      nowMs: Date.now(),
      snapshot: { currentTime: currentPlayTime },
      evidence: {
        platform:
          playbackPolicyRef.current?.recoveryProfile === 'native-video'
            ? 'apple-native'
            : 'hlsjs',
        hardFailure: true,
        stallCandidate: true,
      },
    });
    const switchEffect = sessionResult.effects.find(
      (
        effect
      ): effect is Extract<PlaybackSessionEffect, { type: 'switchSource' }> =>
        effect.type === 'switchSource'
    );

    if (!switchEffect) {
      emitPlaybackDebugLog('switch-source-unavailable', '无可用候选播放源', {
        reason,
        sourceKey: getCurrentSourceKey(),
        currentEpisodeIndex: currentEpisodeIndexRef.current,
      });
      if (playbackPolicyRef.current?.recoveryProfile === 'native-video') {
        reportCurrentPlaybackFailureFeedback('ios-auto-switch-unavailable');
      }
      return false;
    }

    const nextSource = switchEffect.source;
    const recoveryResumeTime = switchEffect.resumeTime;
    if (recoveryResumeTime) {
      resumeTimeRef.current = recoveryResumeTime;
      sourceSwitchSavePendingRef.current = true;
    }

    const nextSourceKey = switchEffect.sourceKey;

    console.warn(`${reason}，自动切换到播放源: ${nextSource.source_name}`);
    emitPlaybackDebugLog('switch-source', '已自动切换到其他播放源', {
      reason,
      nextSource: nextSource.source,
      nextId: nextSource.id,
      nextTitle: nextSource.title,
      currentEpisodeIndex: currentEpisodeIndexRef.current,
      resumeTime: recoveryResumeTime,
    });
    hlsAutoSourceSwitchSessionRef.current = currentSessionId;

    const switched = await handleSourceChange(
      nextSource.source,
      nextSource.id,
      nextSource.title,
      {
        autoRecovery: true,
        resumeTime: recoveryResumeTime,
        reason,
        autoPlayAfterReady: true,
      }
    );

    if (!switched) {
      dispatchPlaybackSessionEvent({
        type: 'recovery.switchFailed',
        sourceKey: nextSourceKey,
      });
      hlsAutoSourceSwitchSessionRef.current = null;
      if (playbackPolicyRef.current?.recoveryProfile === 'native-video') {
        reportCurrentPlaybackFailureFeedback('ios-auto-switch-failed');
      }
      return false;
    }

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
          ? (
              navigator as Navigator & {
                userAgentData?: { platform?: string };
              }
            ).userAgentData?.platform
          : undefined,
      maxTouchPoints:
        typeof navigator !== 'undefined' ? navigator.maxTouchPoints : undefined,
      hasWebKitPointConversion:
        typeof window !== 'undefined' &&
        typeof (window as any).webkitConvertPointFromNodeToPage === 'function',
    });

  const getPlaybackProbePlatform = () =>
    detectPlaybackProbePlatform({
      userAgent:
        typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      platform:
        typeof navigator !== 'undefined' ? navigator.platform : undefined,
      userAgentDataPlatform:
        typeof navigator !== 'undefined'
          ? (
              navigator as Navigator & {
                userAgentData?: { platform?: string };
              }
            ).userAgentData?.platform
          : undefined,
      maxTouchPoints:
        typeof navigator !== 'undefined' ? navigator.maxTouchPoints : undefined,
      hasWebKitPointConversion:
        typeof window !== 'undefined' &&
        typeof (window as any).webkitConvertPointFromNodeToPage === 'function',
    });

  const logHlsPlaybackPolicy = (
    directUrl: string,
    playbackUrl: string | null,
    policy: HlsPlaybackPolicyResult
  ) => {
    const logKey = JSON.stringify({
      directUrl,
      playbackUrl,
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
      playbackUrl,
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
  };

  // 统一入口：把一次 timeupdate 喂进 playback-session reducer，
  // 命中 Ad Skip Window 时由 onSkipAdWindow sink 经 seek 跳过。
  // 返回本次是否触发了广告跳过（用于短路后续进度记录）。
  const dispatchTimeupdateForAdSkip = (
    video: HTMLVideoElement,
    platform: 'apple-native' | 'hlsjs'
  ) => {
    const sessionResult = dispatchPlaybackSessionEvent({
      type: 'video.timeupdate',
      nowMs: Date.now(),
      platform,
      snapshot: { currentTime: video.currentTime || 0 },
    });
    return sessionResult.effects.some(
      (effect) => effect.type === 'skipAdWindow'
    );
  };

  const trySkipNativeAdWindow = (video: HTMLVideoElement) => {
    if (playbackPolicyRef.current?.runtime !== 'native-hls') {
      return false;
    }
    return dispatchTimeupdateForAdSkip(video, 'apple-native');
  };

  const observeIosAdSignals = (
    directUrl: string,
    observationProxyUrl: string | null,
    policy: HlsPlaybackPolicyResult,
    retryAttempt = 0
  ) => {
    if (policy.runtime !== 'native-hls' || !directUrl || !observationProxyUrl) {
      return;
    }

    const observationUrl = `${observationProxyUrl}${
      observationProxyUrl.includes('?') ? '&' : '?'
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
        lastLoadedAnalyzerAdSkipSignatureRef.current = skipWindows
          .map(getHlsAdSkipWindowKey)
          .join('|');
        void loadMergedAdSkipWindows(skipWindows);
        if (
          typeof payload.playlistContent === 'string' &&
          payload.playlistContent.includes('#EXTINF')
        ) {
          latestMediaPlaylistRef.current = {
            content: payload.playlistContent,
            url: payload.targetUrl || directUrl,
          };
        }
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
            hasPlaylistContent: Boolean(payload.playlistContent),
          },
          {
            playbackUrl: directUrl,
            policy,
          }
        );

        const video = artPlayerRef.current?.video as
          | HTMLVideoElement
          | undefined;
        if (video) {
          trySkipNativeAdWindow(video);
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
            observeIosAdSignals(directUrl, observationProxyUrl, policy, 1);
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

    if (video.recoveryCanplayListener) {
      video.removeEventListener('canplay', video.recoveryCanplayListener);
      video.recoveryCanplayListener = undefined;
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

    if (video.recoverySeekedListener) {
      video.removeEventListener('seeked', video.recoverySeekedListener);
      video.recoverySeekedListener = undefined;
    }
  };

  const disposeCurrentPlayer = () => {
    startHlsPlaybackSession();
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
            errorMessage:
              error instanceof Error ? error.message : String(error),
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
            errorMessage:
              error instanceof Error ? error.message : String(error),
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
      previousJitterWindows: state.jitterWindowCount,
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

    const stuckTime = Number((video.currentTime || 0).toFixed(2));

    // Session authority: jitter is evidence only — never a parallel seek commander.
    if (resolveNativeJitterRouting() === 'session-tree') {
      rememberCurrentPlaybackBadPoint(stuckTime);
      syncPlaybackSessionSources();
      dispatchPlaybackSessionEvent({
        type: 'recovery.runtimeEvidence',
        nowMs: now,
        snapshot: {
          currentTime: stuckTime,
          readyState: video.readyState,
          networkState: video.networkState,
          paused: video.paused,
          ended: video.ended,
          playbackUrl,
        },
        evidence: {
          platform: 'apple-native',
          stallCandidate: true,
          native: {
            severity: mediaSourceUnavailable ? 'source-failed' : 'soft-stall',
            isJitter: true,
            jitterWindowCount: state.jitterWindowCount,
          },
        },
      });
      emitPlaybackDebugLog(
        'native-jitter-detected',
        '原生播放器抖动已汇入 Session 恢复决策树',
        {
          reason,
          stuckTime,
          jitterWindowCount: state.jitterWindowCount,
          jitterRouting: 'session-tree',
          recoveryAuthority: getPlaybackRecoveryAuthorityMode(),
        },
        { playbackUrl }
      );
      return;
    }

    rememberCurrentPlaybackBadPoint(stuckTime);

    if (state.jitterWindowCount >= 2 && stuckTime > 1) {
      if (
        !isSessionAutomaticEffectAllowed(
          'same-source-recovery',
          now,
          state.playIntent === 'paused'
        )
      ) {
        return;
      }
      const escape = planStallEscapeResume({
        currentPlayTime: stuckTime,
        badPoints: playbackSessionStateRef.current.badPoints,
        sourceKey: getCurrentSourceKey(),
        mode: 'same-source',
      });
      if (escape.action === 'skip-forward' && escape.resumeTime != null) {
        systemSeekInFlightRef.current = true;
        video.currentTime = escape.resumeTime;
        emitPlaybackDebugLog(
          'native-jitter-skip-forward',
          '原生播放器连续抖动，已向前越过坏点',
          {
            fromTime: stuckTime,
            targetTime: escape.resumeTime,
            jitterWindowCount: state.jitterWindowCount,
            jitterRouting: 'legacy-parallel',
          },
          {
            playbackUrl,
          }
        );
      }
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
          currentTime: stuckTime,
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
      const mediaSourceUnavailable =
        isNativeMediaSourceUnavailable(currentVideo);
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
    const now = Date.now();
    const legacyIsUserPaused = state.playIntent === 'paused';
    if (
      !isSessionAutomaticEffectAllowed(
        severity === 'source-failed' || state.sourceRecoveryAttempts > 0
          ? 'auto-source-switch'
          : 'same-source-recovery',
        now,
        legacyIsUserPaused
      )
    ) {
      emitPlaybackDebugLog(
        'native-recovery-ignored',
        '已忽略原生自动恢复',
        {
          reason: 'intent-gate',
          intentAuthority: getPlaybackIntentAuthorityMode(),
          recoveryAuthority: getPlaybackRecoveryAuthorityMode(),
          playbackIntent: playbackSessionStateRef.current.playbackIntent,
          recoveryMode: severity,
          stallObservedForMs: stalledForMs,
        },
        { playbackUrl }
      );
      return false;
    }

    // Session authority: feed runtime evidence; execute Session effects only.
    if (isPlaybackRecoverySessionAuthorityEnabled()) {
      syncPlaybackSessionSources();
      const sessionResult = dispatchPlaybackSessionEvent({
        type: 'recovery.runtimeEvidence',
        nowMs: now,
        snapshot: {
          currentTime: Number((video.currentTime || 0).toFixed(2)),
          readyState: video.readyState,
          networkState: video.networkState,
          paused: video.paused,
          ended: video.ended,
          playbackUrl,
        },
        evidence: {
          platform: 'apple-native',
          stallCandidate: severity !== 'observe',
          hardFailure:
            severity === 'source-failed' || severity === 'hard-stall',
          native: {
            severity,
            isJitter: false,
            jitterWindowCount: state.jitterWindowCount,
          },
        },
      });

      const switchEffect = sessionResult.effects.find(
        (
          effect
        ): effect is Extract<PlaybackSessionEffect, { type: 'switchSource' }> =>
          effect.type === 'switchSource'
      );
      if (switchEffect) {
        reportCurrentPlaybackFailureFeedback(
          severity === 'source-failed'
            ? 'ios-source-failed'
            : 'ios-native-stall'
        );
        state.sourceRecoveryAttempts = 0;
        if (switchEffect.resumeTime != null) {
          resumeTimeRef.current = switchEffect.resumeTime;
          sourceSwitchSavePendingRef.current = true;
        }
        void handleSourceChange(
          switchEffect.source.source,
          switchEffect.source.id,
          switchEffect.source.title,
          {
            autoRecovery: true,
            resumeTime: switchEffect.resumeTime,
            reason,
            autoPlayAfterReady: true,
          }
        ).then((switched) => {
          if (!switched) {
            dispatchPlaybackSessionEvent({
              type: 'recovery.switchFailed',
              sourceKey: switchEffect.sourceKey,
            });
          }
        });
        return true;
      }

      const acted = sessionResult.effects.some(
        (effect) =>
          effect.type === 'sameSourceRecover' ||
          effect.type === 'applyRecoveryResume'
      );
      if (acted) {
        state.sourceRecoveryAttempts += 1;
        state.ignoreStallUntil = Date.now() + NATIVE_PLAY_RESUME_GRACE_MS;
      }
      return acted;
    }

    const playIntentForDecision =
      getPlaybackIntentAuthorityMode() === 'session'
        ? playbackSessionStateRef.current.playbackIntent === 'user-paused'
          ? 'paused'
          : 'playing'
        : state.playIntent;

    const decision = getNativeRecoveryAction({
      severity,
      playIntent: playIntentForDecision,
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
    const failureSessionError =
      severity === 'source-failed' ? 'ios-source-failed' : 'ios-native-stall';

    if (decision.action === 'observe') {
      if (
        shouldReportNativePlaybackFailureFeedback({
          severity,
          action: decision.action,
          sourceRecoveryAttempts: state.sourceRecoveryAttempts,
        })
      ) {
        reportCurrentPlaybackFailureFeedback(failureSessionError);
      }
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
      const stuckTime = video.currentTime || 0;
      const escape = planStallEscapeResume({
        currentPlayTime: stuckTime,
        badPoints: playbackSessionStateRef.current.badPoints,
        sourceKey: getCurrentSourceKey(),
        mode: 'same-source',
      });
      if (escape.recordBadPointAt != null) {
        rememberCurrentPlaybackBadPoint(escape.recordBadPointAt);
      }
      if (escape.action === 'skip-forward' && escape.resumeTime != null) {
        systemSeekInFlightRef.current = true;
        video.currentTime = escape.resumeTime;
        emitPlaybackDebugLog(
          'native-stall-skip-forward',
          '原生播放器卡死后已向前越过坏点',
          {
            fromTime: Number(stuckTime.toFixed(2)),
            targetTime: escape.resumeTime,
          },
          {
            playbackUrl,
          }
        );
      } else {
        // Already-"playing" stalls need a buffered nudge; bare play() is a no-op.
        const nudged = tryNudgePlayback(video);
        if (nudged) {
          emitPlaybackDebugLog(
            'native-stall-nudge',
            '原生播放器卡死后已微调播放位置',
            {
              fromTime: Number(stuckTime.toFixed(2)),
              targetTime: Number((video.currentTime || 0).toFixed(2)),
            },
            {
              playbackUrl,
            }
          );
        }
      }
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
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
          {
            playbackUrl,
          }
        );
      });
      return true;
    }

    if (decision.action === 'switch-source') {
      reportCurrentPlaybackFailureFeedback(failureSessionError);
      state.sourceRecoveryAttempts = 0;
      void trySwitchToNextAvailableSource(decision.reason);
      return true;
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
    state.ignoreStallUntil = video.paused
      ? 0
      : now + NATIVE_PLAY_RESUME_GRACE_MS;
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
      resetProgressiveSourceProbeStability();
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
      scheduleProgressiveSourceProbe();
      scheduleNativeFalsePlayingCheck();
    };
    const handleTimeupdate = () => {
      if (trySkipNativeAdWindow(video)) {
        return;
      }
      recordProgressIfAdvanced();
      scheduleProgressiveSourceProbe();
    };
    const handleSeeking = () => {
      resetProgressiveSourceProbeStability();
      if (systemSeekInFlightRef.current) {
        return;
      }
      const now = Date.now();
      dispatchPlaybackSessionEvent({ type: 'user.seekStarted', nowMs: now });
    };
    const handleSeeked = () => {
      if (systemSeekInFlightRef.current) {
        systemSeekInFlightRef.current = false;
        settleSystemRecoverySeekIfNeeded();
        return;
      }
      const now = Date.now();
      dispatchPlaybackSessionEvent({ type: 'user.seekSettled', nowMs: now });
    };

    video.recoveryPlayingListener = handlePlaying;
    video.recoveryErrorListener = handleError;
    video.recoveryTimeupdateListener = handleTimeupdate;
    video.recoverySeekingListener = handleSeeking;
    video.recoverySeekedListener = handleSeeked;
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('error', handleError);
    video.addEventListener('timeupdate', handleTimeupdate);
    video.addEventListener('seeking', handleSeeking);
    video.addEventListener('seeked', handleSeeked);

    if (typeof window !== 'undefined') {
      nativeWatchdogTimerRef.current = window.setInterval(() => {
        const now = Date.now();
        const mediaSourceUnavailable = isNativeMediaSourceUnavailable(video);
        const stalledForMs = now - state.lastProgressAt;

        if (
          !isSessionAutomaticEffectAllowed(
            'same-source-recovery',
            now,
            state.playIntent === 'paused'
          )
        ) {
          return;
        }

        if (
          getPlaybackIntentAuthorityMode() === 'legacy' &&
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
          playIntent: state.playIntent,
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
              // 统一到 seek 式 Ad Skip Window（ADR 0004）：
              // hls.js 不再物理改写 playlist 删除广告分片，改为把分析器
              // 高置信候选（含已知规则命中）作为 Ad Skip Window 喂进
              // playback-session reducer，由 seek 跳过。
              if (response.data && typeof response.data === 'string') {
                const originalContent = response.data;
                const playlistUrl = response.url || context?.url;
                const policy = playbackPolicyRef.current;
                const isHlsjsMediaPlaylist =
                  policy?.runtime === 'hlsjs' &&
                  originalContent.includes('#EXTINF');
                if (isHlsjsMediaPlaylist && playlistUrl) {
                  latestMediaPlaylistRef.current = {
                    content: originalContent,
                    url: playlistUrl,
                  };
                }
                const analysis = isHlsjsMediaPlaylist
                  ? analyzeM3U8AdCandidates(originalContent, playlistUrl)
                  : null;
                if (analysis) {
                  const skipWindows = toHlsAdSkipWindows(analysis.candidates);
                  // 媒体播放列表在换清晰度 / 恢复加载时会被重复拉取。仅在分析器
                  // 种子真正变化时才重新载入并与持久窗口合并，避免重置
                  // already-skipped 守卫。
                  const nextSignature = skipWindows
                    .map(getHlsAdSkipWindowKey)
                    .join('|');
                  const windowsChanged =
                    nextSignature !==
                    lastLoadedAnalyzerAdSkipSignatureRef.current;
                  if (windowsChanged) {
                    lastLoadedAnalyzerAdSkipSignatureRef.current =
                      nextSignature;
                    void loadMergedAdSkipWindows(skipWindows);
                    emitPlaybackDebugLog(
                      'hlsjs-ad-skip-window',
                      'HLS.js 直连播放已载入广告跳过时间窗',
                      {
                        playlistUrl,
                        playlistType: context?.type || null,
                        removed: false,
                        skipWindowCount: skipWindows.length,
                        skipWindows,
                        candidates: analysis.candidates,
                        summary: analysis.summary,
                        sourceKey: getCurrentSourceKey() || null,
                        episodeIndex: currentEpisodeIndexRef.current,
                      },
                      {
                        playbackUrl: playlistUrl || videoUrlRef.current,
                      }
                    );
                  }
                }
                const debugInfo = analysis
                  ? null
                  : logDirectAdObserveDebug(
                      playlistUrl,
                      originalContent,
                      context?.type
                    );
                if (debugInfo) {
                  emitPlaybackDebugLog(
                    'hlsjs-ad-observe',
                    'HLS.js 直连播放广告信号观测完成',
                    {
                      playlistUrl,
                      playlistType: context?.type || null,
                      removed: false,
                      removedLineCount: debugInfo.removedLineCount,
                      wouldRemoveLineCount: debugInfo.removedLineCount,
                      candidates: [],
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
    updateVideoUrlRef.current(detail, currentEpisodeIndex);
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
        setPlaybackError('缺少必要参数', 'missing-params');
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

      const searchResults = await fetchSourcesData(searchTitle || videoTitle);
      let detailResults: SearchResult[] = [];
      let historyRecord: PlaybackHistoryRecord | null = null;

      if (
        currentSource &&
        currentId &&
        !searchResults.some(
          (source) => source.source === currentSource && source.id === currentId
        )
      ) {
        detailResults = await fetchSourceDetail(currentSource, currentId);
      }

      if (currentSource && currentId) {
        try {
          const allRecords = await getAllPlayRecords();
          const contentKey = buildWatchProgressContentKey({
            title: searchTitle || videoTitle,
            year: videoYear,
          });
          const latest = planLatestWatchProgressForContent({
            contentKey,
            records: allRecords as Record<
              string,
              import('@/lib/types').PlayRecord
            >,
            legacyRoute: { source: currentSource, id: currentId },
            authorityMode: getWatchProgressAuthorityMode(),
          });

          if (latest.record) {
            historyRecord = {
              index: latest.record.index,
              play_time: latest.record.play_time,
              total_time: latest.record.total_time,
              title: latest.record.title,
              year: latest.record.year,
            };
          }
        } catch (err) {
          console.error('读取播放记录失败:', err);
        }
      }

      let sourcesInfo = searchResults;
      let detailData: SearchResult | null = searchResults[0] || null;
      let fellBackFromHistory = false;
      let restoredEpisodeIndex: number | null = null;
      let restoredResumeTime: number | null = null;

      if (currentSource && currentId) {
        const urlEpisodeParam = searchParams.get('episode');
        const urlEpisodeIndex =
          urlEpisodeParam == null || urlEpisodeParam === ''
            ? null
            : Math.max(0, Number.parseInt(urlEpisodeParam, 10) - 1);

        const recovery = resolvePlaybackHistoryRecovery({
          currentSource,
          currentId,
          searchResults,
          detailResults,
          isFromPlayRecord: isFromPlayRecordEntry,
          historyRecord,
          urlEpisodeIndex,
          contentKey: buildWatchProgressContentKey({
            title: searchTitle || videoTitle,
            year: videoYear,
          }),
        });

        if (!recovery.detail) {
          setPlaybackError(
            recovery.error || '未找到匹配结果',
            isFromPlayRecordEntry ? 'history-expired' : 'not-found'
          );
          setLoading(false);
          return;
        }

        sourcesInfo = recovery.sources;
        detailData = recovery.detail;
        fellBackFromHistory = recovery.fellBackFromHistory;
        restoredEpisodeIndex = recovery.resumeEpisodeIndex;
        restoredResumeTime = recovery.resumeTime;
      }

      if (!detailData || sourcesInfo.length === 0) {
        setPlaybackError(
          '未找到匹配结果',
          isFromPlayRecordEntry ? 'history-expired' : 'not-found'
        );
        setLoading(false);
        return;
      }

      // 指定源和id且无需优选
      if (
        currentSource &&
        currentId &&
        !needPreferRef.current &&
        !fellBackFromHistory
      ) {
        const target = sourcesInfo.find(
          (source) => source.source === currentSource && source.id === currentId
        );
        if (target) {
          detailData = target;
        } else {
          setPlaybackError('未找到匹配结果', 'not-found');
          setLoading(false);
          return;
        }
      }

      // 未指定源和 id 或需要优选，且开启优选开关
      if (
        (!currentSource ||
          !currentId ||
          needPreferRef.current ||
          fellBackFromHistory) &&
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

      setAvailableSources(sourcesInfo);
      console.log(detailData.source, detailData.id);

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setDetail(detailData);

      if (restoredEpisodeIndex != null) {
        setCurrentEpisodeIndex(restoredEpisodeIndex);
        const historySourceKey = getSourceIdentityKey(
          detailData.source,
          detailData.id
        );
        const seedPlayTime =
          historyRecord && historyRecord.index - 1 === restoredEpisodeIndex
            ? historyRecord.play_time
            : restoredResumeTime ?? 0;
        const escape = planStallEscapeResume({
          currentPlayTime: seedPlayTime,
          badPoints: playbackSessionStateRef.current.badPoints,
          sourceKey: historySourceKey,
          mode: 'same-source',
        });
        // Only reinforce an already-known stuck point on refresh; never mark
        // ordinary continue-watching resumes as bad points.
        if (
          escape.action === 'skip-forward' &&
          escape.recordBadPointAt != null
        ) {
          rememberCurrentPlaybackBadPoint(
            escape.recordBadPointAt,
            historySourceKey
          );
        }
        resumeTimeRef.current =
          restoredResumeTime ?? escape.resumeTime ?? 0;
      } else if (currentEpisodeIndex >= detailData.episodes.length) {
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

  // 处理换源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string,
    options: SourceChangeOptions = {}
  ): Promise<boolean> => {
    try {
      // 显示换源加载状态
      dispatchVideoPlaybackUi({
        type: 'loading.start',
        stage: 'sourceChanging',
      });
      // 旧源清单不能用于新源的结构块吸附
      latestMediaPlaylistRef.current = null;
      sourceSwitchSavePendingRef.current = false;
      sourceSwitchAutoPlayPendingRef.current = false;
      sourceDurationBeforeSwitchRef.current =
        artPlayerRef.current?.duration || null;

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
        dispatchVideoPlaybackUi({ type: 'loading.end' });
        setPlaybackError('未找到匹配结果', 'not-found');
        return false;
      }

      const rememberedStatus = getRememberedSourceStatusForSource(
        getSourceIdentityKey(newDetail.source, newDetail.id),
        newDetail.episodes
      );
      if (rememberedStatus?.kind === 'unavailable') {
        dispatchVideoPlaybackUi({ type: 'loading.end' });
        setPlaybackError(
          rememberedStatus.reason || '该播放源当前不可用',
          'source-unavailable'
        );
        return false;
      }

      // 尝试跳转到当前正在播放的集数
      const activeEpisodeIndex = currentEpisodeIndexRef.current;
      const targetIndex = getSourceSwitchTargetEpisodeIndex({
        currentEpisodeIndex: activeEpisodeIndex,
        episodeCount: newDetail.episodes?.length || 0,
        requireCurrentEpisode: Boolean(options.autoRecovery),
      });

      if (targetIndex === null) {
        dispatchVideoPlaybackUi({ type: 'loading.end' });
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
        return false;
      }

      startHlsPlaybackSession();
      resetHlsRecoveryCounters();
      sourceFallbackAttemptedRef.current = false;

      const plannedResumeTime =
        typeof options.resumeTime === 'number' && options.resumeTime > 0
          ? options.resumeTime
          : resumeTimeRef.current;
      const nextSourceKey = getSourceIdentityKey(newSource, newId);
      const resumePlan = getSourceSwitchResumePlan({
        currentEpisodeIndex: activeEpisodeIndex,
        targetEpisodeIndex: targetIndex,
        currentPlayTime,
        existingResumeTime: plannedResumeTime,
        badPoints: playbackSessionStateRef.current.badPoints,
        currentSourceKey: getCurrentSourceKey(),
        targetSourceKey: nextSourceKey,
      });
      if (
        resumePlan.recordBadPointAt != null &&
        (options.autoRecovery || resumePlan.action === 'skip-forward')
      ) {
        rememberCurrentPlaybackBadPoint(
          resumePlan.recordBadPointAt,
          getCurrentSourceKey()
        );
      }
      resumeTimeRef.current = resumePlan.resumeTime;
      sourceSwitchSavePendingRef.current = resumePlan.saveAfterCanPlay;
      sourceSwitchAutoPlayPendingRef.current = Boolean(
        options.autoPlayAfterReady
      );
      scheduleSourceChangeTimeout({
        source: newDetail,
        targetIndex,
        resumeTime: resumePlan.resumeTime,
        reason: options.reason,
      });

      if (options.autoRecovery) {
        emitPlaybackDebugLog(
          'switch-source-resume-planned',
          '已规划自动切源恢复点',
          {
            reason: options.reason,
            nextSource: newSource,
            nextId: newId,
            currentEpisodeIndex: activeEpisodeIndex,
            targetEpisodeIndex: targetIndex,
            currentPlayTime,
            resumeTime: resumePlan.resumeTime,
            autoPlayAfterReady: sourceSwitchAutoPlayPendingRef.current,
          }
        );
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
      if (!options.autoRecovery) {
        dispatchPlaybackSessionEvent({
          type: 'user.switchSource',
          sourceKey: nextSourceKey,
          nowMs: Date.now(),
        });
      }
      return true;
    } catch (err) {
      // 隐藏换源加载状态
      dispatchVideoPlaybackUi({ type: 'loading.end' });
      setPlaybackError(err instanceof Error ? err.message : '换源失败');
      return false;
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
      const result = dispatchPlaybackSessionEvent({
        type: 'user.switchEpisode',
        episodeIndex,
        nowMs: Date.now(),
      });
      void executeSaveProgressEffects(result.effects);
      setCurrentEpisodeIndex(episodeIndex);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      const episodeIndex = idx - 1;
      const result = dispatchPlaybackSessionEvent({
        type: 'user.switchEpisode',
        episodeIndex,
        nowMs: Date.now(),
      });
      void executeSaveProgressEffects(result.effects);
      setCurrentEpisodeIndex(episodeIndex);
    }
  };

  const handleNextEpisode = () => {
    console.log('尝试切换到下一集');
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      const episodeIndex = idx + 1;
      const result = dispatchPlaybackSessionEvent({
        type: 'user.switchEpisode',
        episodeIndex,
        nowMs: Date.now(),
      });
      void executeSaveProgressEffects(result.effects);
      setCurrentEpisodeIndex(episodeIndex);
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
      episodeIndex?: number;
      completed?: boolean;
      playTime?: number;
      totalTime?: number;
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
    const duration = Math.floor(
      options?.totalTime ?? player.duration ?? 0
    );
    const episodeIndex =
      options?.episodeIndex ?? currentEpisodeIndexRef.current;
    const rawPlayTime = Math.floor(
      options?.playTime ?? player.currentTime ?? 0
    );
    const sealed =
      reason === 'episode-ended' || options?.completed
        ? planEpisodeChangeSave({
            previousEpisodeIndex: episodeIndex,
            nextEpisodeIndex: episodeIndex + 1,
            playTime: rawPlayTime,
            totalTime: duration,
            reason: 'episode-ended',
          })
        : null;
    const currentTime = sealed?.completed
      ? Math.floor(sealed.playTime)
      : rawPlayTime;

    // 如果播放时间太短或者视频时长无效，不保存（完成态除外）
    if (
      !sealed?.completed &&
      (currentTime < 1 || !duration)
    ) {
      return;
    }

    const contentKey = getPlaybackContentKey();
    const writePlan = planWatchProgressWrite({
      contentKey,
      episodeIndex,
      route: {
        source: currentSourceRef.current,
        id: currentIdRef.current,
      },
      authorityMode: getWatchProgressAuthorityMode(),
      dualWrite: isWatchProgressDualWriteEnabled(),
    });

    const saveTime = Date.now();
    const snapshot = {
      key: writePlan.primaryKey,
      episodeIndex,
      playTime: currentTime,
      totalTime: duration,
      savedAt: saveTime,
    } satisfies PlayRecordSaveSnapshot;

    if (!shouldSavePlayRecord(lastSavedSnapshotRef.current, snapshot, reason)) {
      return;
    }

    const record = {
      title: videoTitleRef.current,
      source_name: detailRef.current?.source_name || '',
      year: detailRef.current?.year || videoYearRef.current || '',
      cover: detailRef.current?.poster || '',
      index: episodeIndex + 1, // 转换为1基索引
      total_episodes: detailRef.current?.episodes.length || 1,
      play_time: currentTime,
      total_time: duration || currentTime,
      save_time: saveTime,
      search_title: searchTitle,
      route_source: currentSourceRef.current,
      route_id: currentIdRef.current,
    };

    try {
      await savePlayRecordKeys(
        [writePlan.primaryKey, ...writePlan.dualWriteKeys],
        record,
        options
      );

      lastSaveTimeRef.current = saveTime;
      lastSavedSnapshotRef.current = snapshot;
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  const executeSaveProgressEffects = async (
    effects: PlaybackSessionEffect[],
    options?: {
      keepalive?: boolean;
      playTime?: number;
      totalTime?: number;
    }
  ) => {
    for (const effect of effects) {
      if (effect.type !== 'saveProgress') {
        continue;
      }
      await saveCurrentPlayProgress(effect.reason, {
        keepalive: options?.keepalive,
        episodeIndex: effect.episodeIndex,
        completed: effect.completed,
        playTime: options?.playTime,
        totalTime: options?.totalTime,
      });
    }
  };

  const requestSaveCurrentPlayProgress = async (
    reason: PlayRecordSaveReason = 'heartbeat',
    options?: {
      keepalive?: boolean;
    }
  ) => {
    const result = dispatchPlaybackSessionEvent({
      type: 'progressSave.requested',
      reason,
    });
    await executeSaveProgressEffects(result.effects, options);
  };

  useEffect(() => {
    // 页面即将卸载时保存播放进度
    const handleBeforeUnload = () => {
      void requestSaveCurrentPlayProgress('beforeunload', { keepalive: true });
    };

    // 页面可见性变化时保存播放进度
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void requestSaveCurrentPlayProgress('visibility-hidden', {
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
      clearSourceChangeTimeoutTimer();
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
      setPlaybackError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setPlaybackError('视频地址无效');
      return;
    }
    console.log(videoUrl);

    let cancelled = false;
    const setupSessionId = hlsRecoveryStateRef.current.playbackSessionId;
    const setupVideoUrl = videoUrl;

    const setupPlayer = async () => {
      try {
        const [artplayerModule, hlsModule] = await Promise.all([
          import('artplayer'),
          import('hls.js'),
        ]);
        const Artplayer = artplayerModule.default as any;
        const Hls = hlsModule.default as any;

        if (
          cancelled ||
          hlsRecoveryStateRef.current.playbackSessionId !== setupSessionId ||
          videoUrlRef.current !== setupVideoUrl
        ) {
          return;
        }

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
                manifestLoadingTimeOut: 8000,
                manifestLoadingMaxRetry: 0,
                levelLoadingTimeOut: 8000,
                levelLoadingMaxRetry: 0,
                fragLoadingTimeOut: 12000,
                fragLoadingMaxRetry: 1,

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
              const hlsSessionId =
                hlsRecoveryStateRef.current.playbackSessionId;
              const hlsPlaybackUrl = url;
              const hlsVideo = video;

              ensureVideoSource(video, url);

              const executeRecoveryPlan = (
                reason: string,
                action: HlsRecoveryAction
              ) => {
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
                  case 'switch-source':
                    void trySwitchToNextAvailableSource(reason);
                    return true;
                  case 'destroy':
                    console.error(reason);
                    hls.destroy();
                    setPlaybackError(
                      '当前播放源不可恢复，请稍后重试或手动换源',
                      'source-unavailable'
                    );
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
                const state = hlsRecoveryStateRef.current;
                const nativeState = nativeRecoveryStateRef.current;
                const legacyIsUserPaused =
                  nativeState.playIntent === 'paused' &&
                  nativeState.pauseReason === 'user' &&
                  video.paused;
                if (
                  !isSessionAutomaticEffectAllowed(
                    'same-source-recovery',
                    now,
                    legacyIsUserPaused
                  )
                ) {
                  emitPlaybackDebugLog(
                    'hls-recovery-ignored',
                    '已忽略 HLS.js 自动恢复',
                    {
                      action: 'ignore',
                      planReason: 'intent-gate',
                      intentAuthority: getPlaybackIntentAuthorityMode(),
                      playbackIntent:
                        playbackSessionStateRef.current.playbackIntent,
                      errorType,
                      errorDetails,
                      fatal,
                      currentTime: Number((video.currentTime || 0).toFixed(2)),
                      paused: video.paused,
                      seeking: video.seeking,
                      playbackSessionId: state.playbackSessionId,
                    },
                    {
                      playbackUrl: video.currentSrc || videoUrlRef.current,
                    }
                  );
                  return;
                }

                const useLegacyGuard =
                  getPlaybackIntentAuthorityMode() === 'legacy';
                const guard = shouldTriggerHlsWaitingRecovery({
                  timerSessionId: hlsSessionId,
                  currentSessionId: state.playbackSessionId,
                  timerPlaybackUrl: hlsPlaybackUrl,
                  currentPlaybackUrl: getHlsRecoveryGuardPlaybackUrl({
                    videoCurrentSrc: video.currentSrc,
                    playbackUrl: videoUrlRef.current,
                    fallbackUrl: url,
                  }),
                  isSameVideoElement: artPlayerRef.current?.video === hlsVideo,
                  isEnded: video.ended,
                  isUserPaused: useLegacyGuard ? legacyIsUserPaused : false,
                  isSeeking: useLegacyGuard
                    ? state.isSeeking || video.seeking
                    : video.seeking,
                  nowMs: now,
                  manualInteractionUntilMs: useLegacyGuard
                    ? state.manualInteractionUntil
                    : 0,
                  seekBufferGraceUntilMs: useLegacyGuard
                    ? state.seekBufferGraceUntil
                    : 0,
                });
                if (!guard.shouldTrigger) {
                  emitPlaybackDebugLog(
                    'hls-recovery-ignored',
                    '已忽略 HLS.js 自动恢复',
                    {
                      action: 'ignore',
                      planReason: guard.reason,
                      errorType,
                      errorDetails,
                      fatal,
                      currentTime: Number((video.currentTime || 0).toFixed(2)),
                      paused: video.paused,
                      seeking: video.seeking,
                      playbackSessionId: state.playbackSessionId,
                      manualInteractionUntil: state.manualInteractionUntil,
                      seekBufferGraceUntil: state.seekBufferGraceUntil,
                    },
                    {
                      playbackUrl: video.currentSrc || videoUrlRef.current,
                    }
                  );
                  return;
                }

                const isStallDetail =
                  errorDetails === 'bufferStalledError' ||
                  errorDetails === 'bufferNudgeOnStall' ||
                  errorDetails === 'waitingTimeout';

                if (isStallDetail) {
                  if (
                    state.stallWindowStartedAt <= 0 ||
                    now - state.stallWindowStartedAt > 30000
                  ) {
                    state.stallWindowStartedAt = now;
                    state.stallWindowCount = 0;
                  }
                  state.stallCount += 1;
                  state.stallWindowCount += 1;
                } else if (
                  state.lastErrorAt > 0 &&
                  now - state.lastErrorAt > 20000
                ) {
                  state.networkRecoveryAttempts = 0;
                  state.mediaRecoveryAttempts = 0;
                }
                state.lastErrorAt = now;

                // Session recovery authority: HLS feeds evidence only; no private R ladder.
                if (isPlaybackRecoverySessionAuthorityEnabled()) {
                  syncPlaybackSessionSources();
                  const sessionResult = dispatchPlaybackSessionEvent({
                    type: 'recovery.runtimeEvidence',
                    nowMs: now,
                    snapshot: {
                      currentTime: Number((video.currentTime || 0).toFixed(2)),
                      readyState: video.readyState,
                      networkState: video.networkState,
                      paused: video.paused,
                      ended: video.ended,
                      playbackUrl: video.currentSrc || videoUrlRef.current,
                    },
                    evidence: {
                      platform: 'hlsjs',
                      stallCandidate: true,
                      hardFailure: fatal,
                      hls: {
                        stallCount: state.stallCount,
                        stallWindowCount: state.stallWindowCount,
                        fatal,
                        errorType: errorType || null,
                      },
                    },
                  });

                  const switchEffect = sessionResult.effects.find(
                    (
                      effect
                    ): effect is Extract<
                      PlaybackSessionEffect,
                      { type: 'switchSource' }
                    > => effect.type === 'switchSource'
                  );
                  if (switchEffect) {
                    state.lastRecoveryAction = 'switch-source';
                    state.lastRecoveryActionAt = now;
                    if (switchEffect.resumeTime != null) {
                      resumeTimeRef.current = switchEffect.resumeTime;
                      sourceSwitchSavePendingRef.current = true;
                    }
                    void handleSourceChange(
                      switchEffect.source.source,
                      switchEffect.source.id,
                      switchEffect.source.title,
                      {
                        autoRecovery: true,
                        resumeTime: switchEffect.resumeTime,
                        reason: reason || 'HLS.js 恢复切源',
                        autoPlayAfterReady: true,
                      }
                    ).then((switched) => {
                      if (!switched) {
                        dispatchPlaybackSessionEvent({
                          type: 'recovery.switchFailed',
                          sourceKey: switchEffect.sourceKey,
                        });
                      }
                    });
                    return;
                  }

                  if (
                    sessionResult.effects.some(
                      (effect) =>
                        effect.type === 'sameSourceRecover' ||
                        effect.type === 'applyRecoveryResume'
                    )
                  ) {
                    state.lastRecoveryActionAt = now;
                  }
                  return;
                }

                const plan = getHlsRecoveryPlan({
                  fatal,
                  errorType,
                  errorDetails,
                  playbackMode: playbackModeRef.current,
                  stallCount: state.stallCount,
                  stallWindowCount: state.stallWindowCount,
                  networkRecoveryAttempts: state.networkRecoveryAttempts,
                  mediaRecoveryAttempts: state.mediaRecoveryAttempts,
                  hasAlternativeSource: Boolean(getNextRecoverySource()),
                  hasStartedPlayback:
                    state.lastHealthyProgressAt > 0 ||
                    state.lastPlaybackTime > 1 ||
                    video.currentTime > 1,
                  currentTimeSeconds: video.currentTime || 0,
                  readyState: video.readyState,
                });

                if (plan.action === 'ignore') {
                  return;
                }

                const minRecoveryIntervalMs =
                  plan.action === 'nudge-playback'
                    ? 1500
                    : plan.action === 'restart-load' ||
                      plan.action === 'recover-media'
                    ? 5000
                    : 0;
                if (
                  minRecoveryIntervalMs > 0 &&
                  state.lastRecoveryAction === plan.action &&
                  state.lastRecoveryActionAt > 0 &&
                  now - state.lastRecoveryActionAt < minRecoveryIntervalMs
                ) {
                  return;
                }

                const bufferedRanges = Array.from(
                  { length: video.buffered.length },
                  (_, index) => ({
                    start: Number(video.buffered.start(index).toFixed(2)),
                    end: Number(video.buffered.end(index).toFixed(2)),
                  })
                );

                emitPlaybackDebugLog(
                  'hls-recovery',
                  reason || plan.reason,
                  {
                    action: plan.action,
                    planReason: plan.reason,
                    errorType,
                    errorDetails,
                    fatal,
                    stallCount: state.stallCount,
                    stallWindowCount: state.stallWindowCount,
                    stallWindowAgeMs:
                      state.stallWindowStartedAt > 0
                        ? now - state.stallWindowStartedAt
                        : 0,
                    networkRecoveryAttempts: state.networkRecoveryAttempts,
                    mediaRecoveryAttempts: state.mediaRecoveryAttempts,
                    currentTime: Number((video.currentTime || 0).toFixed(2)),
                    readyState: video.readyState,
                    networkState: video.networkState,
                    paused: video.paused,
                    ended: video.ended,
                    playbackMode: playbackModeRef.current,
                    bufferedRanges,
                    lastHealthyProgressAt: state.lastHealthyProgressAt,
                  },
                  {
                    playbackUrl: video.currentSrc || videoUrlRef.current,
                  }
                );
                state.lastRecoveryAction = plan.action;
                state.lastRecoveryActionAt = now;
                executeRecoveryPlan(reason || plan.reason, plan.action);
              };

              removeNativeVideoRecoveryListeners(video);

              const handleVideoWaiting = () => {
                clearWaitingRecoveryTimer();
                resetProgressiveSourceProbeStability();
                if (typeof window === 'undefined') {
                  return;
                }

                const timerSessionId =
                  hlsRecoveryStateRef.current.playbackSessionId;
                const timerPlaybackUrl = getHlsRecoveryGuardPlaybackUrl({
                  videoCurrentSrc: video.currentSrc,
                  playbackUrl: videoUrlRef.current,
                  fallbackUrl: url,
                });
                const timerVideo = video;
                const startedAt = Date.now();
                waitingRecoveryTimerRef.current = window.setTimeout(() => {
                  waitingRecoveryTimerRef.current = null;
                  const state = hlsRecoveryStateRef.current;
                  const now = Date.now();
                  const nativeState = nativeRecoveryStateRef.current;
                  const legacyIsUserPaused =
                    nativeState.playIntent === 'paused' &&
                    nativeState.pauseReason === 'user' &&
                    video.paused;
                  if (
                    !isSessionAutomaticEffectAllowed(
                      'same-source-recovery',
                      now,
                      legacyIsUserPaused
                    )
                  ) {
                    emitPlaybackDebugLog(
                      'hls-recovery-ignored',
                      '已忽略 HLS.js waiting 恢复',
                      {
                        reason: 'intent-gate',
                        intentAuthority: getPlaybackIntentAuthorityMode(),
                        playbackIntent:
                          playbackSessionStateRef.current.playbackIntent,
                        timerSessionId,
                        currentSessionId: state.playbackSessionId,
                        startedAt,
                        waitedMs: now - startedAt,
                        currentTime: Number(
                          (video.currentTime || 0).toFixed(2)
                        ),
                        paused: video.paused,
                      },
                      {
                        playbackUrl:
                          video.currentSrc || videoUrlRef.current || url,
                      }
                    );
                    return;
                  }

                  const useLegacyGuard =
                    getPlaybackIntentAuthorityMode() === 'legacy';
                  const guard = shouldTriggerHlsWaitingRecovery({
                    timerSessionId,
                    currentSessionId: state.playbackSessionId,
                    timerPlaybackUrl,
                    currentPlaybackUrl: getHlsRecoveryGuardPlaybackUrl({
                      videoCurrentSrc: video.currentSrc,
                      playbackUrl: videoUrlRef.current,
                      fallbackUrl: url,
                    }),
                    isSameVideoElement:
                      artPlayerRef.current?.video === timerVideo,
                    isEnded: video.ended,
                    isUserPaused: useLegacyGuard ? legacyIsUserPaused : false,
                    isSeeking: useLegacyGuard
                      ? state.isSeeking || video.seeking
                      : video.seeking,
                    nowMs: now,
                    manualInteractionUntilMs: useLegacyGuard
                      ? state.manualInteractionUntil
                      : 0,
                    seekBufferGraceUntilMs: useLegacyGuard
                      ? state.seekBufferGraceUntil
                      : 0,
                  });
                  if (!guard.shouldTrigger) {
                    emitPlaybackDebugLog(
                      'hls-recovery-ignored',
                      '已忽略 HLS.js waiting 恢复',
                      {
                        reason: guard.reason,
                        timerSessionId,
                        currentSessionId: state.playbackSessionId,
                        startedAt,
                        waitedMs: now - startedAt,
                        currentTime: Number(
                          (video.currentTime || 0).toFixed(2)
                        ),
                        readyState: video.readyState,
                        networkState: video.networkState,
                        paused: video.paused,
                        seeking: video.seeking,
                        ended: video.ended,
                      },
                      {
                        playbackUrl:
                          video.currentSrc || videoUrlRef.current || url,
                      }
                    );
                    return;
                  }
                  triggerRecovery(
                    '播放器等待缓冲超时',
                    'mediaError',
                    'waitingTimeout',
                    false
                  );
                }, 4000);
              };

              const handleVideoPlaying = () => {
                clearWaitingRecoveryTimer();
                markHlsPlaybackProgress(video.currentTime || 0);
                scheduleProgressiveSourceProbe();
              };

              const handleVideoCanplay = () => {
                clearWaitingRecoveryTimer();
              };

              const handleVideoTimeupdate = () => {
                clearWaitingRecoveryTimer();
                if (dispatchTimeupdateForAdSkip(video, 'hlsjs')) {
                  return;
                }
                markHlsPlaybackProgress(video.currentTime || 0);
                scheduleProgressiveSourceProbe();
              };

              const handleVideoSeeking = () => {
                resetProgressiveSourceProbeStability();
                if (systemSeekInFlightRef.current) {
                  return;
                }
                markHlsUserSeeking(video.currentTime || 0);
              };

              const handleVideoSeeked = () => {
                resetProgressiveSourceProbeStability();
                if (systemSeekInFlightRef.current) {
                  systemSeekInFlightRef.current = false;
                  settleSystemRecoverySeekIfNeeded();
                  return;
                }
                markHlsUserSeeked(video.currentTime || 0);
              };

              video.recoveryWaitingListener = handleVideoWaiting;
              video.recoveryPlayingListener = handleVideoPlaying;
              video.recoveryCanplayListener = handleVideoCanplay;
              video.recoveryTimeupdateListener = handleVideoTimeupdate;
              video.recoverySeekingListener = handleVideoSeeking;
              video.recoverySeekedListener = handleVideoSeeked;
              video.addEventListener('waiting', handleVideoWaiting);
              video.addEventListener('playing', handleVideoPlaying);
              video.addEventListener('canplay', handleVideoCanplay);
              video.addEventListener('timeupdate', handleVideoTimeupdate);
              video.addEventListener('seeking', handleVideoSeeking);
              video.addEventListener('seeked', handleVideoSeeked);

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
          setErrorKind('generic');
          setError(null);
          // 更新视频时长
          const duration = artPlayerRef.current.duration || 0;
          setVideoDuration(duration);
        });

        artPlayerRef.current.on('video:volumechange', () => {
          lastVolumeRef.current = artPlayerRef.current.volume;
        });

        artPlayerRef.current.on('video:waiting', () => {
          resetProgressiveSourceProbeStability();
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
          resetProgressiveSourceProbeStability();
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
          resetProgressiveSourceProbeStability();
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
          if (playbackPolicyRef.current?.runtime !== 'native-hls') {
            markHlsUserPlay();
          } else if (isPlaybackIntentSessionAuthorityEnabled()) {
            dispatchPlaybackSessionEvent({ type: 'user.play' });
          }
          emitNativeVideoStateDebugLog(
            'native-video-play',
            '原生播放器收到播放请求'
          );
          scheduleNativeFalsePlayingCheck();
        });

        artPlayerRef.current.on('video:pause', () => {
          resetProgressiveSourceProbeStability();
          const video = artPlayerRef.current.video as
            | HTMLVideoElement
            | undefined;
          const state = nativeRecoveryStateRef.current;
          const now = Date.now();
          const mediaSourceUnavailable = video
            ? isNativeMediaSourceUnavailable(video)
            : false;
          const recentlyHadBufferIssue =
            state.lastBufferIssueAt > 0 &&
            now - state.lastBufferIssueAt <=
              NATIVE_RECENT_BUFFER_ISSUE_WINDOW_MS;
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
            if (playbackPolicyRef.current?.runtime !== 'native-hls') {
              markHlsUserPause(video?.currentTime || 0);
            } else if (isPlaybackIntentSessionAuthorityEnabled()) {
              dispatchPlaybackSessionEvent({ type: 'user.pause' });
            }
          } else {
            state.pauseReason = 'buffering';
            // Q1: buffer/loading misclassification must not leave Session Intent
            // as playing when session authority is on — stamp pause so gates
            // cannot be bypassed by the legacy Native track.
            if (isPlaybackIntentSessionAuthorityEnabled()) {
              dispatchPlaybackSessionEvent({ type: 'user.pause' });
            }
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
          if (playbackPolicyRef.current?.runtime === 'native-hls') {
            markPlaybackHealthy(currentTime);
          } else {
            clearWaitingRecoveryTimer();
            markHlsPlaybackProgress(currentTime);
          }
          scheduleProgressiveSourceProbe();

          // 同时更新时长（防止ready事件中获取不到）
          const duration = artPlayerRef.current.duration || 0;
          if (duration > 0 && videoDuration !== duration) {
            setVideoDuration(duration);
          }
        });

        // 监听视频可播放事件，这时恢复播放进度更可靠
        artPlayerRef.current.on('video:canplay', () => {
          clearWaitingRecoveryTimer();
          clearSourceChangeTimeoutTimer();
          dispatchPlaybackSessionEvent({
            type: 'sourceChange.completed',
            attemptId: sourceChangeAttemptIdRef.current,
            sourceKey: getCurrentSourceKey(),
          });
          if (playbackPolicyRef.current?.runtime === 'native-hls') {
            markPlaybackHealthy(artPlayerRef.current.currentTime || 0);
          }
          scheduleProgressiveSourceProbe();
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
              const adapted = adaptWatchProgressPlayhead({
                playTime: resumeTimeRef.current,
                sourceTotalTime: sourceDurationBeforeSwitchRef.current,
                targetTotalTime: duration,
              });
              const target = clampSourceSwitchResumeTime({
                resumeTime: adapted,
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
                    artPlayerRef.current?.video?.currentSrc ||
                    videoUrlRef.current,
                }
              );
            } catch (err) {
              console.warn('恢复播放进度失败:', err);
            }
          }
          resumeTimeRef.current = null;
          if (
            isPlaybackRecoverySessionAuthorityEnabled() &&
            (playbackSessionStateRef.current.recoveryInFlight === 'resume' ||
              playbackSessionStateRef.current.recoveryResumeTime != null)
          ) {
            dispatchPlaybackSessionEvent({
              type: 'recovery.effectSettled',
              kind: 'resume',
              nowMs: Date.now(),
            });
          }

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
          dispatchVideoPlaybackUi({ type: 'loading.end' });

          const shouldAutoPlayAfterSourceSwitch =
            sourceSwitchAutoPlayPendingRef.current;
          sourceSwitchAutoPlayPendingRef.current = false;
          const nativeState = nativeRecoveryStateRef.current;
          const canplayVideo = artPlayerRef.current?.video as
            | HTMLVideoElement
            | undefined;
          // D1 ff31a0a3: buffering pause left playIntent=playing + paused=true at
          // canplay/readyState>=3; without this, watchdog treated paused as user stop.
          const shouldResumeAfterBufferingPause =
            playbackPolicyRef.current?.runtime === 'native-hls' &&
            nativeState.playIntent === 'playing' &&
            Boolean(canplayVideo?.paused);
          if (
            shouldAutoPlayAfterSourceSwitch ||
            shouldResumeAfterBufferingPause
          ) {
            requestNativeRecoveryAutoplay(canplayVideo, {
              trigger: shouldAutoPlayAfterSourceSwitch
                ? 'video-canplay'
                : 'video-canplay-buffering-resume',
              resumeTime: appliedResumeTime,
              sourceKey: getCurrentSourceKey(),
              pauseReason: nativeState.pauseReason,
            });
          }

          if (sourceSwitchSavePendingRef.current) {
            sourceSwitchSavePendingRef.current = false;
            setTimeout(() => {
              void requestSaveCurrentPlayProgress('resume-sync');
            }, 0);
          }

          if (!startupFeedbackSentRef.current) {
            startupFeedbackSentRef.current = true;
            const currentVideoInfo = precomputedVideoInfoRef.current.get(
              getCurrentSourceKey()
            );
            const startedAt = playbackStartupStartedAtRef.current;
            const startupTimeMs =
              startedAt && startedAt > 0 ? Date.now() - startedAt : undefined;
            rememberCurrentSourcePlaybackQuality({
              mode: 'direct',
              startupTimeMs,
              browserSpeedLabel:
                currentVideoInfo &&
                !currentVideoInfo.hasError &&
                currentVideoInfo.loadSpeed !== '未知'
                  ? currentVideoInfo.loadSpeed
                  : undefined,
              confidence: 'high',
            });
            void reportPlaybackFeedback({
              sourceKey: getCurrentSourceKey(),
              playbackDomain: getCurrentPlaybackDomain(),
              title: videoTitleRef.current,
              playbackMode: playbackModeRef.current,
              startupSuccess: true,
              startupTimeMs,
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
          clearWaitingRecoveryTimer();
          if (playbackPolicyRef.current?.runtime === 'native-hls') {
            markPlaybackHealthy(artPlayerRef.current.currentTime || 0);
          } else {
            markHlsPlaybackProgress(artPlayerRef.current.currentTime || 0);
          }
          scheduleProgressiveSourceProbe();
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

          if (
            playbackPolicyRef.current?.recoveryProfile === 'native-video' &&
            video
          ) {
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

          void trySwitchToNextAvailableSource(
            '播放器错误，自动切换到其他播放源'
          ).then((switched) => {
            if (switched) {
              return;
            }

            if (!startupFeedbackSentRef.current) {
              startupFeedbackSentRef.current = true;
              const startupTimeMs =
                playbackStartupStartedAtRef.current &&
                playbackStartupStartedAtRef.current > 0
                  ? Date.now() - playbackStartupStartedAtRef.current
                  : undefined;
              const sessionError =
                err instanceof Error
                  ? err.message
                  : typeof err === 'string'
                  ? err
                  : '播放器启动失败';
              rememberCurrentSourcePlaybackQuality({
                mode: 'unavailable',
                startupTimeMs,
                lastError: sessionError,
                confidence: 'medium',
              });
              void reportPlaybackFeedback({
                sourceKey: getCurrentSourceKey(),
                playbackDomain: getCurrentPlaybackDomain(),
                title: videoTitleRef.current,
                playbackMode: playbackModeRef.current,
                startupSuccess: false,
                startupTimeMs,
                switchedToProxy: playbackModeRef.current === 'proxy',
                sessionError,
              });
            }
          });
          return;
        });

        // 监听视频播放结束事件，自动播放下一集（先存上一集完成态）
        artPlayerRef.current.on('video:ended', () => {
          const d = detailRef.current;
          const idx = currentEpisodeIndexRef.current;
          if (d && d.episodes && idx < d.episodes.length - 1) {
            const player = artPlayerRef.current;
            const playTime = Math.floor(player?.currentTime || 0);
            const totalTime = Math.floor(player?.duration || 0);
            const result = dispatchPlaybackSessionEvent({
              type: 'video.ended',
              nextEpisodeIndex: idx + 1,
              nowMs: Date.now(),
            });
            void executeSaveProgressEffects(result.effects, {
              playTime,
              totalTime,
            }).then(() => {
              setTimeout(() => {
                setCurrentEpisodeIndex(idx + 1);
              }, 1000);
            });
          }
        });

        artPlayerRef.current.on('video:timeupdate', () => {
          const now = Date.now();
          const interval = getPlayRecordHeartbeatIntervalMs(
            getRuntimeStorageType()
          );
          if (now - lastSaveTimeRef.current > interval) {
            requestSaveCurrentPlayProgress('heartbeat');
            lastSaveTimeRef.current = now;
          }
        });

        artPlayerRef.current.on('pause', () => {
          requestSaveCurrentPlayProgress('pause');
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
        setPlaybackError('播放器初始化失败', 'player');
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
      clearSourceChangeTimeoutTimer();
      clearProgressiveSourceProbeTimer();
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
    const errorCopy: Record<
      PlaybackErrorKind,
      { title: string; description: string; eyebrow: string }
    > = {
      'missing-params': {
        eyebrow: '播放参数缺失',
        title: '缺少必要播放信息',
        description: '当前链接没有提供可用于定位影片的片名或播放源。',
      },
      'not-found': {
        eyebrow: '资源未命中',
        title: '未找到匹配结果',
        description: '当前片名或播放源没有匹配到可播放资源，可以重新搜索片名。',
      },
      'history-expired': {
        eyebrow: '历史记录已过期',
        title: '旧播放记录暂时不可用',
        description:
          '这条历史记录对应的资源站资源可能已经下架或更换编号，当前也没有找到可替代线路。',
      },
      'source-unavailable': {
        eyebrow: '线路不可用',
        title: '当前播放源不可用',
        description: '可以重新尝试，或返回搜索页选择其他播放源。',
      },
      player: {
        eyebrow: '播放器异常',
        title: '播放器初始化失败',
        description: '播放环境没有正常创建，可以刷新后重试。',
      },
      generic: {
        eyebrow: '播放异常',
        title: '播放遇到问题',
        description: '请检查网络连接，或稍后重新尝试。',
      },
    };
    const copy = errorCopy[errorKind] || errorCopy.generic;
    const searchTarget = searchTitle || videoTitle;

    return (
      <PageLayout activePath='/play'>
        <div className='flex min-h-[70vh] items-center justify-center px-3'>
          <Surface
            variant='frosted'
            className='ui-loading-panel mx-auto w-full max-w-xl px-6 py-8 text-center sm:px-8 sm:py-10'
          >
            <div className='mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-[rgba(var(--ui-critical),0.24)] bg-[rgba(var(--ui-critical),0.12)] text-[rgb(var(--ui-critical))] shadow-ui-soft'>
              <AlertCircle className='h-10 w-10' strokeWidth={1.6} />
            </div>

            <div className='mt-6 space-y-3'>
              <p className='text-[11px] font-semibold uppercase tracking-[0.28em] text-[rgb(var(--ui-accent-warm))]'>
                {copy.eyebrow}
              </p>
              <h2 className='text-2xl font-semibold tracking-tight text-[rgb(var(--ui-text))] sm:text-3xl'>
                {copy.title}
              </h2>
              <p className='mx-auto max-w-md text-sm leading-6 text-[rgb(var(--ui-text-muted))]'>
                {copy.description}
              </p>
            </div>

            <div className='mt-7 rounded-ui-md border border-[rgba(var(--ui-critical),0.22)] bg-[rgba(var(--ui-critical),0.08)] px-4 py-3 text-sm font-medium text-[rgb(var(--ui-text))]'>
              {error}
            </div>

            <div className='mt-8 grid gap-3 sm:grid-cols-3'>
              <button
                type='button'
                onClick={() => window.location.reload()}
                className='inline-flex min-h-11 items-center justify-center gap-2 rounded-ui-md bg-[rgb(var(--ui-accent))] px-4 text-sm font-semibold text-[rgb(var(--ui-on-accent))] shadow-ui-soft transition hover:brightness-110'
              >
                <RefreshCw className='h-4 w-4' />
                重新尝试
              </button>

              {searchTarget ? (
                <button
                  type='button'
                  onClick={() =>
                    router.push(`/search?q=${encodeURIComponent(searchTarget)}`)
                  }
                  className='inline-flex min-h-11 items-center justify-center gap-2 rounded-ui-md border border-white/10 bg-white/5 px-4 text-sm font-semibold text-[rgb(var(--ui-text))] transition hover:bg-white/10'
                >
                  <Search className='h-4 w-4' />
                  搜索片名
                </button>
              ) : null}

              <button
                type='button'
                onClick={() => router.back()}
                className='inline-flex min-h-11 items-center justify-center gap-2 rounded-ui-md border border-white/10 bg-white/5 px-4 text-sm font-semibold text-[rgb(var(--ui-text-muted))] transition hover:bg-white/10 hover:text-[rgb(var(--ui-text))]'
              >
                <ArrowLeft className='h-4 w-4' />
                返回上页
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

              {/* 手动标记 / 跳过广告（#37）：桌面与移动端均可点 */}
              {!adSkipUndoToast && (
                <div className='pointer-events-none absolute inset-x-0 bottom-14 z-40 flex justify-end px-3 md:bottom-16'>
                  <button
                    type='button'
                    onClick={handleMarkAdSkip}
                    className='pointer-events-auto rounded-full border border-white/25 bg-black/70 px-3 py-1.5 text-xs font-medium text-white shadow-ui-strong backdrop-blur transition hover:bg-black/85 md:px-4 md:py-2 md:text-sm'
                    aria-label='标记并跳过当前广告'
                  >
                    标记广告并跳过
                  </button>
                </div>
              )}

              {/* 可撤销广告跳过：浮在进度条上方，不挡底部控件 */}
              {adSkipUndoToast && (
                <div className='pointer-events-none absolute inset-x-0 bottom-14 z-40 flex justify-center px-3 md:bottom-16'>
                  <button
                    type='button'
                    onClick={handleUndoAdSkip}
                    className='pointer-events-auto rounded-full border border-white/25 bg-black/80 px-4 py-2 text-sm font-medium text-white shadow-ui-strong backdrop-blur transition hover:bg-black/90'
                    aria-label='撤销广告跳过并恢复播放位置'
                  >
                    已为你跳过广告 · 点此恢复
                  </button>
                </div>
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

        {/* 详情展示 + 猜你喜欢 */}
        <PlayDetailSection
          cover={videoCover || detail?.poster}
          detail={detail}
          title={videoTitle}
          year={videoYear}
        />
        <PlayRecommendations
          excludeTitle={videoTitle}
          preferCategory={detail ? classifySearchResult(detail) : 'movie'}
        />
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
