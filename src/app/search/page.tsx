/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import { ChevronUp, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import {
  buildSearchCategoryTabs,
  filterSearchResultsByCategory,
  getSearchCardMeta,
  type SearchCategory,
} from '@/lib/search-category';
import {
  shouldSuggestAiFind,
  sortSearchResultGroupsByRanking,
  sortSearchResultsByRanking,
} from '@/lib/search-result-ranking';
import { SearchResult } from '@/lib/types';
import { pageMeta, pageSectionLabels } from '@/lib/ui/page-meta';

import AiFindPanel from '@/components/AiFindPanel';
import CapsuleSwitch from '@/components/CapsuleSwitch';
import PageLayout from '@/components/PageLayout';
import ActionLink from '@/components/ui/ActionLink';
import { SkeletonPosterCard } from '@/components/ui/LoadingPrimitives';
import PageHeader from '@/components/ui/PageHeader';
import PosterGrid from '@/components/ui/PosterGrid';
import SectionHeader from '@/components/ui/SectionHeader';
import Surface from '@/components/ui/Surface';
import VideoCard from '@/components/VideoCard';

export const runtime = 'edge';

function SearchPageClient() {
  // 搜索历史
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  // 返回顶部按钮显示状态
  const [showBackToTop, setShowBackToTop] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchMode, setSearchMode] = useState<'normal' | 'ai'>('normal');

  // 从 URL 参数获取搜索词
  const searchQuery = searchParams.get('q') || '';
  const searchModeParam = searchParams.get('mode') || '';

  // 获取默认聚合设置：只读取用户本地设置，默认为 true
  const getDefaultAggregate = () => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      if (userSetting !== null) {
        return JSON.parse(userSetting);
      }
    }
    return true; // 默认启用聚合
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });
  const [resultCategory, setResultCategory] = useState<SearchCategory>('all');

  const categoryTabs = useMemo(
    () => buildSearchCategoryTabs(searchResults),
    [searchResults]
  );

  const categoryTabOptions = useMemo(
    () =>
      categoryTabs.map((tab) => ({
        value: tab.value,
        label: `${tab.label} ${tab.count}`,
      })),
    [categoryTabs]
  );

  // 仅对已加载结果做客户端分类过滤，不改动 /api/search 与聚合身份
  const filteredSearchResults = useMemo(
    () => filterSearchResultsByCategory(searchResults, resultCategory),
    [resultCategory, searchResults]
  );

  // 聚合后的结果（按标题和年份分组）
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    filteredSearchResults.forEach((item) => {
      // 使用 title + year + type 作为键，year 必然存在，但依然兜底 'unknown'
      const key = `${item.title.replaceAll(' ', '')}-${
        item.year || 'unknown'
      }-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    return sortSearchResultGroupsByRanking(
      searchQuery,
      Array.from(map.entries())
    );
  }, [filteredSearchResults, searchQuery]);

  const shouldShowAiFindGuide = useMemo(
    () =>
      searchMode === 'normal' &&
      showResults &&
      shouldSuggestAiFind(searchQuery, searchResults),
    [searchMode, searchQuery, searchResults, showResults]
  );

  useEffect(() => {
    // 无搜索参数时聚焦搜索框
    !searchParams.get('q') && document.getElementById('searchInput')?.focus();

    // 初始加载搜索历史
    getSearchHistory().then(setSearchHistory);

    // 监听搜索历史更新事件
    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    // 获取滚动位置的函数 - 专门针对 body 滚动
    const getScrollTop = () => {
      return document.body.scrollTop || 0;
    };

    // 使用 requestAnimationFrame 持续检测滚动位置
    let isRunning = false;
    const checkScrollPosition = () => {
      if (!isRunning) return;

      const scrollTop = getScrollTop();
      const shouldShow = scrollTop > 300;
      setShowBackToTop(shouldShow);

      requestAnimationFrame(checkScrollPosition);
    };

    // 启动持续检测
    isRunning = true;
    checkScrollPosition();

    // 监听 body 元素的滚动事件
    const handleScroll = () => {
      const scrollTop = getScrollTop();
      setShowBackToTop(scrollTop > 300);
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      unsubscribe();
      isRunning = false; // 停止 requestAnimationFrame 循环

      // 移除 body 滚动事件监听器
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    setSearchMode(searchModeParam === 'ai' ? 'ai' : 'normal');
  }, [searchModeParam]);

  useEffect(() => {
    const query = searchParams.get('q');
    if (!query) {
      setShowResults(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        setIsLoading(true);
        setResultCategory('all');
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (cancelled) return;
        setSearchResults(sortSearchResultsByRanking(query, data.results));
        setShowResults(true);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    // 保存到搜索历史 (事件监听会自动更新界面)
    addSearchHistory(query);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [searchParams]);

  // 返回顶部功能
  const scrollToTop = () => {
    try {
      // 根据调试结果，真正的滚动容器是 document.body
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (error) {
      // 如果平滑滚动完全失败，使用立即滚动
      document.body.scrollTop = 0;
    }
  };

  const searchHeaderTitle = showResults
    ? pageSectionLabels.searchResults
    : pageMeta['/search'].title;
  const searchHeaderSubtitle = showResults
    ? searchQuery
      ? `当前关键词：${searchQuery}`
      : pageMeta['/search'].subtitle
    : pageMeta['/search'].subtitle;
  const displayedResultCount =
    viewMode === 'agg' ? aggregatedResults.length : filteredSearchResults.length;

  return (
    <PageLayout activePath='/search'>
      <div className='mb-10 space-y-8 overflow-visible sm:px-10 sm:py-8'>
        <PageHeader
          action={
            searchMode === 'normal' && showResults ? (
              <label className='inline-flex cursor-pointer items-center gap-3 rounded-full border border-white/10 bg-[rgba(var(--ui-surface-strong),0.72)] px-3 py-2 text-sm text-[rgb(var(--ui-text-muted))] shadow-ui-soft backdrop-blur-md'>
                <span>聚合</span>
                <div className='relative'>
                  <input
                    type='checkbox'
                    className='peer sr-only'
                    checked={viewMode === 'agg'}
                    onChange={() =>
                      setViewMode(viewMode === 'agg' ? 'all' : 'agg')
                    }
                  />
                  <div className='h-5 w-9 rounded-full bg-white/15 transition-colors peer-checked:bg-[rgb(var(--ui-accent))]' />
                  <div className='absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4' />
                </div>
              </label>
            ) : null
          }
          subtitle={searchHeaderSubtitle}
          title={searchHeaderTitle}
        />

        <div className='mx-auto max-w-[95%] overflow-visible'>
          <Surface className='mb-4 max-w-[28rem] p-1.5' variant='plain'>
            <div className='grid grid-cols-2 gap-1.5'>
              <button
                aria-pressed={searchMode === 'normal'}
                className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                  searchMode === 'normal'
                    ? 'bg-[rgb(var(--ui-accent)/0.18)] text-[rgb(var(--ui-text))] shadow-[inset_0_0_0_1px_rgb(var(--ui-accent)/0.22)]'
                    : 'bg-white/5 text-[rgb(var(--ui-text-muted))] hover:bg-white/10'
                }`}
                onClick={() => setSearchMode('normal')}
                type='button'
              >
                普通搜索
              </button>
              <button
                aria-pressed={searchMode === 'ai'}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                  searchMode === 'ai'
                    ? 'bg-[rgb(var(--ui-success)/0.2)] text-[rgb(var(--ui-success))] shadow-[inset_0_0_0_1px_rgb(var(--ui-success)/0.28)]'
                    : 'bg-white/5 text-[rgb(var(--ui-text-muted))] hover:bg-white/10'
                }`}
                onClick={() => setSearchMode('ai')}
                type='button'
              >
                AI 找片
              </button>
            </div>
          </Surface>

          <div
            key={`${searchMode}-${isLoading ? 'loading' : 'ready'}`}
            className='ui-search-view'
          >
            {searchMode === 'ai' ? (
            <AiFindPanel initialQuery={searchQuery} />
          ) : isLoading ? (
            <section className='space-y-4'>
              <SectionHeader
                subtitle='正在整理结果与可用线路'
                title={pageSectionLabels.searchResults}
              />
              <PosterGrid className='grid-cols-3 justify-start gap-x-2 gap-y-6 px-0 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20 sm:px-2'>
                {Array.from({ length: 12 }).map((_, index) => (
                  <div key={`search-skeleton-${index}`} className='w-full'>
                    <SkeletonPosterCard
                      delayIndex={index}
                      widths={['80%', '58%']}
                    />
                  </div>
                ))}
              </PosterGrid>
            </section>
          ) : showResults ? (
            <section className='space-y-4'>
              <SectionHeader
                subtitle={`当前显示 ${displayedResultCount} 条${
                  viewMode === 'agg' ? '聚合结果' : '原始结果'
                }`}
                title={pageSectionLabels.searchResults}
              />
              {shouldShowAiFindGuide ? (
                <Surface
                  className='border-[rgb(var(--ui-success)/0.24)] bg-[linear-gradient(135deg,rgb(var(--ui-success)/0.12),rgb(var(--ui-bg-elevated)/0.58))] p-4 sm:p-5'
                  variant='plain'
                >
                  <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                    <div>
                      <p className='text-sm font-semibold text-[rgb(var(--ui-text))]'>
                        结果较多，可以用 AI 精准找片
                      </p>
                      <p className='mt-1 text-xs text-[rgb(var(--ui-text-muted))]'>
                        会带入当前关键词，按片名线索重新整理候选结果。
                      </p>
                    </div>
                    <button
                      type='button'
                      onClick={() => setSearchMode('ai')}
                      className='inline-flex min-h-10 items-center justify-center rounded-xl bg-[rgb(var(--ui-success))] px-4 text-sm font-semibold text-[rgb(var(--ui-on-accent))] shadow-ui-soft transition hover:brightness-110'
                    >
                      用 AI 精准找片
                    </button>
                  </div>
                </Surface>
              ) : null}
              {searchResults.length > 0 ? (
                <>
                  <CapsuleSwitch
                    active={resultCategory}
                    aria-label='结果分类'
                    onChange={(value) =>
                      setResultCategory(value as SearchCategory)
                    }
                    options={categoryTabOptions}
                  />
                  {filteredSearchResults.length > 0 ? (
                    <PosterGrid
                      key={`search-results-${viewMode}-${resultCategory}`}
                      className='grid-cols-3 justify-start gap-x-2 gap-y-6 px-0 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20 sm:px-2'
                    >
                      {viewMode === 'agg'
                        ? aggregatedResults.map(([mapKey, group]) => {
                            const meta = getSearchCardMeta(group[0]);
                            return (
                              <div key={`agg-${mapKey}`} className='w-full'>
                                <VideoCard
                                  from='search'
                                  items={group}
                                  query={
                                    searchQuery.trim() !== group[0].title
                                      ? searchQuery.trim()
                                      : ''
                                  }
                                  statusText={meta.statusText}
                                  typeName={meta.typeChip}
                                  year={meta.year}
                                />
                              </div>
                            );
                          })
                        : filteredSearchResults.map((item) => {
                            const meta = getSearchCardMeta(item);
                            return (
                              <div
                                key={`all-${item.source}-${item.id}`}
                                className='w-full'
                              >
                                <VideoCard
                                  id={item.id}
                                  title={item.title}
                                  poster={item.poster}
                                  episodes={item.episodes.length}
                                  source={item.source}
                                  source_name={item.source_name}
                                  douban_id={item.douban_id?.toString()}
                                  query={
                                    searchQuery.trim() !== item.title
                                      ? searchQuery.trim()
                                      : ''
                                  }
                                  year={meta.year}
                                  from='search'
                                  type={
                                    item.episodes.length > 1 ? 'tv' : 'movie'
                                  }
                                  typeName={meta.typeChip}
                                  statusText={meta.statusText}
                                />
                              </div>
                            );
                          })}
                    </PosterGrid>
                  ) : (
                    <Surface
                      className='px-6 py-10 text-center text-[rgb(var(--ui-text-muted))]'
                      variant='plain'
                    >
                      该分类下暂无结果
                    </Surface>
                  )}
                </>
              ) : (
                <Surface
                  className='px-6 py-10 text-center text-[rgb(var(--ui-text-muted))]'
                  variant='plain'
                >
                  未找到相关结果
                </Surface>
              )}
            </section>
          ) : searchHistory.length > 0 ? (
            // 搜索历史
            <section className='space-y-4'>
              <SectionHeader
                action={
                  searchHistory.length > 0 ? (
                    <ActionLink
                      onClick={() => {
                        clearSearchHistory(); // 事件监听会自动更新界面
                      }}
                    >
                      清空
                    </ActionLink>
                  ) : null
                }
                title={pageSectionLabels.searchHistory}
              />
              <Surface className='p-4 sm:p-5' variant='plain'>
                <div className='flex flex-wrap gap-2'>
                  {searchHistory.map((item) => (
                    <div key={item} className='group relative'>
                      <button
                        onClick={() => {
                          router.push(
                            `/search?q=${encodeURIComponent(item.trim())}`
                          );
                        }}
                        className='rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-[rgb(var(--ui-text))] transition-colors duration-200 hover:bg-white/10'
                        type='button'
                      >
                        {item}
                      </button>
                      <button
                        aria-label='删除搜索历史'
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          deleteSearchHistory(item); // 事件监听会自动更新界面
                        }}
                        className='absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[10px] text-white opacity-0 transition-colors group-hover:opacity-100 hover:bg-red-500'
                        type='button'
                      >
                        <X className='h-3 w-3' />
                      </button>
                    </div>
                  ))}
                </div>
              </Surface>
            </section>
          ) : null}
          </div>
        </div>
      </div>

      {/* 返回顶部悬浮按钮 */}
      <button
        onClick={scrollToTop}
        className={`ui-glass fixed bottom-20 right-6 z-[500] flex h-12 w-12 items-center justify-center rounded-full text-[rgb(var(--ui-text))] transition-[opacity,transform,border-color] duration-150 ease ui-hover-scale-md hover:border-[rgb(var(--ui-accent)/0.42)] md:bottom-6 group ${
          showBackToTop
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label='返回顶部'
      >
        <ChevronUp className='w-6 h-6 transition-transform duration-150 ease ui-hover-scale-sm' />
      </button>
    </PageLayout>
  );
}

const SearchFallback = () => {
  return (
    <PageLayout activePath='/search'>
      <div className='space-y-4 sm:px-8 sm:py-6 lg:px-12 lg:py-8'>
        <PageHeader
          subtitle={pageMeta['/search'].subtitle}
          title={pageMeta['/search'].title}
        />
        <div className='mx-auto max-w-[95%] overflow-visible'>
          <section className='space-y-4'>
            <SectionHeader
              subtitle='正在整理结果与可用线路'
              title={pageSectionLabels.searchResults}
            />
            <PosterGrid className='grid-cols-3 justify-start gap-x-2 gap-y-6 px-0 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20 sm:px-2'>
              {Array.from({ length: 12 }).map((_, index) => (
                <div
                  key={`search-skeleton-fallback-${index}`}
                  className='w-full'
                >
                  <SkeletonPosterCard
                    delayIndex={index}
                    widths={['80%', '58%']}
                  />
                </div>
              ))}
            </PosterGrid>
          </section>
        </div>
      </div>
    </PageLayout>
  );
};

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchFallback />}>
      <SearchPageClient />
    </Suspense>
  );
}
