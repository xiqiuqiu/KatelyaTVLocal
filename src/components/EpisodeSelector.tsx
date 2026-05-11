'use client';

/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { SearchResult, SourceStatus, SourceVideoInfo } from '@/lib/types';
import {
  createPlayableSourceStatus,
  createSourceStatus,
  getRememberedSourceStatus,
  getSourceIdentityKey,
  getSourceStatusLabel,
  getVideoResolutionFromM3u8,
  isSourceStatusClickable,
  probeSourcePlayback,
  processImageUrl,
  rememberSourceDomainPreference,
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

  // 获取视频信息的函数
  const getSourceStatus = useCallback((source: SearchResult) => {
    return sourceStatusMapRef.current.get(
      getSourceIdentityKey(source.source, source.id)
    );
  }, []);

  const probeSourceDirectPlayback = useCallback(
    async (source: SearchResult) => {
      const sourceKey = getSourceIdentityKey(source.source, source.id);
      const existingStatus = sourceStatusMapRef.current.get(sourceKey);
      const rememberedStatus = getRememberedSourceStatus(source.episodes);

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

      if (knownStatus?.kind === 'proxy' || knownStatus?.kind === 'unavailable') {
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
            domain: serverProbeResult.domain || rememberedStatus?.domain || null,
          })
        );
        return next;
      });

      try {
        const info = await getVideoResolutionFromM3u8(episodeUrl);
        setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));

        const directStatus = createSourceStatus('direct', {
          reason: '浏览器可直接播放',
          playbackMode: 'direct',
          measured: info,
          domain: serverProbeResult.domain || rememberedStatus?.domain || null,
        });
        setSourceStatusMap((prev) =>
          new Map(prev).set(sourceKey, directStatus)
        );
        rememberSourceDomainPreference(directStatus.domain || null, 'direct');
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
        return playableStatus;
      }
    },
    [value]
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
        const rememberedStatus = getRememberedSourceStatus(source.episodes);
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

  return (
    <div className='md:ml-2 px-4 py-0 min-h-[200px] max-h-[600px] rounded-xl bg-black/10 dark:bg-white/5 flex flex-col border border-white/0 dark:border-white/30 overflow-hidden'>
      {/* 主要的 Tab 切换 - 无缝融入设计 */}
      <div className='flex mb-1 -mx-6 flex-shrink-0'>
        {totalEpisodes > 1 && (
          <div
            onClick={() => setActiveTab('episodes')}
            className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
                ${
                  activeTab === 'episodes'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
                }
            `.trim()}
          >
            选集
          </div>
        )}
        <div
          onClick={handleSourceTabClick}
          className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
                ${
                  activeTab === 'sources'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
                }
            `.trim()}
        >
          换源
        </div>
      </div>

      {/* 选集 Tab 内容 */}
      {activeTab === 'episodes' && (
        <div className='flex flex-col flex-1 min-h-0'>
          {/* 分类标签 */}
          <div className='flex items-center gap-4 mb-4 border-b border-gray-300 dark:border-gray-700 -mx-6 px-6 flex-shrink-0'>
            <div className='flex-1 relative overflow-hidden'>
              {/* 滾動容器 */}
              <div
                className='overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent hover:scrollbar-thumb-gray-400 dark:hover:scrollbar-thumb-gray-500 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-gray-600 hover:[&::-webkit-scrollbar-thumb]:bg-gray-400 dark:hover:[&::-webkit-scrollbar-thumb]:bg-gray-500 snap-x snap-mandatory scroll-smooth'
                ref={categoryContainerRef}
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgb(209 213 219) transparent',
                  msOverflowStyle: 'none',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <div className='flex gap-2 min-w-max px-6 py-1'>
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

                    const buttonWidth = getButtonWidth(label);

                    return (
                      <button
                        key={label}
                        ref={(el) => {
                          buttonRefs.current[idx] = el;
                        }}
                        onClick={() => handleCategoryClick(idx)}
                        className={`${buttonWidth} relative py-2 px-1 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 text-center
                          ${
                            isActive
                              ? 'text-green-500 dark:text-green-400'
                              : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                          }
                        `.trim()}
                        title={`第 ${idx * episodesPerPage + 1}-${Math.min(
                          (idx + 1) * episodesPerPage,
                          totalEpisodes
                        )} 集`}
                      >
                        <span className='block truncate'>{label}</span>
                        {isActive && (
                          <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 dark:bg-green-400' />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {/* 向上/向下按钮 */}
            <button
              className='flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-gray-700 hover:text-green-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-green-400 dark:hover:bg-white/20 transition-colors transform translate-y-[-4px]'
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
          <div className='flex-1 grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] justify-center gap-2 overflow-y-auto pb-4'>
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
                  className={`w-full h-10 flex items-center justify-center text-sm font-medium rounded-md transition-all duration-200 cursor-pointer
                    ${
                      isActive
                        ? 'bg-green-500 text-white shadow-lg shadow-green-500/25 dark:bg-green-600'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:scale-105 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20'
                    }`.trim()}
                  type='button'
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
        <div className='flex flex-col flex-1 min-h-0 mt-4'>
          {sourceSearchLoading && (
            <div className='flex items-center justify-center py-8'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
              <span className='ml-2 text-sm text-gray-600 dark:text-gray-300'>
                搜索中...
              </span>
            </div>
          )}

          {sourceSearchError && (
            <div className='flex items-center justify-center py-8'>
              <div className='text-center'>
                <div className='text-red-500 text-2xl mb-2'>⚠️</div>
                <p className='text-sm text-red-600 dark:text-red-400'>
                  {sourceSearchError}
                </p>
              </div>
            </div>
          )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length === 0 && (
              <div className='flex items-center justify-center py-8'>
                <div className='text-center'>
                  <div className='text-gray-400 text-2xl mb-2'>📺</div>
                  <p className='text-sm text-gray-600 dark:text-gray-300'>
                    暂无可用的换源
                  </p>
                </div>
              </div>
            )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length > 0 && (
              <div className='flex-1 overflow-y-auto space-y-2 pb-4'>
                {availableSources
                  .sort((a, b) => {
                    const aIsCurrent =
                      a.source?.toString() === currentSource?.toString() &&
                      a.id?.toString() === currentId?.toString();
                    const bIsCurrent =
                      b.source?.toString() === currentSource?.toString() &&
                      b.id?.toString() === currentId?.toString();
                    if (aIsCurrent && !bIsCurrent) return -1;
                    if (!aIsCurrent && bIsCurrent) return 1;
                    return 0;
                  })
                  .map((source, index) => {
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
                        return 'bg-gray-500/10 dark:bg-gray-400/20 text-gray-600 dark:text-gray-300';
                      }

                      switch (sourceStatus.kind) {
                        case 'direct':
                          return 'bg-gray-500/10 dark:bg-gray-400/20 text-green-600 dark:text-green-400';
                        case 'proxy':
                          return 'bg-gray-500/10 dark:bg-gray-400/20 text-blue-600 dark:text-blue-400';
                        case 'playable':
                          return 'bg-gray-500/10 dark:bg-gray-400/20 text-amber-600 dark:text-amber-400';
                        case 'unavailable':
                          return 'bg-gray-500/10 dark:bg-gray-400/20 text-red-600 dark:text-red-400';
                        case 'probing':
                          return 'bg-gray-500/10 dark:bg-gray-400/20 text-yellow-600 dark:text-yellow-400';
                        default:
                          return 'bg-gray-500/10 dark:bg-gray-400/20 text-gray-600 dark:text-gray-300';
                      }
                    })();

                    return (
                      <div
                        key={sourceKey}
                        onClick={() => isClickable && handleSourceClick(source)}
                        className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                          ${
                            isCurrentSource
                              ? 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30 border'
                              : isClickable
                              ? 'hover:bg-gray-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                              : 'opacity-70 cursor-not-allowed'
                          }`.trim()}
                      >
                        {/* 封面 */}
                        <div className='flex-shrink-0 w-12 h-20 bg-gray-300 dark:bg-gray-600 rounded overflow-hidden'>
                          {source.episodes && source.episodes.length > 0 && (
                            <img
                              src={processImageUrl(source.poster)}
                              alt={source.title}
                              className='w-full h-full object-cover'
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                              }}
                            />
                          )}
                        </div>

                        {/* 信息区域 */}
                        <div className='flex-1 min-w-0 flex flex-col justify-between h-20'>
                          {/* 标题和分辨率 - 顶部 */}
                          <div className='flex items-start justify-between gap-3 h-6'>
                            <div className='flex-1 min-w-0 relative group/title'>
                              <h3 className='font-medium text-base truncate text-gray-900 dark:text-gray-100 leading-none'>
                                {source.title}
                              </h3>
                              {/* 标题级别的 tooltip - 第一个元素不显示 */}
                              {index !== 0 && (
                                <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible group-hover/title:opacity-100 group-hover/title:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap z-[500] pointer-events-none'>
                                  {source.title}
                                  <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
                                </div>
                              )}
                            </div>
                            <div className='flex items-center gap-1.5 flex-shrink-0'>
                              {qualityLabel && (
                                <div className='px-1.5 py-0 rounded text-xs bg-cyan-500/10 dark:bg-cyan-400/15 text-cyan-600 dark:text-cyan-400 text-center'>
                                  {qualityLabel}
                                </div>
                              )}
                              <div
                                className={`${statusClassName} px-1.5 py-0 rounded text-xs min-w-[50px] text-center`}
                              >
                                {statusLabel}
                              </div>
                            </div>
                          </div>

                          {/* 源名称和集数信息 - 垂直居中 */}
                          <div className='flex items-center justify-between'>
                            <span className='text-xs px-2 py-1 border border-gray-500/60 rounded text-gray-700 dark:text-gray-300'>
                              {source.source_name}
                            </span>
                            {source.episodes.length > 1 && (
                              <span className='text-xs text-gray-500 dark:text-gray-400 font-medium'>
                                {source.episodes.length} 集
                              </span>
                            )}
                          </div>

                          {/* 网络信息 - 底部 */}
                          <div className='flex items-end h-6'>
                            {(() => {
                              if (sourceStatus?.kind === 'probing') {
                                return (
                                  <div className='text-yellow-600 dark:text-yellow-400 font-medium text-xs'>
                                    正在检测浏览器直连能力...
                                  </div>
                                );
                              }

                              if (videoInfo) {
                                if (!videoInfo.hasError) {
                                  return (
                                    <div className='flex items-end gap-3 text-xs'>
                                      <div className='text-green-600 dark:text-green-400 font-medium text-xs'>
                                        {videoInfo.loadSpeed}
                                      </div>
                                      <div className='text-orange-600 dark:text-orange-400 font-medium text-xs'>
                                        {videoInfo.pingTime}ms
                                      </div>
                                    </div>
                                  );
                                } else {
                                  return (
                                    <div className='text-amber-600 dark:text-amber-400 font-medium text-xs'>
                                      {sourceStatus?.reason ||
                                        videoInfo.errorReason ||
                                        '测速失败，可尝试播放'}
                                    </div>
                                  );
                                }
                              }

                              if (sourceStatus?.kind === 'proxy') {
                                return (
                                  <div className='text-blue-600 dark:text-blue-400 font-medium text-xs'>
                                    该源更适合通过代理播放
                                  </div>
                                );
                              }

                              if (sourceStatus?.kind === 'direct') {
                                return (
                                  <div className='text-green-600 dark:text-green-400 font-medium text-xs'>
                                    浏览器可直接播放
                                  </div>
                                );
                              }

                              if (sourceStatus?.kind === 'playable') {
                                return (
                                  <div className='text-amber-600 dark:text-amber-400 font-medium text-xs'>
                                    {sourceStatus.reason || '测速失败，可尝试播放'}
                                  </div>
                                );
                              }

                              if (sourceStatus?.kind === 'unavailable') {
                                return (
                                  <div className='text-red-500/90 dark:text-red-400 font-medium text-xs'>
                                    {sourceStatus.reason || '该源当前不可用'}
                                  </div>
                                );
                              }

                              return (
                                <div className='text-gray-500 dark:text-gray-400 font-medium text-xs'>
                                  待检测
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                <div className='flex-shrink-0 mt-auto pt-2 border-t border-gray-400 dark:border-gray-700'>
                  <button
                    onClick={() => {
                      if (videoTitle) {
                        router.push(
                          `/search?q=${encodeURIComponent(videoTitle)}`
                        );
                      }
                    }}
                    className='w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 dark:hover:text-green-400 transition-colors py-2'
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
