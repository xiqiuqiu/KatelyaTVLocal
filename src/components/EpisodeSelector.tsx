'use client';

/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { buildSourceAvailabilityList } from '@/lib/source-availability/index';
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
  getVideoResolutionFromM3u8,
  probeSourcePlayback,
  rememberSourceDomainPreference,
  rememberSourcePlaybackQuality,
} from '@/lib/utils';

import EpisodeSelectorEpisodes from '@/components/player/EpisodeSelectorEpisodes';
import EpisodeSelectorSources from '@/components/player/EpisodeSelectorSources';

/** Stable default — inline `= []` would break memo/deps identity every render. */
const EMPTY_SOURCES: SearchResult[] = [];

function mergeVideoInfoMaps(
  precomputed: Map<string, SourceVideoInfo> | undefined,
  local: Map<string, SourceVideoInfo>
): Map<string, SourceVideoInfo> {
  if (!precomputed || precomputed.size === 0) {
    return local;
  }

  const next = new Map(precomputed);
  local.forEach((value, key) => {
    const existing = next.get(key);
    if (!existing) {
      next.set(key, value);
      return;
    }

    // Local browser metrics win over backend (same rule as preference merge).
    if (
      value.speedSource === 'browser' &&
      existing.speedSource === 'backend'
    ) {
      next.set(key, value);
    }
  });

  return next;
}

function isParentOwnedSourceKey(
  sourceKey: string,
  precomputedSourceStatuses?: Map<string, SourceStatus>,
  precomputedVideoInfo?: Map<string, SourceVideoInfo>
): boolean {
  if (precomputedVideoInfo?.has(sourceKey)) {
    return true;
  }

  const status = precomputedSourceStatuses?.get(sourceKey);
  if (!status) {
    return false;
  }

  // idle / probing / fromMemory are scaffolding, not final owned results.
  if (
    status.kind === 'idle' ||
    status.kind === 'probing' ||
    status.fromMemory
  ) {
    return false;
  }

  return true;
}

function mergeStatusMaps(
  precomputed: Map<string, SourceStatus> | undefined,
  local: Map<string, SourceStatus>
): Map<string, SourceStatus> {
  const next = new Map(local);

  if (!precomputed || precomputed.size === 0) {
    return next;
  }

  // Same gate as the deleted precomputedSourceStatuses mirror effect:
  // parent fills only when local has no stronger live result yet.
  precomputed.forEach((status, key) => {
    const previous = next.get(key);
    if (
      !previous ||
      previous.kind === 'idle' ||
      previous.kind === 'probing' ||
      previous.fromMemory
    ) {
      next.set(key, status);
    }
  });

  return next;
}

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
  availableSources = EMPTY_SOURCES,
  sourceSearchLoading = false,
  sourceSearchError = null,
  precomputedVideoInfo,
  precomputedSourceStatuses,
  sourceSelectionScores,
}) => {
  const router = useRouter();
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  // Local maps only for incremental UI probes; parent owns precomputed*.
  const [videoInfoMap, setVideoInfoMap] = useState<
    Map<string, SourceVideoInfo>
  >(new Map());
  const [sourceStatusMap, setSourceStatusMap] = useState<
    Map<string, SourceStatus>
  >(new Map());
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set()
  );

  const displayVideoInfoMap = mergeVideoInfoMaps(
    precomputedVideoInfo,
    videoInfoMap
  );
  const displaySourceStatusMap = mergeStatusMaps(
    precomputedSourceStatuses,
    sourceStatusMap
  );

  // 使用 ref 来避免闭包问题 — keep in sync with merged display maps
  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, SourceVideoInfo>>(new Map());
  const sourceStatusMapRef = useRef<Map<string, SourceStatus>>(new Map());
  const sourcePreferenceProbeKeyRef = useRef<string>('');
  const sourcePreferenceFreshProbeKeyRef = useRef<string>('');

  // Keep refs aligned with merged display maps for async probe callbacks.
  useEffect(() => {
    const next = new Set(attemptedSources);
    precomputedVideoInfo?.forEach((_, key) => {
      next.add(key);
    });
    attemptedSourcesRef.current = next;
  }, [attemptedSources, precomputedVideoInfo]);

  useEffect(() => {
    videoInfoMapRef.current = displayVideoInfoMap;
  }, [displayVideoInfoMap]);

  useEffect(() => {
    sourceStatusMapRef.current = displaySourceStatusMap;
  }, [displaySourceStatusMap]);

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

  const hasBackendRescueMetrics = useCallback(
    (
      videoInfo: SourceVideoInfo | null | undefined
    ): videoInfo is SourceVideoInfo =>
      Boolean(
        videoInfo &&
          !videoInfo.hasError &&
          videoInfo.speedSource === 'backend' &&
          !videoInfo.speedPending
      ),
    []
  );

  const hasBrowserRescueMetrics = useCallback(
    (
      videoInfo: SourceVideoInfo | null | undefined
    ): videoInfo is SourceVideoInfo =>
      Boolean(
        videoInfo &&
          !videoInfo.hasError &&
          videoInfo.speedSource === 'browser' &&
          !videoInfo.speedPending &&
          typeof videoInfo.pingTime === 'number' &&
          videoInfo.pingTime > 0
      ),
    []
  );

  const createBackendRescuedStatus = useCallback(
    (
      previousStatus: SourceStatus | null | undefined,
      videoInfo: SourceVideoInfo
    ) =>
      createPlayableSourceStatus({
        reason:
          videoInfo.speedSource === 'browser'
            ? '本机测速可用，可尝试播放'
            : '后端测速可用，可尝试播放',
        playbackMode: previousStatus?.playbackMode || 'direct',
        domain: previousStatus?.domain || null,
        measured: videoInfo,
        updatedAt: Math.max(
          previousStatus?.updatedAt || 0,
          videoInfo.speedUpdatedAt || Date.now()
        ),
        rankingSource: previousStatus?.rankingSource,
        rankScore: previousStatus?.rankScore,
      }),
    []
  );

  const getBackendRescuedStatus = useCallback(
    (sourceKey: string, status: SourceStatus | null | undefined) => {
      if (status?.kind !== 'unavailable') {
        return null;
      }

      const videoInfo = videoInfoMapRef.current.get(sourceKey);
      if (
        !hasBackendRescueMetrics(videoInfo) &&
        !hasBrowserRescueMetrics(videoInfo)
      ) {
        return null;
      }

      return createBackendRescuedStatus(status, videoInfo);
    },
    [
      createBackendRescuedStatus,
      hasBackendRescueMetrics,
      hasBrowserRescueMetrics,
    ]
  );

  const canPreferenceResultRescueUnavailable = useCallback(
    (
      previousStatus: SourceStatus | null | undefined,
      result: Awaited<
        ReturnType<typeof fetchSourcePreferencesInBatches>
      >['results'][number]
    ) =>
      previousStatus?.kind === 'unavailable' && result.kind !== 'unavailable',
    []
  );

  const createRescuedSourceStatus = useCallback(
    (
      previousStatus: SourceStatus | null | undefined,
      result: Awaited<
        ReturnType<typeof fetchSourcePreferencesInBatches>
      >['results'][number],
      measured: SourceVideoInfo | null
    ) => {
      const commonOptions = {
        reason: result.reason,
        playbackMode: result.kind === 'unavailable' ? undefined : result.kind,
        domain: result.domain || previousStatus?.domain || null,
        measured: measured || undefined,
        updatedAt: result.updatedAt,
        rankingSource: result.rankingSource,
        rankScore: result.rankScore,
      };

      if (
        previousStatus?.kind === 'unavailable' &&
        result.kind !== 'unavailable' &&
        !hasBackendRescueMetrics(measured)
      ) {
        return createPlayableSourceStatus({
          ...commonOptions,
          reason: result.reason || '后端检测通过，可尝试播放',
        });
      }

      return createSourceStatus(result.kind, commonOptions);
    },
    [hasBackendRescueMetrics]
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
        return getBackendRescuedStatus(sourceKey, knownStatus) || knownStatus;
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
        rememberSourcePlaybackQuality(
          sourceKey,
          unavailableStatus.domain || null,
          {
            mode: 'unavailable',
            lastError: serverProbeResult.reason || '服务端探测失败',
            confidence: 'medium',
          }
        );
        return unavailableStatus;
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
        rememberSourcePlaybackQuality(
          sourceKey,
          playableStatus.domain || null,
          {
            mode: 'unavailable',
            lastError: failureReason,
            confidence: 'low',
          }
        );
        return playableStatus;
      }
    },
    [getBackendRescuedStatus, value]
  );

  const handleSourceCardClick = useCallback(
    async (source: SearchResult) => {
      const sourceKey = getSourceIdentityKey(source.source, source.id);
      const currentEpisodeIndex = Math.max(0, value - 1);
      let status = sourceStatusMapRef.current.get(sourceKey);
      let availability = buildSourceAvailabilityList({
        sources: [source],
        currentSourceKey,
        currentEpisodeIndex,
        statuses: sourceStatusMapRef.current,
        measured: videoInfoMapRef.current,
      })[0];

      if (availability.manualSwitch.mode === 'probe-first') {
        status = await probeSourceDirectPlayback(source);
        availability = buildSourceAvailabilityList({
          sources: [source],
          currentSourceKey,
          currentEpisodeIndex,
          statuses: new Map(sourceStatusMapRef.current).set(sourceKey, status),
          measured: videoInfoMapRef.current,
        })[0];
      }

      if (availability.manualSwitch.mode !== 'switch-now') {
        return;
      }

      onSourceChange?.(source.source, source.id, source.title);
    },
    [currentSourceKey, onSourceChange, probeSourceDirectPlayback, value]
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

  useEffect(() => {
    if (activeTab !== 'sources' || availableSources.length === 0) {
      return;
    }

    // Parent already owns final preference/probe results — do not re-fetch those keys.
    const uncoveredSources = availableSources.filter(
      (source) =>
        !isParentOwnedSourceKey(
          getSourceIdentityKey(source.source, source.id),
          precomputedSourceStatuses,
          precomputedVideoInfo
        )
    );
    if (uncoveredSources.length === 0) {
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
    const requestSources = uncoveredSources.map(toPreferenceRequestSource);
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
        ? uncoveredSources.filter((source) =>
            targetSourceKeys.has(getSourceIdentityKey(source.source, source.id))
          )
        : uncoveredSources;
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
          const localStatus = next.get(result.sourceKey);
          const precomputedStatus = precomputedSourceStatuses?.get(
            result.sourceKey
          );
          // Prefer live local results; otherwise inherit parent scaffolding
          // (e.g. fromMemory unavailable) so rescue rules still apply.
          const previousStatus =
            localStatus &&
            localStatus.kind !== 'idle' &&
            localStatus.kind !== 'probing' &&
            !localStatus.fromMemory
              ? localStatus
              : precomputedStatus || localStatus;
          const measured = buildVideoInfoFromPreferenceResult(result);
          if (
            !canReplaceSourceStatus(previousStatus) &&
            !canPreferenceResultRescueUnavailable(previousStatus, result) &&
            result.kind !== 'unavailable'
          ) {
            return;
          }

          next.set(
            result.sourceKey,
            createRescuedSourceStatus(previousStatus, result, measured)
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

      const previousStatusByKey = new Map<string, SourceStatus | undefined>();

      setSourceStatusMap((prev) => {
        const next = new Map(prev);

        visibleSources.forEach((source) => {
          const previousStatus = next.get(source.sourceKey);
          previousStatusByKey.set(source.sourceKey, previousStatus);
          const backendRescuedStatus = getBackendRescuedStatus(
            source.sourceKey,
            previousStatus
          );
          if (previousStatus?.kind === 'unavailable' && !backendRescuedStatus) {
            return;
          }

          next.set(
            source.sourceKey,
            createSourceStatus('probing', {
              reason: '后端测速中，可切换',
              playbackMode:
                backendRescuedStatus?.playbackMode ||
                previousStatus?.playbackMode ||
                'direct',
              domain:
                backendRescuedStatus?.domain || previousStatus?.domain || null,
              measured:
                backendRescuedStatus?.measured || previousStatus?.measured,
              rankingSource:
                backendRescuedStatus?.rankingSource ||
                previousStatus?.rankingSource,
              rankScore:
                backendRescuedStatus?.rankScore ?? previousStatus?.rankScore,
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

          const returnedSourceKeys = new Set(
            preferenceData.results.map((result) => result.sourceKey)
          );
          const missingSourceKeys = visibleSources
            .filter((source) => !returnedSourceKeys.has(source.sourceKey))
            .map((source) => source.sourceKey);

          if (missingSourceKeys.length > 0) {
            const missingVisibleSources = visibleSources.filter((source) =>
              missingSourceKeys.includes(source.sourceKey)
            );

            setSourceStatusMap((prev) => {
              const next = new Map(prev);

              missingSourceKeys.forEach((sourceKey) => {
                const previousStatus = previousStatusByKey.get(sourceKey);
                if (previousStatus) {
                  next.set(sourceKey, previousStatus);
                } else {
                  next.delete(sourceKey);
                }
              });

              return next;
            });
            sourcePreferenceFreshProbeKeyRef.current = '';

            void fetchSourcePreferencesInBatches(missingVisibleSources, {
              allowLiveProbeFallback: false,
              includeFreshProbeMetrics: true,
            })
              .then((retryPreferenceData) => {
                if (!cancelled) {
                  mergePreferenceResults(retryPreferenceData.results);
                }
              })
              .catch(() => {
                sourcePreferenceFreshProbeKeyRef.current = '';
              });
          }
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
    canPreferenceResultRescueUnavailable,
    currentSourceKey,
    createRescuedSourceStatus,
    getKnownSourceStatus,
    getBackendRescuedStatus,
    precomputedSourceStatuses,
    precomputedVideoInfo,
    sourceSelectionScores,
    value,
  ]);

  // 线路 Tab 不再一打开就对本机做 HLS 深测：会与正在播放的分片抢带宽，
  // 容易把正常播放打成 soft-stall → R3 自动切源。状态以 preference / 播放页
  // 渐进测速为准；用户点击卡片时仍走 probeSourceDirectPlayback。

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

  const currentEpisodeIndex = Math.max(0, value - 1);
  const sourceAvailabilityList = buildSourceAvailabilityList({
    sources: availableSources,
    currentSourceKey,
    currentEpisodeIndex,
    statuses: displaySourceStatusMap,
    measured: displayVideoInfoMap,
    sourceSelectionScores,
  });

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
            className={`rounded-ui-sm px-4 py-2.5 text-center text-sm font-semibold transition-[border-color,background-color,color,box-shadow] duration-200
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
          className={`rounded-ui-sm px-4 py-2.5 text-center text-sm font-semibold transition-[border-color,background-color,color,box-shadow] duration-200
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

      {activeTab === 'episodes' && (
        <EpisodeSelectorEpisodes
          totalEpisodes={totalEpisodes}
          episodesPerPage={episodesPerPage}
          pageCount={pageCount}
          value={value}
          currentPage={currentPage}
          descending={descending}
          onCategoryClick={handleCategoryClick}
          onToggleDescending={() => setDescending((prev) => !prev)}
          onEpisodeClick={handleEpisodeClick}
        />
      )}

      {activeTab === 'sources' && (
        <EpisodeSelectorSources
          sourceSearchLoading={sourceSearchLoading}
          sourceSearchError={sourceSearchError}
          availableSourcesCount={availableSources.length}
          sourceAvailabilityList={sourceAvailabilityList}
          videoTitle={videoTitle}
          onSourceClick={handleSourceClick}
          onSearchMismatchClick={() => {
            if (videoTitle) {
              router.push(`/search?q=${encodeURIComponent(videoTitle)}`);
            }
          }}
        />
      )}
    </div>
  );
};

export default EpisodeSelector;
