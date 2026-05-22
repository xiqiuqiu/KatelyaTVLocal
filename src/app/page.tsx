/* eslint-disable react-hooks/exhaustive-deps */

'use client';

import { ChevronRight } from 'lucide-react';
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
import { DoubanItem } from '@/lib/types';
import { homeTabMeta, pageSectionLabels } from '@/lib/ui/page-meta';

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
    <div className='bottom-logo-container'>
      <div className='text-center'>
        <div className='bottom-logo'>{siteName}</div>
        <div className='mt-2 text-sm text-[rgb(var(--ui-text-muted))] opacity-75'>
          影视聚合搜索与在线播放
        </div>
      </div>
    </div>
  );
};

function HomeClient() {
  const searchParams = useSearchParams();
  const activeTab =
    searchParams.get('tab') === 'favorites' ? 'favorites' : 'home';
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 收藏夹数据
  type FavoriteItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    source_name: string;
    currentEpisode?: number;
    search_title?: string;
  };

  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

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
      const allFavorites = await getAllFavorites();
      await updateFavoriteItems(allFavorites);
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
  }, [activeTab]);

  const currentHeaderMeta =
    activeTab === 'favorites' ? homeTabMeta.favorites : homeTabMeta.home;

  const renderHomeSection = ({
    href,
    items,
    title,
    type,
  }: {
    href: string;
    items: DoubanItem[];
    title: string;
    type?: string;
  }) => (
    <section className='space-y-4'>
      <SectionHeader
        action={
          <ActionLink href={href}>
            {pageSectionLabels.viewMore}
            <ChevronRight className='h-4 w-4' />
          </ActionLink>
        }
        title={title}
      />
      <PosterGrid className='grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'>
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
                  size='small'
                  title={item.title}
                  type={type}
                  year={item.year}
                />
              </div>
            ))}
      </PosterGrid>
    </section>
  );

  return (
    <PageLayout
      activePath={activeTab === 'favorites' ? '/?tab=favorites' : '/'}
    >
      <div className='space-y-8 overflow-visible sm:px-8 sm:py-6 lg:px-12 lg:py-8'>
        {/* 主内容区大型 KatelyaTV Logo - 仅在首页显示 */}
        {/* {activeTab === 'home' && <MainKatelyaLogo />} */}

        <PageHeader
          subtitle={currentHeaderMeta.subtitle}
          title={currentHeaderMeta.title}
        />

        <div className='mx-auto w-full max-w-none'>
          {activeTab === 'favorites' ? (
            // 收藏夹视图
            <>
              <section className='space-y-4'>
                <SectionHeader
                  action={
                    favoriteItems.length > 0 ? (
                      <ActionLink
                        onClick={async () => {
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
                <PosterGrid className='grid-cols-3 justify-items-center gap-x-2 gap-y-6 px-0 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-6 sm:gap-y-20 sm:px-2 lg:gap-x-8'>
                  {favoriteItems.map((item) => (
                    <div
                      key={item.id + item.source}
                      className='w-full max-w-44'
                    >
                      <VideoCard
                        query={item.search_title}
                        {...item}
                        from='favorite'
                        type={item.episodes > 1 ? 'tv' : ''}
                      />
                    </div>
                  ))}
                  {favoriteItems.length === 0 && (
                    <div className='col-span-full py-8 text-center text-[rgb(var(--ui-text-muted))]'>
                      暂无收藏内容
                    </div>
                  )}
                </PosterGrid>
              </section>

              {/* 收藏夹页面底部 Logo */}
              <BottomKatelyaLogo />
            </>
          ) : (
            // 首页视图
            <>
              {/* 继续观看 */}
              <ContinueWatching />

              {renderHomeSection({
                href: '/douban?type=movie',
                items: hotMovies.slice(0, 12),
                title: pageSectionLabels.popularMovies,
                type: 'movie',
              })}
              {renderHomeSection({
                href: '/douban?type=tv',
                items: hotTvShows.slice(0, 10),
                title: pageSectionLabels.popularShows,
              })}
              {renderHomeSection({
                href: '/douban?type=show',
                items: hotVarietyShows.slice(0, 10),
                title: pageSectionLabels.popularVariety,
              })}

              {/* 首页底部 Logo */}
              <BottomKatelyaLogo />
            </>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

const HomeFallback = () => {
  return (
    <PageLayout activePath='/'>
      <div className='space-y-8 overflow-visible sm:px-8 sm:py-6 lg:px-12 lg:py-8'>
        <PageHeader
          subtitle={homeTabMeta.home.subtitle}
          title={homeTabMeta.home.title}
        />
        <div className='mx-auto w-full max-w-none'>
          <ContinueWatching />

          {[
            pageSectionLabels.popularMovies,
            pageSectionLabels.popularShows,
            pageSectionLabels.popularVariety,
          ].map((title, sectionIndex) => (
            <section key={sectionIndex} className='space-y-4 mt-8'>
              <SectionHeader title={title} />
              <PosterGrid className='grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'>
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
