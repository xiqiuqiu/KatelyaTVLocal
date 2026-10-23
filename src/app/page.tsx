/* eslint-disable react-hooks/exhaustive-deps */

'use client';

import { ChevronRight, Clapperboard, Film, Tv } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

// 客户端收藏 API
import {
  type Favorite,
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { buildTvModeHref, isTvMode } from '@/lib/tv-interaction';
import { DoubanItem } from '@/lib/types';
import { catalogNavigationItems } from '@/lib/ui/navigation';
import { homeTabMeta, pageSectionLabels } from '@/lib/ui/page-meta';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import ContinueWatching from '@/components/ContinueWatching';
import PageLayout from '@/components/PageLayout';
import { useSite } from '@/components/SiteProvider';
import ActionLink from '@/components/ui/ActionLink';
import { SkeletonPosterCard } from '@/components/ui/LoadingPrimitives';
import PageHeader from '@/components/ui/PageHeader';
import PosterGrid from '@/components/ui/PosterGrid';
import SectionHeader from '@/components/ui/SectionHeader';
import VideoCard from '@/components/VideoCard';

export const runtime = 'edge';

// 底部 Logo 组件
const BottomKatelyaLogo = () => {
  const { siteName } = useSite();
  return (
    <footer className='ui-home-footer text-sm text-[rgb(var(--ui-text-muted))]'>
      <div className='font-semibold'>{siteName}</div>
      <div>影视聚合搜索与在线播放</div>
    </footer>
  );
};

function HomeCatalogHeader({ tvMode = false }: { tvMode?: boolean }) {
  return (
    <header className='ui-home-heading'>
      <PageHeader
        title='首页'
        subtitle='电影、剧集与综艺，发现下一部想看的。'
      />
      {!tvMode && (
        <nav aria-label='影片分类' className='ui-home-categories'>
          {catalogNavigationItems.map((item) => {
            const Icon =
              item.key === 'movie'
                ? Film
                : item.key === 'tv'
                ? Tv
                : Clapperboard;
            return (
              <ActionLink key={item.key} href={item.href}>
                <Icon aria-hidden className='h-4 w-4' />
                {item.label}
              </ActionLink>
            );
          })}
        </nav>
      )}
    </header>
  );
}

function HomePosterSection({
  href,
  items,
  loading,
  title,
  tvMode,
  type,
}: {
  href: string;
  items: DoubanItem[];
  loading: boolean;
  title: string;
  tvMode: boolean;
  type?: string;
}) {
  return (
    <section
      aria-label={title}
      aria-busy={loading}
      className='ui-home-poster-section space-y-4'
    >
      <SectionHeader
        action={
          tvMode ? null : (
            <ActionLink href={href}>
              {pageSectionLabels.viewMore}
              <ChevronRight className='h-4 w-4' />
            </ActionLink>
          )
        }
        title={title}
      />
      {!loading && items.length === 0 ? (
        <div className='ui-home-empty'>
          <p>片单暂未显示，可以前往发现页继续浏览。</p>
          <ActionLink href={buildTvModeHref(href, tvMode)}>
            前往发现
            <ChevronRight aria-hidden className='h-4 w-4' />
          </ActionLink>
        </div>
      ) : (
        <PosterGrid
          className={
            tvMode
              ? 'grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5'
              : 'grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6'
          }
        >
          {loading
            ? Array.from({ length: 12 }).map((_, index) => (
                <div key={index} className='w-full'>
                  <SkeletonPosterCard
                    delayIndex={index}
                    widths={['78%', '54%']}
                  />
                </div>
              ))
            : items.map((item, index) => (
                <div key={`${item.id}-${index}`} className='w-full'>
                  <VideoCard
                    douban_id={item.id}
                    from='douban'
                    poster={item.poster}
                    rate={item.rate}
                    size={tvMode ? 'default' : 'small'}
                    tvMode={tvMode}
                    title={item.title}
                    type={type}
                    year={item.year}
                  />
                </div>
              ))}
        </PosterGrid>
      )}
    </section>
  );
}

type FavoriteItem = {
  id: string;
  source: string;
  title: string;
  poster: string;
  episodes: number;
  year?: string;
  source_name: string;
  currentEpisode?: number;
  search_title?: string;
};

function HomeFavoritesHeader({
  currentHeaderMeta,
  favoriteItems,
  managingFavorites,
  setManagingFavorites,
}: {
  currentHeaderMeta: { title: string };
  favoriteItems: FavoriteItem[];
  managingFavorites: boolean;
  setManagingFavorites: (value: boolean) => void;
}) {
  return (
    <PageHeader
      className='ui-library-header'
      subtitle={
        favoriteItems.length
          ? `${favoriteItems.length} 部已收藏影片`
          : undefined
      }
      title={currentHeaderMeta.title}
      action={
        favoriteItems.length > 0 && (
          <button
            type='button'
            aria-pressed={managingFavorites}
            onClick={() => setManagingFavorites(!managingFavorites)}
            className='ui-secondary-button'
          >
            {managingFavorites ? '完成管理' : '管理收藏'}
          </button>
        )
      }
    />
  );
}

function HomeFavorites({
  currentHeaderMeta,
  favoriteCategory,
  favoriteItems,
  favoritesAttempt,
  favoritesError,
  favoritesLoading,
  filteredFavorites,
  managingFavorites,
  setFavoriteCategory,
  setFavoriteItems,
  setFavoritesAttempt,
  setManagingFavorites,
  tvMode,
}: {
  currentHeaderMeta: { title: string };
  favoriteCategory: string;
  favoriteItems: FavoriteItem[];
  favoritesAttempt: number;
  favoritesError: string;
  favoritesLoading: boolean;
  filteredFavorites: FavoriteItem[];
  managingFavorites: boolean;
  setFavoriteCategory: (value: string) => void;
  setFavoriteItems: (items: FavoriteItem[]) => void;
  setFavoritesAttempt: (value: number) => void;
  setManagingFavorites: (value: boolean) => void;
  tvMode: boolean;
}) {
  return (
    <div className='ui-home-content ui-favorites-page ui-library-page'>
      <HomeFavoritesHeader
        currentHeaderMeta={currentHeaderMeta}
        favoriteItems={favoriteItems}
        managingFavorites={managingFavorites}
        setManagingFavorites={setManagingFavorites}
      />
      <div className='ui-home-content'>
        <>
          <section className='ui-library-posters space-y-4'>
            <SectionHeader
              action={
                managingFavorites && favoriteItems.length > 0 ? (
                  <ActionLink
                    onClick={async () => {
                      const { default: Swal } = await import('sweetalert2');
                      const result = await Swal.fire({
                        title: '清空全部收藏？',
                        text: '清空后需要重新收藏影片。',
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonText: '清空收藏',
                        cancelButtonText: '取消',
                        focusCancel: true,
                        customClass: {
                          popup: tvMode ? 'tv-history-confirm' : '',
                        },
                      });
                      if (!result.isConfirmed) return;
                      await clearAllFavorites();
                      setFavoriteItems([]);
                    }}
                  >
                    清空
                  </ActionLink>
                ) : null
              }
              title={pageSectionLabels.favoriteItems}
            />
            {favoriteItems.length > 0 && (
              <CapsuleSwitch
                aria-label='收藏分类'
                active={favoriteCategory}
                onChange={setFavoriteCategory}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'movie', label: '电影' },
                  { value: 'tv', label: '剧集' },
                ]}
              />
            )}
            <PosterGrid
              className={
                tvMode
                  ? 'grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5'
                  : 'grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6'
              }
            >
              {favoritesLoading
                ? Array.from({ length: 6 }, (_, index) => (
                    <SkeletonPosterCard key={index} widths={['78%', '54%']} />
                  ))
                : filteredFavorites.map((item) => (
                    <div key={item.id + item.source} className='w-full'>
                      <VideoCard
                        query={item.search_title}
                        {...item}
                        from='favorite'
                        tvMode={tvMode}
                        showFavoriteAction={managingFavorites}
                        type={item.episodes > 1 ? 'tv' : ''}
                      />
                    </div>
                  ))}
              {!favoritesLoading &&
                (favoritesError || filteredFavorites.length === 0) && (
                  <div className='ui-empty-state col-span-full'>
                    <p role={favoritesError ? 'alert' : 'status'}>
                      {favoritesError ||
                        (favoriteItems.length
                          ? '该分类下暂无收藏'
                          : '暂无收藏内容')}
                    </p>
                    {favoritesError ? (
                      <button
                        type='button'
                        className='ui-secondary-button'
                        onClick={() =>
                          setFavoritesAttempt(favoritesAttempt + 1)
                        }
                      >
                        重试加载
                      </button>
                    ) : (
                      <ActionLink href={buildTvModeHref('/search', tvMode)}>
                        去搜索影片
                      </ActionLink>
                    )}
                  </div>
                )}
            </PosterGrid>
          </section>

          {/* 收藏夹页面底部 Logo */}
          <BottomKatelyaLogo />
        </>
      </div>
    </div>
  );
}

function HomeCatalog({
  hotMovies,
  hotTvShows,
  hotVarietyShows,
  loading,
  tvMode,
}: {
  hotMovies: DoubanItem[];
  hotTvShows: DoubanItem[];
  hotVarietyShows: DoubanItem[];
  loading: boolean;
  tvMode: boolean;
}) {
  return (
    <div className='ui-home-content ui-home-catalog'>
      <HomeCatalogHeader tvMode={tvMode} />
      <ContinueWatching tvMode={tvMode} />

      <HomePosterSection
        href='/douban?type=movie'
        items={hotMovies.slice(0, 12)}
        loading={loading}
        title={pageSectionLabels.popularMovies}
        tvMode={tvMode}
        type='movie'
      />
      <HomePosterSection
        href='/douban?type=tv'
        items={hotTvShows.slice(0, 10)}
        loading={loading}
        title={pageSectionLabels.popularShows}
        tvMode={tvMode}
      />
      <HomePosterSection
        href='/douban?type=show'
        items={hotVarietyShows.slice(0, 10)}
        loading={loading}
        title={pageSectionLabels.popularVariety}
        tvMode={tvMode}
      />

      {/* 首页底部 Logo */}
      <BottomKatelyaLogo />
    </div>
  );
}

function HomeClient() {
  const searchParams = useSearchParams();
  const activeTab =
    searchParams.get('tab') === 'favorites' ? 'favorites' : 'home';
  const tvMode = isTvMode(searchParams);
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 收藏夹数据

  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [favoriteCategory, setFavoriteCategory] = useState('all');
  const [managingFavorites, setManagingFavorites] = useState(false);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoritesError, setFavoritesError] = useState('');
  const [favoritesAttempt, setFavoritesAttempt] = useState(0);
  const filteredFavorites = favoriteItems.filter(
    (item) =>
      favoriteCategory === 'all' ||
      (favoriteCategory === 'tv' ? item.episodes > 1 : item.episodes <= 1)
  );

  useEffect(() => {
    const fetchDoubanData = async () => {
      try {
        setLoading(true);

        // 并行获取热门电影、热门剧集和热门综艺
        const [moviesData, tvShowsData, varietyShowsData] = await Promise.all([
          getDoubanCategories({
            kind: 'movie',
            category: '热门',
            type: '全部',
          }),
          getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
          getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
        ]);

        if (moviesData.code === 200) {
          setHotMovies(moviesData.list);
        }

        if (tvShowsData.code === 200) {
          setHotTvShows(tvShowsData.list);
        }

        if (varietyShowsData.code === 200) {
          setHotVarietyShows(varietyShowsData.list);
        }
      } catch (error) {
        // 静默处理错误，避免控制台警告
        // console.error('获取豆瓣数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDoubanData();
  }, []);

  // 处理收藏数据更新的函数
  const updateFavoriteItems = async (
    allFavorites: Record<string, Favorite>
  ) => {
    const allPlayRecords = await getAllPlayRecords();

    // 根据保存时间排序（从近到远）
    const sorted = Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);

        // 查找对应的播放记录，获取当前集数
        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
        } as FavoriteItem;
      });
    setFavoriteItems(sorted);
  };

  // 当切换到收藏夹时加载收藏数据
  useEffect(() => {
    if (activeTab !== 'favorites') return;

    const loadFavorites = async () => {
      setFavoritesLoading(true);
      setFavoritesError('');
      try {
        const allFavorites = await getAllFavorites();
        await updateFavoriteItems(allFavorites);
      } catch {
        setFavoritesError('收藏加载失败，请重试。');
      } finally {
        setFavoritesLoading(false);
      }
    };

    loadFavorites();

    // 监听收藏更新事件
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, Favorite>) => {
        updateFavoriteItems(newFavorites);
      }
    );

    return unsubscribe;
  }, [activeTab, favoritesAttempt]);

  const currentHeaderMeta =
    activeTab === 'favorites' ? homeTabMeta.favorites : homeTabMeta.home;

  if (activeTab === 'favorites') {
    return (
      <PageLayout activePath='/?tab=favorites' tvMode={tvMode}>
        <HomeFavorites
          currentHeaderMeta={currentHeaderMeta}
          favoriteCategory={favoriteCategory}
          favoriteItems={favoriteItems}
          favoritesAttempt={favoritesAttempt}
          favoritesError={favoritesError}
          favoritesLoading={favoritesLoading}
          filteredFavorites={filteredFavorites}
          managingFavorites={managingFavorites}
          setFavoriteCategory={setFavoriteCategory}
          setFavoriteItems={setFavoriteItems}
          setFavoritesAttempt={setFavoritesAttempt}
          setManagingFavorites={setManagingFavorites}
          tvMode={tvMode}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/' tvMode={tvMode}>
      <HomeCatalog
        hotMovies={hotMovies}
        hotTvShows={hotTvShows}
        hotVarietyShows={hotVarietyShows}
        loading={loading}
        tvMode={tvMode}
      />
    </PageLayout>
  );
}

const HomeFallback = () => {
  return (
    <PageLayout activePath='/'>
      <div className='ui-home-content ui-home-catalog'>
        <HomeCatalogHeader />
        <ContinueWatching />

        {[
          pageSectionLabels.popularMovies,
          pageSectionLabels.popularShows,
          pageSectionLabels.popularVariety,
        ].map((title, sectionIndex) => (
          <section key={sectionIndex} className='space-y-4'>
            <SectionHeader title={title} />
            <PosterGrid className='grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6'>
              {Array.from({ length: 12 }).map((_, index) => (
                <div key={index} className='w-full'>
                  <SkeletonPosterCard
                    delayIndex={index}
                    widths={['78%', '54%']}
                  />
                </div>
              ))}
            </PosterGrid>
          </section>
        ))}

        <BottomKatelyaLogo />
      </div>
    </PageLayout>
  );
};

export default function Home() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeClient />
    </Suspense>
  );
}
