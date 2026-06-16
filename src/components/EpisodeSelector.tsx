'use client';

/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { detectPlaybackProbePlatform } from '@/lib/hls-playback-policy';
import { fetchSourcePreferencesInBatches } from '@/lib/source-preference-client';
import { buildVideoInfoFromPreferenceResult } from '@/lib/source-preference-video-info';
import {
  sortSourcesBySelectionScore,
  SourceSelectionScore,
} from '@/lib/source-selection';
import {
  SearchResult,
  SourcePreferenceRequest,
  SourceStatus,
  SourceVideoInfo,
} from '@/lib/types';
import {
  createPlayableSourceStatus,
  createSourceStatus,
  getRememberedSourceStatusForSource,
  getSourceIdentityKey,
  getSourceStatusDescription,
  getSourceStatusLabel,
  getVideoResolutionFromM3u8,
  isSourceStatusClickable,
  probeSourcePlayback,
  rememberSourceDomainPreference,
  rememberSourcePlaybackQuality,
} from '@/lib/utils';

interface EpisodeSelectorProps {
  /** 总集数 */
  totalEpisodes: number;
  /** 每页显示多少集，默认 10 */
  episodesPerPage?: number;
  /** 当前选中的集数（1 开始） */
  value?: number;
  /** 用户点击选集后的回调 */
  onChange?: (episodeNumber: number) => void;
  /** 换源相关 */
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  videoTitle?: string;
  videoYear?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  /** 预计算的测速结果，避免重复测速 */
  precomputedVideoInfo?: Map<string, SourceVideoInfo>;
  /** 预计算的播放源状态，避免重复服务端探测 */
  precomputedSourceStatuses?: Map<string, SourceStatus>;
  /** 预计算的播放源评分，用于线路面板排序 */
  sourceSelectionScores?: Map<string, SourceSelectionScore>;
}

/**
 * 选集组件，支持分页、自动滚动聚焦当前分页标签，以及换源功能。
 */
const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodesPerPage = 10,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  videoTitle,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  precomputedVideoInfo,
  precomputedSourceStatuses,
  sourceSelectionScores,
}) => {
  const router = useRouter();
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);
  const MAX_AUTO_PROBE_SOURCES = 3;

  // 存储每个源的视频信息
  const [videoInfoMap, setVideoInfoMap] = useState<
    Map<string, SourceVideoInfo>
  >(new Map());
  const [sourceStatusMap, setSourceStatusMap] = useState<
    Map<string, SourceStatus>
  >(new Map());
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set()
  );

  // 使用 ref 来避免闭包问题
  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, SourceVideoInfo>>(new Map());
  const sourceStatusMapRef = useRef<Map<string, SourceStatus>>(new Map());
  const sourcePreferenceProbeKeyRef = useRef<string>('');
  const sourcePreferenceFreshProbeKeyRef = useRef<string>('');

  // 同步状态到 ref
  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  useEffect(() => {
    sourceStatusMapRef.current = sourceStatusMap;
  }, [sourceStatusMap]);

  // 主要的 tab 状态：'episodes' 或 'sources'
  // 当只有一集时默认展示 "换源"，并隐藏 "选集" 标签
  const [activeTab, setActiveTab] = useState<'episodes' | 'sources'>(
    totalEpisodes > 1 ? 'episodes' : 'sources'
  );

  // 当前分页索引（0 开始）
  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);

  // 是否倒序显示
  const [descending, setDescending] = useState<boolean>(false);
  const currentSourceKey =
    currentSource && currentId
      ? getSourceIdentityKey(currentSource, currentId)
      : null;

  // 获取视频信息的函数
  const getSourceStatus = useCallback((source: SearchResult) => {
    return sourceStatusMapRef.current.get(
      getSourceIdentityKey(source.source, source.id)
    );
  }, []);

  const canReplaceSourceStatus = useCallback(
    (status: SourceStatus | null | undefined) =>
      !status ||
      status.kind === 'idle' ||
      status.kind === 'probing' ||
      Boolean(status.fromMemory),
    []
  );

  const getKnownSourceStatus = useCallback(
    (sourceKey: string) =>
      sourceStatusMapRef.current.get(sourceKey) ||
      precomputedSourceStatuses?.get(sourceKey),
    [precomputedSourceStatuses]
  );

  const getPlaybackProbePlatform = useCallback(
    () =>
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
          typeof navigator !== 'undefined'
            ? navigator.maxTouchPoints
            : undefined,
        hasWebKitPointConversion:
          typeof window !== 'undefined' &&
          typeof (window as any).webkitConvertPointFromNodeToPage === 'function',
      }),
    []
  );

  const probeSourceDirectPlayback = useCallback(
    async (source: SearchResult) => {
      const sourceKey = getSourceIdentityKey(source.source, source.id);
      const existingStatus = sourceStatusMapRef.current.get(sourceKey);
      const rememberedStatus = getRememberedSourceStatusForSource(
        sourceKey,
        source.episodes
      );

      if (existingStatus?.kind === 'probing') {
        return existingStatus;
      }

      // 使用 ref 获取最新的状态，避免闭包问题
      if (
        attemptedSourcesRef.current.has(sourceKey) &&
        existingStatus &&
        existingStatus.kind !== 'idle'
      ) {
        return existingStatus;
      }

      // 使用当前选中的集数做探测，避免第 1 集可播但第 2 集异常时误判整个源
      if (!source.episodes || source.episodes.length === 0) {
        const missingEpisodeStatus = createSourceStatus('unavailable', {
          reason: '该播放源没有可用剧集',
          domain: rememberedStatus?.domain || null,
        });
        setSourceStatusMap((prev) =>
          new Map(prev).set(sourceKey, missingEpisodeStatus)
        );
        return missingEpisodeStatus;
      }
      const probeEpisodeIndex = Math.max(
        0,
        Math.min(value - 1, source.episodes.length - 1)
      );
      const episodeUrl = source.episodes[probeEpisodeIndex];
      const knownStatus =
        existingStatus && existingStatus.kind !== 'idle'
          ? existingStatus
          : rememberedStatus;

      if (
        knownStatus?.kind === 'proxy' ||
        knownStatus?.kind === 'unavailable'
      ) {
        return knownStatus;
      }

      const serverProbeResult =
        knownStatus?.kind === 'direct'
          ? {
              kind: 'direct' as const,
              reason: knownStatus.reason || '初始化检测通过',
              domain: knownStatus.domain || rememberedStatus?.domain || null,
            }
          : await probeSourcePlayback(episodeUrl);

      if (serverProbeResult.kind === 'proxy') {
        const proxyStatus = createSourceStatus('proxy', {
          reason: serverProbeResult.reason || '该源需通过代理播放',
          playbackMode: 'proxy',
          domain: serverProbeResult.domain || rememberedStatus?.domain || null,
        });
        setSourceStatusMap((prev) => new Map(prev).set(sourceKey, proxyStatus));
        rememberSourceDomainPreference(
          proxyStatus.domain || null,
          'proxy',
          serverProbeResult.reason
        );
        return proxyStatus;
      }

      if (serverProbeResult.kind === 'unavailable') {
        const unavailableInfo: SourceVideoInfo = {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
        };

        setVideoInfoMap((prev) =>
          new Map(prev).set(sourceKey, unavailableInfo)
        );

        const unavailableStatus = createSourceStatus('unavailable', {
          reason: serverProbeResult.reason || '服务端探测失败',
          domain: serverProbeResult.domain || rememberedStatus?.domain || null,
          measured: unavailableInfo,
        });
        setSourceStatusMap((prev) =>
          new Map(prev).set(sourceKey, unavailableStatus)
        );
        rememberSourceDomainPreference(
          unavailableStatus.domain || null,
          'unavailable',
          serverProbeResult.reason
        );
        rememberSourcePlaybackQuality(sourceKey, unavailableStatus.domain || null, {
          mode: 'unavailable',
          lastError: serverProbeResult.reason || '服务端探测失败',
          confidence: 'medium',
        });
        return unavailableStatus;
      }

      if (getPlaybackProbePlatform() === 'apple-native') {
        const directStatus = createSourceStatus('direct', {
          reason: '后端检测通过，可尝试播放',
          playbackMode: 'direct',
          domain: serverProbeResult.domain || rememberedStatus?.domain || null,
        });
        setSourceStatusMap((prev) => new Map(prev).set(sourceKey, directStatus));
        rememberSourceDomainPreference(directStatus.domain || null, 'direct');
        return directStatus;
      }

      // 标记为已尝试
      setAttemptedSources((prev) => new Set(prev).add(sourceKey));
      setSourceStatusMap((prev) => {
        const next = new Map(prev);
        next.set(
          sourceKey,
          createSourceStatus('probing', {
            reason: '正在检测浏览器是否可直连',
            domain:
              serverProbeResult.domain || rememberedStatus?.domain || null,
          })
        );
        return next;
      });

      try {
        const info = await getVideoResolutionFromM3u8(episodeUrl);
        const browserInfo: SourceVideoInfo = {
          ...info,
          speedSource: 'browser',
          speedUpdatedAt: Date.now(),
          speedPending: false,
        };
        setVideoInfoMap((prev) => new Map(prev).set(sourceKey, browserInfo));

        const directStatus = createSourceStatus('direct', {
          reason: '浏览器可直接播放',
          playbackMode: 'direct',
          measured: browserInfo,
          domain: serverProbeResult.domain || rememberedStatus?.domain || null,
        });
        setSourceStatusMap((prev) =>
          new Map(prev).set(sourceKey, directStatus)
        );
        rememberSourceDomainPreference(directStatus.domain || null, 'direct');
        rememberSourcePlaybackQuality(sourceKey, directStatus.domain || null, {
          mode: 'direct',
          browserSpeedLabel: browserInfo.loadSpeed,
          confidence: 'high',
        });
        return directStatus;
      } catch (error) {
        const failureReason =
          error instanceof Error ? error.message : '浏览器直连检测失败';
        const unavailableInfo: SourceVideoInfo = {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
          errorReason: failureReason,
        };

        // 失败时保存错误状态
        setVideoInfoMap((prev) =>
          new Map(prev).set(sourceKey, {
            ...unavailableInfo,
          })
        );

        const playableStatus = createPlayableSourceStatus({
          reason: '测速失败，可尝试播放',
          playbackMode: 'direct',
          domain: serverProbeResult.domain || rememberedStatus?.domain || null,
          measured: unavailableInfo,
        });
        setSourceStatusMap((prev) =>
          new Map(prev).set(sourceKey, playableStatus)
        );
        rememberSourcePlaybackQuality(sourceKey, playableStatus.domain || null, {
          mode: 'unavailable',
          lastError: failureReason,
          confidence: 'low',
        });
        return playableStatus;
      }
    },
    [getPlaybackProbePlatform, value]
  );

  const getAutoProbeCandidates = useCallback(() => {
    return [...availableSources]
      .sort((a, b) => {
        const aKey = getSourceIdentityKey(a.source, a.id);
        const bKey = getSourceIdentityKey(b.source, b.id);
        const aStatus = sourceStatusMapRef.current.get(aKey);
        const bStatus = sourceStatusMapRef.current.get(bKey);
        const aIsCurrent =
          a.source?.toString() === currentSource?.toString() &&
          a.id?.toString() === currentId?.toString();
        const bIsCurrent =
          b.source?.toString() === currentSource?.toString() &&
          b.id?.toString() === currentId?.toString();

        const getPriority = (isCurrent: boolean, status?: SourceStatus) => {
          if (isCurrent) return 0;
          if (status?.kind === 'direct') return 1;
          if (status?.kind === 'idle') return 2;
          return 3;
        };

        return (
          getPriority(aIsCurrent, aStatus) - getPriority(bIsCurrent, bStatus)
        );
      })
      .filter((source) => {
        const sourceKey = getSourceIdentityKey(source.source, source.id);
        const status = sourceStatusMapRef.current.get(sourceKey);

        if (attemptedSourcesRef.current.has(sourceKey)) {
          return false;
        }

        return !status || status.kind === 'idle' || status.kind === 'direct';
      })
      .slice(0, MAX_AUTO_PROBE_SOURCES);
  }, [availableSources, currentId, currentSource]);

  const handleSourceCardClick = useCallback(
    async (source: SearchResult) => {
      const sourceKey = getSourceIdentityKey(source.source, source.id);
      const isCurrentSource =
        source.source?.toString() === currentSource?.toString() &&
        source.id?.toString() === currentId?.toString();

      if (isCurrentSource) {
        return;
      }

      let status = sourceStatusMapRef.current.get(sourceKey);
      if (!status || status.kind === 'idle') {
        status = await probeSourceDirectPlayback(source);
      }

      if (!isSourceStatusClickable(status)) {
        return;
      }

      onSourceChange?.(source.source, source.id, source.title);
    },
    [currentId, currentSource, onSourceChange, probeSourceDirectPlayback]
  );

  useEffect(() => {
    setSourceStatusMap((prev) => {
      const next = new Map<string, SourceStatus>();

      availableSources.forEach((source) => {
        const sourceKey = getSourceIdentityKey(source.source, source.id);
        const previousStatus = prev.get(sourceKey);
        const rememberedStatus = getRememberedSourceStatusForSource(
          sourceKey,
          source.episodes
        );
        const isCurrentSource =
          source.source?.toString() === currentSource?.toString() &&
          source.id?.toString() === currentId?.toString();

        if (previousStatus && previousStatus.kind !== 'idle') {
          next.set(sourceKey, previousStatus);
          return;
        }

        if (rememberedStatus) {
          next.set(sourceKey, rememberedStatus);
          return;
        }

        if (isCurrentSource) {
          next.set(
            sourceKey,
            createSourceStatus('direct', {
              reason: '当前播放源',
              playbackMode: 'direct',
            })
          );
          return;
        }

        next.set(sourceKey, createSourceStatus('idle'));
      });

      return next;
    });
  }, [availableSources, currentId, currentSource]);

  // 当有预计算结果时，先合并到videoInfoMap中
  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        precomputedVideoInfo.forEach((value, key) => {
          newMap.set(key, value);
        });
        return newMap;
      });

      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        precomputedVideoInfo.forEach((info, key) => {
          newSet.add(key);
        });
        return newSet;
      });

      setSourceStatusMap((prev) => {
        const next = new Map(prev);

        precomputedVideoInfo.forEach((info, key) => {
          const previousStatus = next.get(key);
          if (info.hasError) {
            next.set(
              key,
              createPlayableSourceStatus({
                reason: info.errorReason || '初始化测速失败，可尝试播放',
                playbackMode: 'direct',
                domain: previousStatus?.domain || null,
                measured: info,
              })
            );
            return;
          }

          next.set(
            key,
            createSourceStatus('direct', {
              reason: '初始化检测通过',
              playbackMode: 'direct',
              domain: previousStatus?.domain || null,
              measured: info,
            })
          );
        });

        return next;
      });
    }
  }, [precomputedVideoInfo]);

  useEffect(() => {
    if (precomputedSourceStatuses && precomputedSourceStatuses.size > 0) {
      setSourceStatusMap((prev) => {
        const next = new Map(prev);

        precomputedSourceStatuses.forEach((status, key) => {
          const previousStatus = next.get(key);
          if (
            !previousStatus ||
            previousStatus.kind === 'idle' ||
            previousStatus.kind === 'probing' ||
            previousStatus.fromMemory
          ) {
            next.set(key, status);
          }
        });

        return next;
      });
    }
  }, [precomputedSourceStatuses]);

  useEffect(() => {
    if (activeTab !== 'sources' || availableSources.length === 0) {
      return;
    }

    const toPreferenceRequestSource = (
      source: SearchResult
    ): SourcePreferenceRequest['sources'][number] => {
      const probeEpisodeIndex = Math.max(
        0,
        Math.min(value - 1, Math.max(0, source.episodes.length - 1))
      );

      return {
        sourceKey: getSourceIdentityKey(source.source, source.id),
        episodeUrl: source.episodes?.[probeEpisodeIndex] || null,
        sourceName: source.source_name,
        titleSample: source.title,
      };
    };
    const requestSources = availableSources.map(toPreferenceRequestSource);
    const requestKey = requestSources
      .map((source) => `${source.sourceKey}:${source.episodeUrl || ''}`)
      .join('|');

    if (sourcePreferenceProbeKeyRef.current === requestKey) {
      return;
    }
    sourcePreferenceProbeKeyRef.current = requestKey;

    let cancelled = false;

    const probeFallbackSources = async (targetSourceKeys?: Set<string>) => {
      const fallbackSources = targetSourceKeys
        ? availableSources.filter((source) =>
            targetSourceKeys.has(getSourceIdentityKey(source.source, source.id))
          )
        : availableSources;
      const concurrency = 6;
      let currentIndex = 0;

      const runWorker = async () => {
        while (!cancelled && currentIndex < fallbackSources.length) {
          const source = fallbackSources[currentIndex];
          currentIndex += 1;
          const sourceKey = getSourceIdentityKey(source.source, source.id);
          const knownStatus = getKnownSourceStatus(sourceKey);
          if (!canReplaceSourceStatus(knownStatus)) {
            continue;
          }

          const probeEpisodeIndex = Math.max(
            0,
            Math.min(value - 1, Math.max(0, source.episodes.length - 1))
          );
          const episodeUrl = source.episodes?.[probeEpisodeIndex];

          if (!episodeUrl) {
            setSourceStatusMap((prev) => {
              const previousStatus = prev.get(sourceKey);
              if (!canReplaceSourceStatus(previousStatus)) {
                return prev;
              }

              return new Map(prev).set(
                sourceKey,
                createSourceStatus('unavailable', {
                  reason: '该播放源没有可用剧集',
                })
              );
            });
            continue;
          }

          const probeResult = await probeSourcePlayback(episodeUrl);
          if (cancelled) {
            return;
          }

          setSourceStatusMap((prev) => {
            const previousStatus = prev.get(sourceKey);
            if (!canReplaceSourceStatus(previousStatus)) {
              return prev;
            }

            return new Map(prev).set(
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
          });
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(concurrency, fallbackSources.length) },
          () => runWorker()
        )
      );
    };

    const mergePreferenceResults = (
      results: Awaited<
        ReturnType<typeof fetchSourcePreferencesInBatches>
      >['results']
    ) => {
      setVideoInfoMap((prev) => {
        const next = new Map(prev);

        results.forEach((result) => {
          const measured = buildVideoInfoFromPreferenceResult(result);
          if (!measured) {
            return;
          }

          const previous = next.get(result.sourceKey);
          if (
            previous?.speedSource === 'browser' &&
            measured.speedSource === 'backend'
          ) {
            return;
          }

          next.set(result.sourceKey, measured);
        });

        return next;
      });

      setSourceStatusMap((prev) => {
        const next = new Map(prev);

        results.forEach((result) => {
          const previousStatus = next.get(result.sourceKey);
          if (
            !canReplaceSourceStatus(previousStatus) &&
            result.kind !== 'unavailable'
          ) {
            return;
          }

          next.set(
            result.sourceKey,
            createSourceStatus(result.kind, {
              reason: result.reason,
              playbackMode:
                result.kind === 'unavailable' ? undefined : result.kind,
              domain: result.domain || previousStatus?.domain || null,
              measured: buildVideoInfoFromPreferenceResult(result) || undefined,
              updatedAt: result.updatedAt,
              rankingSource: result.rankingSource,
              rankScore: result.rankScore,
            })
          );
        });

        return next;
      });
    };

    const requestFreshMetricsForVisibleSources = async (
      knownResults: Awaited<
        ReturnType<typeof fetchSourcePreferencesInBatches>
      >['results']
    ) => {
      const knownResultByKey = new Map(
        knownResults.map((result) => [result.sourceKey, result])
      );
      const visibleSources = sortSourcesBySelectionScore(
        availableSources,
        sourceSelectionScores || new Map(),
        (source) => getSourceIdentityKey(source.source, source.id),
        currentSourceKey
      )
        .slice(0, 8)
        .map(toPreferenceRequestSource)
        .filter((source) => {
          if (!source.episodeUrl) {
            return false;
          }

          const existingInfo = videoInfoMapRef.current.get(source.sourceKey);
          const knownResult = knownResultByKey.get(source.sourceKey);
          const knownMeasured = knownResult
            ? buildVideoInfoFromPreferenceResult(knownResult)
            : null;
          if (
            knownMeasured &&
            !knownMeasured.speedPending &&
            knownMeasured.speedSource !== 'none'
          ) {
            return false;
          }

          return (
            !existingInfo ||
            existingInfo.speedPending ||
            existingInfo.speedSource === 'none'
          );
        });

      if (visibleSources.length === 0) {
        return;
      }

      const freshRequestKey = visibleSources
        .map((source) => `${source.sourceKey}:${source.episodeUrl || ''}`)
        .join('|');
      if (sourcePreferenceFreshProbeKeyRef.current === freshRequestKey) {
        return;
      }
      sourcePreferenceFreshProbeKeyRef.current = freshRequestKey;

      setSourceStatusMap((prev) => {
        const next = new Map(prev);

        visibleSources.forEach((source) => {
          const previousStatus = next.get(source.sourceKey);
          if (previousStatus?.kind === 'unavailable') {
            return;
          }

          next.set(
            source.sourceKey,
            createSourceStatus('probing', {
              reason: '后端测速中，可切换',
              playbackMode: previousStatus?.playbackMode || 'direct',
              domain: previousStatus?.domain || null,
              measured: previousStatus?.measured,
              rankingSource: previousStatus?.rankingSource,
              rankScore: previousStatus?.rankScore,
            })
          );
        });

        return next;
      });

      try {
        const preferenceData = await fetchSourcePreferencesInBatches(
          visibleSources,
          {
            allowLiveProbeFallback: false,
            includeFreshProbeMetrics: true,
          }
        );
        if (!cancelled) {
          mergePreferenceResults(preferenceData.results);
        }
      } catch {
        sourcePreferenceFreshProbeKeyRef.current = '';
      }
    };

    void fetchSourcePreferencesInBatches(requestSources, {
      allowLiveProbeFallback: true,
    })
      .then((preferenceData) => {
        if (cancelled) {
          return;
        }

        mergePreferenceResults(preferenceData.results);

        const returnedSourceKeys = new Set(
          preferenceData.results.map((result) => result.sourceKey)
        );
        const missingSourceKeys = requestSources
          .filter((source) => !returnedSourceKeys.has(source.sourceKey))
          .map((source) => source.sourceKey);

        if (missingSourceKeys.length > 0) {
          void probeFallbackSources(new Set(missingSourceKeys));
        }

        void requestFreshMetricsForVisibleSources(preferenceData.results);
      })
      .catch(() => {
        sourcePreferenceProbeKeyRef.current = '';
        void probeFallbackSources();
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    availableSources,
    canReplaceSourceStatus,
    currentSourceKey,
    getKnownSourceStatus,
    sourceSelectionScores,
    value,
  ]);

  // 当换源Tab激活时，只对少量候选源做浏览器直连检测，避免控制台刷满错误
  useEffect(() => {
    if (activeTab === 'sources') {
      getAutoProbeCandidates().forEach((source) => {
        void probeSourceDirectPlayback(source);
      });
    }
  }, [activeTab, getAutoProbeCandidates, probeSourceDirectPlayback]);

  // 分类标签容器和按钮的引用
  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 自动滚动到当前分页标签
  useEffect(() => {
    if (categoryContainerRef.current && buttonRefs.current[currentPage]) {
      const container = categoryContainerRef.current;
      const button = buttonRefs.current[currentPage];

      if (button) {
        const containerRect = container.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const scrollLeft = container.scrollLeft;

        if (buttonRect.left < containerRect.left) {
          container.scrollTo({
            left: scrollLeft - (containerRect.left - buttonRect.left) - 20,
            behavior: 'smooth',
          });
        } else if (buttonRect.right > containerRect.right) {
          container.scrollTo({
            left: scrollLeft + (buttonRect.right - containerRect.right) + 20,
            behavior: 'smooth',
          });
        }
      }
    }
  }, [currentPage]);

  // 生成分页标签 - 优化显示逻辑
  const categories = Array.from({ length: pageCount }, (_, i) => {
    const start = i * episodesPerPage + 1;
    const end = Math.min(start + episodesPerPage - 1, totalEpisodes);

    // 对于很大的数字，使用更紧凑的显示方式
    if (start === end) {
      return `${start}`;
    } else if (start >= 1000 || end >= 1000) {
      // 对于千位数以上，使用缩写形式
      const formatNumber = (num: number) => {
        if (num >= 1000) {
          return `${Math.floor(num / 100) / 10}k`;
        }
        return num.toString();
      };
      return `${formatNumber(start)}-${formatNumber(end)}`;
    } else {
      return `${start}-${end}`;
    }
  });

  // 处理换源tab点击，只在点击时才搜索
  const handleSourceTabClick = () => {
    setActiveTab('sources');
  };

  const handleCategoryClick = useCallback((index: number) => {
    setCurrentPage(index);
  }, []);

  const handleEpisodeClick = useCallback(
    (episodeNumber: number) => {
      onChange?.(episodeNumber);
    },
    [onChange]
  );

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      void handleSourceCardClick(source);
    },
    [handleSourceCardClick]
  );

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes
  );
  const stateActiveClass =
    'border-[rgb(var(--ui-accent))] bg-[rgba(var(--ui-accent),0.1)] text-[rgb(var(--ui-text))] shadow-[inset_0_1px_0_rgba(var(--ui-text),0.08),0_8px_20px_rgba(0,0,0,0.18)]';
  const stateIdleClass =
    'border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text-muted))] hover:border-[rgba(var(--ui-accent),0.45)] hover:bg-[rgba(var(--ui-surface-strong),0.82)] hover:text-[rgb(var(--ui-text))]';
  const stateMutedClass =
    'border-[rgb(var(--ui-border))] bg-[rgba(var(--ui-surface),0.7)] text-[rgb(var(--ui-text-muted))] opacity-60';
  const currentChipClass =
    'rounded-full bg-[rgb(var(--ui-border))] px-1.5 py-0.5 text-[9px] font-bold leading-none text-[rgb(var(--ui-text))] ring-1 ring-[rgba(var(--ui-text),0.1)]';
  const metaChipClass =
    'rounded-full bg-[rgb(var(--ui-border))] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--ui-text-muted))]';

  return (
    <div className='flex max-h-[640px] min-h-[260px] flex-col overflow-hidden rounded-ui-lg border border-white/10 bg-[linear-gradient(180deg,rgba(var(--ui-surface-strong),0.64),rgba(var(--ui-surface),0.42))] p-3 text-[rgb(var(--ui-text))] shadow-[0_18px_48px_rgba(0,0,0,0.18)] sm:p-4'>
      {/* 主要的 Tab 切换 */}
      <div
        className={`mb-3 grid flex-shrink-0 gap-1 rounded-ui-md border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-bg-elevated))] p-1 ${
          totalEpisodes > 1 ? 'grid-cols-2' : 'grid-cols-1'
        }`}
        role='tablist'
        aria-label='播放控制'
      >
        {totalEpisodes > 1 && (
          <button
            type='button'
            role='tab'
            aria-selected={activeTab === 'episodes'}
            onClick={() => setActiveTab('episodes')}
            className={`rounded-ui-sm px-4 py-2.5 text-center text-sm font-semibold transition-all duration-200
                ${
                  activeTab === 'episodes'
                    ? 'bg-[rgb(var(--ui-accent))] text-[rgb(var(--ui-on-accent))] shadow-ui-soft'
                    : 'text-[rgb(var(--ui-text-muted))] hover:bg-[rgb(var(--ui-surface))] hover:text-[rgb(var(--ui-text))]'
                }
            `.trim()}
          >
            选集
          </button>
        )}
        <button
          type='button'
          role='tab'
          aria-selected={activeTab === 'sources'}
          onClick={handleSourceTabClick}
          className={`rounded-ui-sm px-4 py-2.5 text-center text-sm font-semibold transition-all duration-200
                ${
                  activeTab === 'sources'
                    ? 'bg-[rgb(var(--ui-accent))] text-[rgb(var(--ui-on-accent))] shadow-ui-soft'
                    : 'text-[rgb(var(--ui-text-muted))] hover:bg-[rgb(var(--ui-surface))] hover:text-[rgb(var(--ui-text))]'
                }
            `.trim()}
        >
          线路
        </button>
      </div>

      {/* 选集 Tab 内容 */}
      {activeTab === 'episodes' && (
        <div className='flex min-h-0 flex-1 flex-col'>
          {/* 分类标签 */}
          <div className='mb-3 flex flex-shrink-0 items-center gap-2'>
            <div className='relative min-w-0 flex-1 overflow-hidden rounded-ui-md border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-bg-elevated))]'>
              {/* 滾動容器 */}
              <div
                className='snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-smooth scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20 hover:scrollbar-thumb-white/35 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 hover:[&::-webkit-scrollbar-thumb]:bg-white/35 [&::-webkit-scrollbar-track]:bg-transparent'
                ref={categoryContainerRef}
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(255,255,255,0.24) transparent',
                  msOverflowStyle: 'none',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <div className='flex min-w-max gap-1.5 px-1.5 py-1.5'>
                  {categories.map((label, idx) => {
                    const isActive = idx === currentPage;
                    // 动态计算按钮宽度，根据标签长度和内容调整
                    const getButtonWidth = (text: string) => {
                      if (text.length <= 2) return 'w-12'; // 单个数字
                      if (text.length <= 5) return 'w-16'; // 如 "1-10"
                      if (text.length <= 8) return 'w-20'; // 如 "101-110"
                      if (text.length <= 11) return 'w-24'; // 如 "1001-1010"
                      return 'w-28'; // 更长的标签
                    };

                    const buttonWidth = isActive
                      ? 'min-w-[78px]'
                      : getButtonWidth(label);

                    return (
                      <button
                        key={label}
                        ref={(el) => {
                          buttonRefs.current[idx] = el;
                        }}
                        onClick={() => handleCategoryClick(idx)}
                        aria-current={isActive ? 'true' : undefined}
                        className={`${buttonWidth} relative flex-shrink-0 whitespace-nowrap rounded-ui-sm border px-2.5 py-2 text-center text-xs font-semibold transition-all duration-200
                          ${isActive ? stateActiveClass : stateIdleClass}
                        `.trim()}
                        title={`第 ${idx * episodesPerPage + 1}-${Math.min(
                          (idx + 1) * episodesPerPage,
                          totalEpisodes
                        )} 集`}
                      >
                        <span className='relative z-10 flex items-center justify-center gap-1.5 truncate'>
                          {isActive && (
                            <span
                              className={`flex-shrink-0 ${currentChipClass}`}
                            >
                              当前
                            </span>
                          )}
                          <span className='truncate'>{label}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {/* 向上/向下按钮 */}
            <button
              className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-ui-md border border-[rgb(var(--ui-border))] bg-[rgb(var(--ui-surface))] text-[rgb(var(--ui-text-muted))] transition-all duration-200 hover:border-[rgba(var(--ui-accent),0.45)] hover:bg-[rgba(var(--ui-surface-strong),0.82)] hover:text-[rgb(var(--ui-text))]'
              aria-label='切换集数排序'
              title={descending ? '切换为正序' : '切换为倒序'}
              onClick={() => {
                // 切换集数排序（正序/倒序）
                setDescending((prev) => !prev);
              }}
            >
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                />
              </svg>
            </button>
          </div>

          {/* 集数网格 */}
          <div className='grid flex-1 grid-cols-[repeat(auto-fill,minmax(44px,1fr))] justify-center gap-2 overflow-y-auto pb-1 pr-0.5 sm:grid-cols-[repeat(auto-fill,minmax(48px,1fr))]'>
            {(() => {
              const len = currentEnd - currentStart + 1;
              const episodes = Array.from({ length: len }, (_, i) =>
                descending ? currentEnd - i : currentStart + i
              );
              return episodes;
            })().map((episodeNumber) => {
              const isActive = episodeNumber === value;
              return (
                <button
                  key={episodeNumber}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleEpisodeClick(episodeNumber);
                  }}
                  className={`flex h-10 w-full cursor-pointer items-center justify-center rounded-ui-sm border text-sm font-medium transition-all duration-200
                    ${
                      isActive
                        ? 'border border-[rgb(var(--ui-accent))] bg-[rgb(var(--ui-accent))] text-[rgb(var(--ui-on-accent))] shadow-ui-soft'
                        : stateIdleClass
                    }`.trim()}
                  type='button'
                  aria-label={`第${episodeNumber}集`}
                >
                  {episodeNumber}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 换源 Tab 内容 */}
      {activeTab === 'sources' && (
        <div className='mt-1 flex min-h-0 flex-1 flex-col'>
          {sourceSearchLoading && (
            <div className='flex items-center justify-center rounded-ui-md border border-white/10 bg-white/[0.035] py-8'>
              <div className='h-7 w-7 animate-spin rounded-full border-2 border-white/15 border-b-[rgb(var(--ui-accent))]'></div>
              <span className='ml-3 text-sm text-[rgb(var(--ui-text-muted))]'>
                搜索中...
              </span>
            </div>
          )}

          {sourceSearchError && (
            <div className='flex items-center justify-center rounded-ui-md border border-red-400/20 bg-red-500/10 py-8'>
              <div className='text-center'>
                <div className='mb-2 text-2xl text-red-300'>⚠️</div>
                <p className='text-sm text-red-200'>{sourceSearchError}</p>
              </div>
            </div>
          )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length === 0 && (
              <div className='flex items-center justify-center rounded-ui-md border border-white/10 bg-white/[0.035] py-8'>
                <div className='text-center'>
                  <div className='mb-2 text-2xl text-[rgb(var(--ui-text-muted))]'>
                    📺
                  </div>
                  <p className='text-sm text-[rgb(var(--ui-text-muted))]'>
                    暂无可用的换源
                  </p>
                </div>
              </div>
            )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length > 0 && (
              <div className='flex min-h-0 flex-1 flex-col'>
                <div className='grid flex-1 grid-cols-1 gap-2 overflow-y-auto pb-3 pr-0.5 sm:grid-cols-2 2xl:grid-cols-1'>
                  {sortSourcesBySelectionScore(
                    availableSources,
                    sourceSelectionScores || new Map(),
                    (source) => getSourceIdentityKey(source.source, source.id),
                    currentSourceKey
                  ).map((source) => {
                    const isCurrentSource =
                      source.source?.toString() === currentSource?.toString() &&
                      source.id?.toString() === currentId?.toString();
                    const sourceKey = getSourceIdentityKey(
                      source.source,
                      source.id
                    );
                    const sourceStatus = getSourceStatus(source);
                    const isClickable =
                      !isCurrentSource && isSourceStatusClickable(sourceStatus);
                    const statusLabel = sourceStatus
                      ? getSourceStatusLabel(sourceStatus)
                      : '待检测';
                    const videoInfo = videoInfoMap.get(sourceKey);
                    const qualityLabel =
                      videoInfo &&
                      !videoInfo.hasError &&
                      videoInfo.quality !== '未知' &&
                      videoInfo.quality !== '错误'
                        ? videoInfo.quality
                        : null;

                    const statusClassName = (() => {
                      if (!sourceStatus) {
                        return 'bg-[rgb(var(--ui-border))] text-[rgb(var(--ui-text-muted))]';
                      }

                      switch (sourceStatus.kind) {
                        case 'direct':
                          return 'bg-[rgba(var(--ui-success),0.16)] text-[rgb(var(--ui-success))] ring-1 ring-[rgba(var(--ui-success),0.38)]';
                        case 'proxy':
                          return 'bg-[rgba(var(--ui-accent),0.16)] text-[rgb(var(--ui-accent))] ring-1 ring-[rgba(var(--ui-accent),0.38)]';
                        case 'playable':
                          return 'bg-[rgba(var(--ui-accent-warm),0.16)] text-[rgb(var(--ui-accent-warm))] ring-1 ring-[rgba(var(--ui-accent-warm),0.38)]';
                        case 'unavailable':
                          return 'bg-[rgba(var(--ui-critical),0.16)] text-[rgb(var(--ui-critical))] ring-1 ring-[rgba(var(--ui-critical),0.38)]';
                        case 'probing':
                          return 'bg-[rgba(var(--ui-accent-warm),0.16)] text-[rgb(var(--ui-accent-warm))] ring-1 ring-[rgba(var(--ui-accent-warm),0.38)]';
                        default:
                          return 'bg-[rgb(var(--ui-border))] text-[rgb(var(--ui-text-muted))]';
                      }
                    })();

                    const sourceStatusText = getSourceStatusDescription(
                      sourceStatus,
                      videoInfo
                    );

                    return (
                      <button
                        key={sourceKey}
                        type='button'
                        disabled={!isClickable}
                        aria-current={isCurrentSource ? 'true' : undefined}
                        aria-label={`${
                          isCurrentSource ? '当前线路' : '切换线路'
                        } ${source.source_name}`}
                        title={`${source.title} · ${sourceStatusText}`}
                        onClick={() => isClickable && handleSourceClick(source)}
                        className={`group relative min-w-0 rounded-ui-md border px-3 py-3 text-left transition-all duration-200
                          ${
                            isCurrentSource
                              ? `${stateActiveClass} cursor-default disabled:opacity-100`
                              : isClickable
                              ? stateIdleClass
                              : `${stateMutedClass} cursor-not-allowed`
                          }`.trim()}
                      >
                        <div className='flex min-w-0 items-start justify-between gap-2'>
                          <div className='min-w-0'>
                            <div className='flex items-center gap-2'>
                              <span className='truncate text-sm font-semibold text-[rgb(var(--ui-text))]'>
                                {source.source_name}
                              </span>
                              {isCurrentSource && (
                                <span className={currentChipClass}>当前</span>
                              )}
                            </div>
                            <p className='mt-1 truncate text-[11px] text-[rgb(var(--ui-text-muted))]'>
                              {source.title}
                            </p>
                          </div>
                          <span
                            className={`${statusClassName} shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold`}
                          >
                            {statusLabel}
                          </span>
                        </div>

                        <div className='mt-3 flex flex-wrap items-center gap-1.5'>
                          {qualityLabel && (
                            <span className='rounded-full bg-[rgba(var(--ui-success),0.16)] px-2 py-0.5 text-[11px] font-semibold text-[rgb(var(--ui-success))] ring-1 ring-[rgba(var(--ui-success),0.38)]'>
                              {qualityLabel}
                            </span>
                          )}
                          {source.episodes.length > 1 && (
                            <span className={metaChipClass}>
                              {source.episodes.length} 集
                            </span>
                          )}
                          <span className={metaChipClass}>
                            {isClickable ? '可切换' : '不可切换'}
                          </span>
                        </div>

                        <p className='mt-2 truncate text-[11px] font-medium text-[rgb(var(--ui-text-muted))]'>
                          {sourceStatusText}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div className='flex-shrink-0 border-t border-white/10 pt-2'>
                  <button
                    onClick={() => {
                      if (videoTitle) {
                        router.push(
                          `/search?q=${encodeURIComponent(videoTitle)}`
                        );
                      }
                    }}
                    className='w-full rounded-ui-sm px-3 py-2 text-center text-xs font-medium text-[rgb(var(--ui-text-muted))] transition-colors hover:bg-white/[0.06] hover:text-[rgb(var(--ui-text))]'
                    type='button'
                  >
                    影片匹配有误？点击去搜索
                  </button>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default EpisodeSelector;
