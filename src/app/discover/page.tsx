'use client';

import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type DiscoverFilters,
  type DiscoverMedia,
  buildDiscoverParams,
  createDefaultFilters,
  getYearOptions,
  hasActiveFilters,
  LANGUAGE_OPTIONS,
  mapDiscoverItem,
  RATING_OPTIONS,
  SORT_OPTIONS,
} from '@/lib/tmdb/discover';
import { buildTmdbImageUrl } from '@/lib/tmdb/matching';
import { isTvMode } from '@/lib/tv-interaction';
import { useMediaQuery } from '@/lib/ui/use-media-query';

import PageLayout from '@/components/PageLayout';
import { LoadingRing } from '@/components/ui/LoadingPrimitives';
import PageHeader from '@/components/ui/PageHeader';
import PosterGrid from '@/components/ui/PosterGrid';
import VideoCard from '@/components/VideoCard';

export const runtime = 'edge';

interface GenreOption {
  id: number;
  name: string;
}

interface ChipGroupProps {
  label: string;
  children: React.ReactNode;
}

function ChipGroup({ label, children }: ChipGroupProps) {
  return (
    <div className='ui-filter-row'>
      <span className='ui-filter-row-label'>{label}</span>
      <div className='ui-filter-row-chips'>{children}</div>
    </div>
  );
}

function DiscoverPageClient() {
  const searchParams = useSearchParams();
  const tvMode = isTvMode(searchParams);
  const isWide = useMediaQuery('(min-width: 768px)');

  const [filters, setFilters] = useState<DiscoverFilters>(() =>
    createDefaultFilters('movie')
  );
  const [genres, setGenres] = useState<GenreOption[]>([]);
  const [items, setItems] = useState<ReturnType<typeof mapDiscoverItem>[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [disabled, setDisabled] = useState(false);
  const [total, setTotal] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const media = filters.media;

  // 类型列表跟着 movie / tv 切换
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/tmdb/genre/${media}/list?language=zh-CN`
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { genres?: GenreOption[] };
        if (cancelled) return;
        setGenres(payload.genres ?? []);
      } catch {
        if (!cancelled) setGenres([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [media]);

  const fetchPage = useCallback(
    async (nextPage: number, current: DiscoverFilters) => {
      const params = buildDiscoverParams(current, nextPage);
      const query = new URLSearchParams(params);
      const response = await fetch(
        `/api/tmdb/discover/${current.media}?${query.toString()}`
      );
      if (!response.ok) {
        if (response.status === 503) {
          setDisabled(true);
          throw new Error('disabled');
        }
        throw new Error(`discover ${response.status}`);
      }
      const payload = (await response.json()) as {
        results?: unknown[];
        total_pages?: number;
        total_results?: number;
      };
      const results = Array.isArray(payload.results) ? payload.results : [];
      return {
        total: payload.total_results ?? 0,
        items: results.map((item) =>
          mapDiscoverItem(item as Parameters<typeof mapDiscoverItem>[0])
        ),
        hasMore:
          results.length > 0 && nextPage < (payload.total_pages ?? nextPage),
      };
    },
    []
  );

  // 筛选变化 → 重新从第 1 页拉
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    // 保留上一批结果，等新数据到了再整体替换，避免网格整块消失造成闪屏
    setPage(1);
    setHasMore(true);

    fetchPage(1, filters)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
        setHasMore(result.hasMore);
      })
      .catch((reason: Error) => {
        if (cancelled || reason.message === 'disabled') return;
        setError('筛选加载失败，请稍后重试');
        setHasMore(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters, fetchPage]);

  // 无限滚动
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || loading || loadingMore || !hasMore || error) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setLoadingMore(true);
        const nextPage = page + 1;
        fetchPage(nextPage, filters)
          .then((result) => {
            setItems((previous) => [...previous, ...result.items]);
            setPage(nextPage);
            setHasMore(result.hasMore);
          })
          .catch(() => setHasMore(false))
          .finally(() => setLoadingMore(false));
      },
      { rootMargin: '400px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, fetchPage, filters, hasMore, loading, loadingMore, page]);

  const patchFilters = useCallback((patch: Partial<DiscoverFilters>) => {
    setFilters((previous) => ({ ...previous, ...patch }));
  }, []);

  const toggleGenre = useCallback((id: number) => {
    setFilters((previous) => ({
      ...previous,
      genres: previous.genres.includes(id)
        ? previous.genres.filter((value) => value !== id)
        : [...previous.genres, id],
    }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(createDefaultFilters(media));
  }, [media]);

  const active = hasActiveFilters(filters);
  const gridClass = isWide
    ? 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
    : 'grid-cols-2';

  const mediaTabs = useMemo(
    () =>
      [
        { key: 'movie' as DiscoverMedia, label: '电影' },
        { key: 'tv' as DiscoverMedia, label: '剧集' },
      ] as const,
    []
  );

  return (
    <PageLayout activePath='/discover' tvMode={tvMode}>
      <div className='ui-library-page space-y-6'>
        <PageHeader
          subtitle='按类型、年份、评分、语言自由组合，挑到想看的再去找片源。'
          title='筛选片库'
        />

        <section aria-label='筛选条件' className='ui-filter-panel'>
          <div className='ui-filter-panel-head'>
            <span className='ui-filter-panel-title'>
              <SlidersHorizontal aria-hidden className='h-4 w-4' />
              筛选
              {!loading && !disabled && total > 0 ? (
                <span className='ui-filter-count'>
                  共 {total >= 10000 ? '10000+' : total} 个结果
                </span>
              ) : null}
            </span>
            {active ? (
              <button
                className='ui-secondary-button ui-filter-reset'
                onClick={resetFilters}
                type='button'
              >
                <RefreshCw aria-hidden className='h-3.5 w-3.5' />
                重置
              </button>
            ) : null}
          </div>

          <ChipGroup label='内容'>
            {mediaTabs.map((tab) => (
              <button
                aria-pressed={media === tab.key}
                className='ui-filter-chip'
                key={tab.key}
                onClick={() =>
                  // 电影与剧集的 genre id 不通用，切换时必须清空类型选择
                  setFilters(createDefaultFilters(tab.key))
                }
                type='button'
              >
                {tab.label}
              </button>
            ))}
          </ChipGroup>

          <ChipGroup label='类型'>
            {genres.map((genre) => (
              <button
                aria-pressed={filters.genres.includes(genre.id)}
                className='ui-filter-chip'
                key={genre.id}
                onClick={() => toggleGenre(genre.id)}
                type='button'
              >
                {genre.name}
              </button>
            ))}
          </ChipGroup>

          <ChipGroup label='年份'>
            <button
              aria-pressed={filters.yearRange === null}
              className='ui-filter-chip'
              onClick={() => patchFilters({ yearRange: null })}
              type='button'
            >
              不限
            </button>
            {getYearOptions().map((option: { key: string; label: string }) => (
              <button
                aria-pressed={filters.yearRange === option.key}
                className='ui-filter-chip'
                key={option.key}
                onClick={() =>
                  patchFilters({
                    yearRange:
                      filters.yearRange === option.key ? null : option.key,
                  })
                }
                type='button'
              >
                {option.label}
              </button>
            ))}
          </ChipGroup>

          <ChipGroup label='评分'>
            <button
              aria-pressed={filters.minRating === null}
              className='ui-filter-chip'
              onClick={() => patchFilters({ minRating: null })}
              type='button'
            >
              不限
            </button>
            {RATING_OPTIONS.map((option) => (
              <button
                aria-pressed={filters.minRating === option.value}
                className='ui-filter-chip'
                key={option.key}
                onClick={() =>
                  patchFilters({
                    minRating:
                      filters.minRating === option.value ? null : option.value,
                  })
                }
                type='button'
              >
                {option.label}
              </button>
            ))}
          </ChipGroup>

          <ChipGroup label='语言'>
            <button
              aria-pressed={filters.language === null}
              className='ui-filter-chip'
              onClick={() => patchFilters({ language: null })}
              type='button'
            >
              不限
            </button>
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                aria-pressed={filters.language === option.value}
                className='ui-filter-chip'
                key={option.key}
                onClick={() =>
                  patchFilters({
                    language:
                      filters.language === option.value ? null : option.value,
                  })
                }
                type='button'
              >
                {option.label}
              </button>
            ))}
          </ChipGroup>

          <ChipGroup label='排序'>
            {SORT_OPTIONS.map((option) => (
              <button
                aria-pressed={filters.sortBy === option.value}
                className='ui-filter-chip'
                key={option.key}
                onClick={() => patchFilters({ sortBy: option.value })}
                type='button'
              >
                {option.label}
              </button>
            ))}
          </ChipGroup>
        </section>

        {disabled ? (
          <div className='ui-empty-state'>
            <p>筛选功能暂不可用（未配置 TMDB）。</p>
            <p className='ui-empty-state-hint'>
              可以先去看现成的榜单，或者联系站长补上 TMDB 配置。
            </p>
          </div>
        ) : error ? (
          <div className='ui-empty-state'>
            <p>{error}</p>
          </div>
        ) : loading && items.length === 0 ? (
          <PosterGrid className={gridClass}>
            {Array.from({ length: 12 }).map((_, index) => (
              <div className='w-full' key={`skeleton-${index}`}>
                <div className='ui-skeleton-block aspect-[2/3] w-full rounded-ui-md' />
                <div className='ui-skeleton-block mt-2 h-3 w-3/4 rounded-ui-sm' />
                <div className='ui-skeleton-block mt-1.5 h-2.5 w-1/2 rounded-ui-sm' />
              </div>
            ))}
          </PosterGrid>
        ) : items.length === 0 ? (
          <div className='ui-empty-state'>
            <p>这个组合下没有找到影片。</p>
            <p className='ui-empty-state-hint'>试试放宽年份或评分条件。</p>
          </div>
        ) : (
          <div
            className='ui-discovery-grid'
            data-loading={loading || undefined}
          >
            <PosterGrid className={gridClass}>
              {items.map((item) => (
                <div className='w-full' key={item.id}>
                  <VideoCard
                    from='douban'
                    linkParams={{
                      from: 'discover',
                      alt: item.originalTitle,
                      stype: media,
                    }}
                    poster={buildTmdbImageUrl(item.posterPath, 'w342')}
                    rate={item.rate}
                    size={tvMode ? 'default' : 'small'}
                    title={item.title}
                    tvMode={tvMode}
                    type={media}
                    typeName={media === 'movie' ? '电影' : '剧集'}
                    year={item.year}
                  />
                </div>
              ))}
            </PosterGrid>
          </div>
        )}

        {tvMode && hasMore && !loading ? (
          <div className='ui-discovery-more'>
            <button
              className='ui-primary-button'
              disabled={loadingMore}
              onClick={() => {
                if (loadingMore) return;
                setLoadingMore(true);
                const nextPage = page + 1;
                fetchPage(nextPage, filters)
                  .then((result) => {
                    setItems((previous) => [...previous, ...result.items]);
                    setPage(nextPage);
                    setHasMore(result.hasMore);
                  })
                  .catch(() => setHasMore(false))
                  .finally(() => setLoadingMore(false));
              }}
              type='button'
            >
              {loadingMore ? '正在加载' : '加载更多'}
            </button>
          </div>
        ) : null}

        <div className='ui-discovery-sentinel' ref={sentinelRef} />
        {loadingMore ? (
          <div className='ui-discovery-loading'>
            <LoadingRing />
          </div>
        ) : null}
      </div>
    </PageLayout>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={null}>
      <DiscoverPageClient />
    </Suspense>
  );
}
