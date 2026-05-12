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
import { SearchResult } from '@/lib/types';
import { pageMeta, pageSectionLabels } from '@/lib/ui/page-meta';

import PageLayout from '@/components/PageLayout';
import ActionLink from '@/components/ui/ActionLink';
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

  // 从 URL 参数获取搜索词
  const searchQuery = searchParams.get('q') || '';

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

  // 聚合后的结果（按标题和年份分组）
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    searchResults.forEach((item) => {
      // 使用 title + year + type 作为键，year 必然存在，但依然兜底 'unknown'
      const key = `${item.title.replaceAll(' ', '')}-${
        item.year || 'unknown'
      }-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    return Array.from(map.entries()).sort((a, b) => {
      // 优先排序：标题与搜索词完全一致的排在前面
      const aExactMatch = a[1][0].title
        .replaceAll(' ', '')
        .includes(searchQuery.trim().replaceAll(' ', ''));
      const bExactMatch = b[1][0].title
        .replaceAll(' ', '')
        .includes(searchQuery.trim().replaceAll(' ', ''));

      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      // 年份排序
      if (a[1][0].year === b[1][0].year) {
        return a[0].localeCompare(b[0]);
      } else {
        // 处理 unknown 的情况
        const aYear = a[1][0].year;
        const bYear = b[1][0].year;

        if (aYear === 'unknown' && bYear === 'unknown') {
          return 0;
        } else if (aYear === 'unknown') {
          return 1; // a 排在后面
        } else if (bYear === 'unknown') {
          return -1; // b 排在后面
        } else {
          // 都是数字年份，按数字大小排序（大的在前面）
          return aYear > bYear ? -1 : 1;
        }
      }
    });
  }, [searchResults]);

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
    // 当搜索参数变化时更新搜索状态
    const query = searchParams.get('q');
    if (query) {
      fetchSearchResults(query);

      // 保存到搜索历史 (事件监听会自动更新界面)
      addSearchHistory(query);
    } else {
      setShowResults(false);
    }
  }, [searchParams]);

  const fetchSearchResults = async (query: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query.trim())}`
      );
      const data = await response.json();
      setSearchResults(
        data.results.sort((a: SearchResult, b: SearchResult) => {
          // 优先排序：标题与搜索词完全一致的排在前面
          const aExactMatch = a.title === query.trim();
          const bExactMatch = b.title === query.trim();

          if (aExactMatch && !bExactMatch) return -1;
          if (!aExactMatch && bExactMatch) return 1;

          // 如果都匹配或都不匹配，则按原来的逻辑排序
          if (a.year === b.year) {
            return a.title.localeCompare(b.title);
          } else {
            // 处理 unknown 的情况
            if (a.year === 'unknown' && b.year === 'unknown') {
              return 0;
            } else if (a.year === 'unknown') {
              return 1; // a 排在后面
            } else if (b.year === 'unknown') {
              return -1; // b 排在后面
            } else {
              // 都是数字年份，按数字大小排序（大的在前面）
              return parseInt(a.year) > parseInt(b.year) ? -1 : 1;
            }
          }
        })
      );
      setShowResults(true);
    } catch (error) {
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

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
    viewMode === 'agg' ? aggregatedResults.length : searchResults.length;

  return (
    <PageLayout activePath='/search'>
      <div className='mb-10 space-y-8 overflow-visible sm:px-10 sm:py-8'>
        <PageHeader
          action={
            showResults ? (
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
          {isLoading ? (
            <div className='flex h-40 items-center justify-center'>
              <div className='h-8 w-8 animate-spin rounded-full border-b-2 border-green-500'></div>
            </div>
          ) : showResults ? (
            <section className='space-y-4'>
              <SectionHeader
                subtitle={`当前显示 ${displayedResultCount} 条${
                  viewMode === 'agg' ? '聚合结果' : '原始结果'
                }`}
                title={pageSectionLabels.searchResults}
              />
              {searchResults.length > 0 ? (
                <PosterGrid
                  key={`search-results-${viewMode}`}
                  className='grid-cols-3 justify-start gap-x-2 gap-y-6 px-0 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20 sm:px-2'
                >
                  {viewMode === 'agg'
                    ? aggregatedResults.map(([mapKey, group]) => {
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
                            />
                          </div>
                        );
                      })
                    : searchResults.map((item) => (
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
                            year={item.year}
                            from='search'
                            type={item.episodes.length > 1 ? 'tv' : 'movie'}
                          />
                        </div>
                      ))}
                </PosterGrid>
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

      {/* 返回顶部悬浮按钮 */}
      <button
        onClick={scrollToTop}
        className={`fixed bottom-20 md:bottom-6 right-6 z-[500] w-12 h-12 bg-green-500/90 hover:bg-green-500 text-white rounded-full shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center group ${
          showBackToTop
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label='返回顶部'
      >
        <ChevronUp className='w-6 h-6 transition-transform group-hover:scale-110' />
      </button>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
