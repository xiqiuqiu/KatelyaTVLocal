/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

export const runtime = 'edge';

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
import {
  filterAdsFromM3U8,
  formatM3U8AdFilterDebugMessage,
  getM3U8AdFilterDebugInfo,
} from '@/lib/hls-ad-filter';
import {
  detectAppleNativeHlsEnvironment,
  resolveHlsPlaybackPolicy,
} from '@/lib/hls-playback-policy';
import { getHlsRecoveryPlan } from '@/lib/hls-recovery';
import {
  type PlayRecordSaveReason,
  type PlayRecordSaveSnapshot,
  getPlayRecordHeartbeatIntervalMs,
  shouldSavePlayRecord,
} from '@/lib/play-record-save-policy';
import { getSourceSwitchResumePlan } from '@/lib/playback-source-switch';
import { getBrowserProbeBudget } from '@/lib/source-preference';
import { fetchSourcePreferencesInBatches } from '@/lib/source-preference-client';
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
  probeSourcePlayback,
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

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
    recoveryWaitingListener?: EventListener;
    recoveryPlayingListener?: EventListener;
  }
}

const directAdFilterDebugLogKeys = new Set<string>();

function logDirectAdFilterDebug(
  playlistUrl: string | undefined,
  originalContent: string,
  filteredContent: string,
  playlistType: string | undefined
): void {
  const debugInfo = getM3U8AdFilterDebugInfo(
    originalContent,
    filteredContent,
    playlistUrl
  );

  if (!debugInfo.shouldLog) {
    return;
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
    return;
  }

  directAdFilterDebugLogKeys.add(logKey);

  const message = `[去广告][直连] ${formatM3U8AdFilterDebugMessage(debugInfo)}`;

  console.log(message, {
    playlistUrl,
    playlistType,
    removedLineCount: debugInfo.removedLineCount,
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
  const sourceFallbackAttemptedRef = useRef(false);
  const sourceSwitchSavePendingRef = useRef(false);
  const playbackPolicyLogKeysRef = useRef(new Set<string>());

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
  const availableSourcesRef = useRef<SearchResult[]>([]);
  const precomputedVideoInfoRef = useRef<Map<string, SourceVideoInfo>>(
    new Map()
  );
  const precomputedSourceStatusesRef = useRef<Map<string, SourceStatus>>(
    new Map()
  );
  const playbackStartupStartedAtRef = useRef<number | null>(null);
  const startupFeedbackSentRef = useRef(false);
  const waitingRecoveryTimerRef = useRef<number | null>(null);
  const autoRecoveredSourceKeysRef = useRef<Set<string>>(new Set());
  const hlsRecoveryStateRef = useRef({
    stallCount: 0,
    networkRecoveryAttempts: 0,
    mediaRecoveryAttempts: 0,
    lastErrorAt: 0,
    lastPlaybackTime: 0,
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
    availableSourcesRef.current = availableSources;
  }, [availableSources]);

  useEffect(() => {
    precomputedVideoInfoRef.current = precomputedVideoInfo;
  }, [precomputedVideoInfo]);

  useEffect(() => {
    precomputedSourceStatusesRef.current = precomputedSourceStatuses;
  }, [precomputedSourceStatuses]);

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

  const resetHlsRecoveryCounters = () => {
    clearWaitingRecoveryTimer();
    hlsRecoveryStateRef.current.stallCount = 0;
    hlsRecoveryStateRef.current.networkRecoveryAttempts = 0;
    hlsRecoveryStateRef.current.mediaRecoveryAttempts = 0;
    hlsRecoveryStateRef.current.lastErrorAt = 0;
    hlsRecoveryStateRef.current.lastPlaybackTime = 0;
  };

  const markPlaybackHealthy = (currentTime?: number) => {
    clearWaitingRecoveryTimer();

    if (typeof currentTime === 'number') {
      const lastPlaybackTime = hlsRecoveryStateRef.current.lastPlaybackTime;
      if (currentTime > lastPlaybackTime + 0.25) {
        hlsRecoveryStateRef.current.stallCount = 0;
      }
      hlsRecoveryStateRef.current.lastPlaybackTime = currentTime;
      return;
    }

    hlsRecoveryStateRef.current.stallCount = 0;
  };

  const getRecoverySourcePriority = (source: SearchResult) => {
    const sourceKey = getSourceIdentityKey(source.source, source.id);
    const status =
      precomputedSourceStatusesRef.current.get(sourceKey) ||
      getRememberedSourceStatus(source.episodes);

    if (status?.kind === 'direct') return 0;
    if (!status || status.kind === 'idle' || status.kind === 'probing') {
      return 1;
    }
    if (status?.kind === 'proxy') return 2;
    return 3;
  };

  const getNextRecoverySource = () => {
    const currentSourceKey = getCurrentSourceKey();

    return [...availableSourcesRef.current]
      .filter((source) => {
        const sourceKey = getSourceIdentityKey(source.source, source.id);
        if (sourceKey === currentSourceKey) {
          return false;
        }

        if (autoRecoveredSourceKeysRef.current.has(sourceKey)) {
          return false;
        }

        if (!source.episodes || source.episodes.length === 0) {
          return false;
        }

        const status =
          precomputedSourceStatusesRef.current.get(sourceKey) ||
          getRememberedSourceStatus(source.episodes);

        return status?.kind !== 'unavailable';
      })
      .sort(
        (a, b) => getRecoverySourcePriority(a) - getRecoverySourcePriority(b)
      )[0];
  };

  const tryNudgePlayback = (video: HTMLVideoElement | null) => {
    if (!video) {
      return false;
    }

    const buffered = video.buffered;
    const currentTime = video.currentTime || 0;

    for (let index = 0; index < buffered.length; index += 1) {
      const start = buffered.start(index);
      const end = buffered.end(index);

      if (currentTime >= start - 0.5 && currentTime <= end + 0.5) {
        const nudgedTime = Math.min(end - 0.1, currentTime + 0.35);
        if (nudgedTime > currentTime + 0.01) {
          video.currentTime = nudgedTime;
          return true;
        }
      }

      if (currentTime < start && start - currentTime < 1.5) {
        video.currentTime = Math.min(start + 0.05, end - 0.05);
        return true;
      }
    }

    void video.play().catch(() => undefined);
    return false;
  };

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

  // 播放源优选函数
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) {
      setPrecomputedSourceStatuses(new Map());
      setPrecomputedVideoInfo(new Map());
      return sources[0];
    }

    const sourceEntries = sources.map((source) => ({
      source,
      sourceKey: getSourceIdentityKey(source.source, source.id),
      rememberedStatus: getRememberedSourceStatus(source.episodes),
    }));

    const sourceEntryMap = new Map(
      sourceEntries.map((entry) => [entry.sourceKey, entry])
    );
    const effectiveStatusMap = new Map<string, SourceStatus | null>();

    sourceEntries.forEach(({ source, sourceKey, rememberedStatus }) => {
      if (!source.episodes || source.episodes.length === 0) {
        effectiveStatusMap.set(
          sourceKey,
          createSourceStatus('unavailable', {
            reason: '该播放源没有可用剧集',
          })
        );
        return;
      }

      effectiveStatusMap.set(sourceKey, rememberedStatus || null);
    });

    let orderedSourceKeys = sourceEntries.map(({ sourceKey }) => sourceKey);
    const seededVideoInfoMap = new Map<string, SourceVideoInfo>();

    try {
      const probeEpisodeIndex = Math.max(
        0,
        Math.min(currentEpisodeIndexRef.current, sources[0].episodes.length - 1)
      );
      const preferenceData = await fetchSourcePreferencesInBatches(
        sourceEntries.map(({ source, sourceKey }) => ({
          sourceKey,
          episodeUrl:
            source.episodes?.[
              Math.max(
                0,
                Math.min(probeEpisodeIndex, source.episodes.length - 1)
              )
            ] || null,
        }))
      );

      if (preferenceData.orderedSourceKeys.length > 0) {
        orderedSourceKeys = preferenceData.orderedSourceKeys;
      }

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

        effectiveStatusMap.set(result.sourceKey, nextStatus);
        if (measured) {
          seededVideoInfoMap.set(result.sourceKey, measured);
        }
        rememberSourceDomainPreference(
          result.domain || null,
          result.kind,
          result.reason
        );
      });
    } catch (error) {
      const fallbackProbeCandidates = sourceEntries
        .filter(({ sourceKey, source }) => {
          const status = effectiveStatusMap.get(sourceKey);
          return (
            source.episodes?.length &&
            (!status || status.kind === 'idle' || status.kind === 'probing')
          );
        })
        .slice(0, 6);

      await Promise.all(
        fallbackProbeCandidates.map(async ({ source, sourceKey }) => {
          const probeEpisodeIndex = Math.max(
            0,
            Math.min(currentEpisodeIndexRef.current, source.episodes.length - 1)
          );
          const episodeUrl = source.episodes?.[probeEpisodeIndex];
          if (!episodeUrl) {
            return;
          }

          const probeResult = await probeSourcePlayback(episodeUrl);
          effectiveStatusMap.set(
            sourceKey,
            createSourceStatus(probeResult.kind, {
              reason: probeResult.reason,
              playbackMode:
                probeResult.kind === 'unavailable'
                  ? undefined
                  : probeResult.kind,
              domain: probeResult.domain || null,
            })
          );
          rememberSourceDomainPreference(
            probeResult.domain || null,
            probeResult.kind,
            probeResult.reason
          );
        })
      );

      console.warn('批量优选失败，已回退到逐源探测', error);
    }

    const orderedEntries = orderedSourceKeys
      .map((sourceKey) => sourceEntryMap.get(sourceKey))
      .filter(Boolean) as typeof sourceEntries;
    const orderedKeySet = new Set(
      orderedEntries.map((entry) => entry.sourceKey)
    );
    sourceEntries.forEach((entry) => {
      if (!orderedKeySet.has(entry.sourceKey)) {
        orderedEntries.push(entry);
      }
    });

    const normalizedStatusMap = new Map<string, SourceStatus>();
    orderedEntries.forEach(({ sourceKey }) => {
      const status = effectiveStatusMap.get(sourceKey);
      if (status) {
        normalizedStatusMap.set(sourceKey, status);
      }
    });
    setPrecomputedSourceStatuses(new Map(normalizedStatusMap));

    const directProbeCandidates = orderedEntries
      .filter(
        ({ sourceKey }) => normalizedStatusMap.get(sourceKey)?.kind === 'direct'
      )
      .slice(0, getBrowserProbeBudget(orderedEntries.length));

    if (directProbeCandidates.length === 0) {
      const firstAvailableSource = orderedEntries.find(
        ({ sourceKey }) =>
          normalizedStatusMap.get(sourceKey)?.kind !== 'unavailable'
      );
      setPrecomputedVideoInfo(new Map(seededVideoInfoMap));
      return firstAvailableSource?.source || sources[0];
    }

    // 将播放源均分为两批，并发测速各批，避免一次性过多请求
    const batchSize = Math.ceil(directProbeCandidates.length / 2);
    const allResults: Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    } | null> = [];

    for (
      let start = 0;
      start < directProbeCandidates.length;
      start += batchSize
    ) {
      const batchSources = directProbeCandidates.slice(
        start,
        start + batchSize
      );
      const batchResults = await Promise.all(
        batchSources.map(async ({ source }) => {
          try {
            // 使用当前集做测速，避免某一集异常导致整源误判
            if (!source.episodes || source.episodes.length === 0) {
              console.warn(`播放源 ${source.source_name} 没有可用的播放地址`);
              return null;
            }

            const probeEpisodeIndex = Math.max(
              0,
              Math.min(
                currentEpisodeIndexRef.current,
                source.episodes.length - 1
              )
            );
            const episodeUrl = source.episodes[probeEpisodeIndex];
            const testResult = await getVideoResolutionFromM3u8(episodeUrl);
            const status = normalizedStatusMap.get(
              getSourceIdentityKey(source.source, source.id)
            );
            rememberSourceDomainPreference(status?.domain || null, 'direct');

            return {
              source,
              testResult,
            };
          } catch (error) {
            return null;
          }
        })
      );
      allResults.push(...batchResults);
    }

    // 等待所有测速完成，包含成功和失败的结果
    // 保存所有测速结果到 precomputedVideoInfo，供 EpisodeSelector 使用（包含错误结果）
    const newVideoInfoMap = new Map<
      string,
      {
        quality: string;
        loadSpeed: string;
        pingTime: number;
        hasError?: boolean;
        errorReason?: string;
      }
    >();
    allResults.forEach((result, index) => {
      const candidate = directProbeCandidates[index];
      if (!candidate) {
        return;
      }

      const sourceKey = candidate.sourceKey;

      if (result) {
        // 成功的结果
        newVideoInfoMap.set(sourceKey, result.testResult);
      } else {
        newVideoInfoMap.set(sourceKey, {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
          errorReason: '初始化测速失败，可尝试播放',
        });
      }
    });

    // 过滤出成功的结果用于优选计算
    const successfulResults = allResults.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    }>;

    const mergedVideoInfoMap = new Map(seededVideoInfoMap);
    newVideoInfoMap.forEach((value, key) => {
      mergedVideoInfoMap.set(key, value);
    });

    setPrecomputedVideoInfo(mergedVideoInfoMap);

    if (successfulResults.length === 0) {
      console.warn('候选播放源测速都失败，回退到第一个未标记不可用的播放源');
      const fallbackSource = orderedEntries.find(
        ({ sourceKey }) =>
          normalizedStatusMap.get(sourceKey)?.kind !== 'unavailable'
      );
      return fallbackSource?.source || sources[0];
    }

    // 找出所有有效速度的最大值，用于线性映射
    const validSpeeds = successfulResults
      .map((result) => {
        const speedStr = result.testResult.loadSpeed;
        if (speedStr === '未知' || speedStr === '测量中...') return 0;

        const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
        if (!match) return 0;

        const value = parseFloat(match[1]);
        const unit = match[2];
        return unit === 'MB/s' ? value * 1024 : value; // 统一转换为 KB/s
      })
      .filter((speed) => speed > 0);

    const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024; // 默认1MB/s作为基准

    // 找出所有有效延迟的最小值和最大值，用于线性映射
    const validPings = successfulResults
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);

    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    // 计算每个结果的评分
    const resultsWithScore = successfulResults.map((result) => ({
      ...result,
      score: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing
      ),
    }));

    // 按综合评分排序，选择最佳播放源
    resultsWithScore.sort((a, b) => b.score - a.score);

    console.log('播放源评分排序结果:');
    resultsWithScore.forEach((result, index) => {
      console.log(
        `${index + 1}. ${
          result.source.source_name
        } - 评分: ${result.score.toFixed(2)} (${result.testResult.quality}, ${
          result.testResult.loadSpeed
        }, ${result.testResult.pingTime}ms)`
      );
    });

    return resultsWithScore[0].source;
  };

  // 计算播放源综合评分
  const calculateSourceScore = (
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
    },
    maxSpeed: number,
    minPing: number,
    maxPing: number
  ): number => {
    let score = 0;

    // 分辨率评分 (40% 权重)
    const qualityScore = (() => {
      switch (testResult.quality) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080p':
          return 75;
        case '720p':
          return 60;
        case '480p':
          return 40;
        case 'SD':
          return 20;
        default:
          return 0;
      }
    })();
    score += qualityScore * 0.4;

    // 下载速度评分 (40% 权重) - 基于最大速度线性映射
    const speedScore = (() => {
      const speedStr = testResult.loadSpeed;
      if (speedStr === '未知' || speedStr === '测量中...') return 30;

      // 解析速度值
      const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
      if (!match) return 30;

      const value = parseFloat(match[1]);
      const unit = match[2];
      const speedKBps = unit === 'MB/s' ? value * 1024 : value;

      // 基于最大速度线性映射，最高100分
      const speedRatio = speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    // 网络延迟评分 (20% 权重) - 基于延迟范围线性映射
    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0; // 无效延迟给默认分

      // 如果所有延迟都相同，给满分
      if (maxPing === minPing) return 100;

      // 线性映射：最低延迟=100分，最高延迟=0分
      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    return Math.round(score * 100) / 100; // 保留两位小数
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

    const rememberedStatus = detailData
      ? getRememberedSourceStatus(detailData.episodes)
      : null;
    const proxyUrl = buildHlsProxyUrl(directUrl);
    const rememberedPlaybackMode =
      rememberedStatus?.kind === 'proxy'
        ? 'proxy'
        : rememberedStatus?.playbackMode || null;
    const playbackPolicy = resolveHlsPlaybackPolicy({
      directUrl,
      proxyUrl,
      rememberedPlaybackMode,
      isAppleNativeHlsEnvironment: isAppleNativeHlsPlaybackEnvironment(),
    });

    applyPlaybackMode(playbackPolicy.mode);
    logHlsPlaybackPolicy(directUrl, proxyUrl, playbackPolicy);

    const nextUrl = playbackPolicy.url;

    if (nextUrl !== videoUrlRef.current) {
      startupFeedbackSentRef.current = false;
      playbackStartupStartedAtRef.current = Date.now();
      resetHlsRecoveryCounters();
      setVideoUrl(nextUrl);
    }
  };

  const trySwitchToProxyPlayback = () => {
    const directUrl = originalVideoUrlRef.current;
    const proxyUrl = buildHlsProxyUrl(directUrl);
    const currentPlayTime = artPlayerRef.current?.currentTime || 0;

    if (
      playbackModeRef.current === 'proxy' ||
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
    resetHlsRecoveryCounters();
    applyPlaybackMode('proxy');
    setVideoLoadingStage('sourceChanging');
    setIsVideoLoading(true);
    setError(null);
    setVideoUrl(proxyUrl);
    return true;
  };

  const trySwitchToNextAvailableSource = (reason: string) => {
    const nextSource = getNextRecoverySource();
    if (!nextSource) {
      return false;
    }

    const currentSourceKey = getCurrentSourceKey();
    if (currentSourceKey) {
      autoRecoveredSourceKeysRef.current.add(currentSourceKey);
    }
    autoRecoveredSourceKeysRef.current.add(
      getSourceIdentityKey(nextSource.source, nextSource.id)
    );

    console.warn(`${reason}，自动切换到播放源: ${nextSource.source_name}`);
    resetHlsRecoveryCounters();
    void handleSourceChange(nextSource.source, nextSource.id, nextSource.title);
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
    policy: ReturnType<typeof resolveHlsPlaybackPolicy>
  ) => {
    if (
      policy.reason !== 'apple-native-hls-ad-filter' &&
      policy.reason !== 'proxy-unavailable'
    ) {
      return;
    }

    const logKey = JSON.stringify({
      directUrl,
      proxyUrl,
      mode: policy.mode,
      reason: policy.reason,
    });

    if (playbackPolicyLogKeysRef.current.has(logKey)) {
      return;
    }

    playbackPolicyLogKeysRef.current.add(logKey);

    if (policy.reason === 'apple-native-hls-ad-filter') {
      console.info(
        '[去广告][播放策略] 当前终端可能使用系统 HLS，已使用代理过滤播放列表',
        {
          directUrl,
          proxyUrl,
          playbackMode: policy.mode,
        }
      );
      return;
    }

    console.warn(
      '[去广告][播放策略] 当前终端可能绕过前端过滤，但代理地址不可用，暂时使用直连播放',
      {
        directUrl,
        playbackMode: policy.mode,
      }
    );
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
              // 如果是m3u8文件，处理内容以移除广告分段
              if (response.data && typeof response.data === 'string') {
                const originalContent = response.data;
                const playlistUrl = response.url || context?.url;
                const filteredContent = filterAdsFromM3U8(
                  originalContent,
                  playlistUrl
                );

                logDirectAdFilterDebug(
                  playlistUrl,
                  originalContent,
                  filteredContent,
                  context?.type
                );

                response.data = filteredContent;
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
    newTitle: string
  ) => {
    try {
      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);
      sourceSwitchSavePendingRef.current = false;

      // 记录当前播放进度（仅在同一集数切换时恢复）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('换源前当前播放时间:', currentPlayTime);

      const newDetail = availableSources.find(
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
      let targetIndex = currentEpisodeIndex;

      // 如果当前集数超出新源的范围，则跳转到第一集
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }
      sourceFallbackAttemptedRef.current = false;

      const resumePlan = getSourceSwitchResumePlan({
        currentEpisodeIndex,
        targetEpisodeIndex: targetIndex,
        currentPlayTime,
        existingResumeTime: resumeTimeRef.current,
      });
      resumeTimeRef.current = resumePlan.resumeTime;
      sourceSwitchSavePendingRef.current = resumePlan.saveAfterCanPlay;

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

        const isWebkit = isAppleNativeHlsPlaybackEnvironment();

        // 非WebKit浏览器且播放器已存在，使用switch方法切换
        if (!isWebkit && artPlayerRef.current) {
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

        // WebKit浏览器或首次创建：销毁之前的播放器实例并创建新的
        if (artPlayerRef.current) {
          if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
            artPlayerRef.current.video.hls.destroy();
          }
          // 销毁播放器实例
          artPlayerRef.current.destroy();
          artPlayerRef.current = null;
        }

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

          // 若存在需要恢复的播放进度，则跳转
          if (resumeTimeRef.current && resumeTimeRef.current > 0) {
            try {
              const duration = artPlayerRef.current.duration || 0;
              let target = resumeTimeRef.current;
              if (duration && target >= duration - 2) {
                target = Math.max(0, duration - 5);
              }
              artPlayerRef.current.currentTime = target;
              console.log('成功恢复播放进度到:', resumeTimeRef.current);
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
        });

        artPlayerRef.current.on('error', (err: any) => {
          console.error('播放器错误:', err);
          if (trySwitchToProxyPlayback()) {
            console.log('播放器错误，已切换到代理重试');
            return;
          }

          if (artPlayerRef.current.currentTime > 0) {
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
