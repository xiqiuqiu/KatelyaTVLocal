'use client';

import { useEffect, useState } from 'react';

import { getDoubanCategories } from '@/lib/douban.client';
import type { PlayRecommendationCategory } from '@/lib/play-recommendations';
import {
  type PlayRecommendation,
  selectPlayRecommendations,
} from '@/lib/play-recommendations';
import type { DoubanItem } from '@/lib/types';

import ScrollableRow from '@/components/ScrollableRow';
import { SkeletonPosterCard } from '@/components/ui/LoadingPrimitives';
import SectionHeader from '@/components/ui/SectionHeader';
import VideoCard from '@/components/VideoCard';

interface PlayRecommendationsProps {
  excludeTitle?: string;
  preferCategory?: PlayRecommendationCategory;
  className?: string;
}

/**
 * “猜你喜欢” — Douban hot/category lists already used on home.
 * Not a personalized recommendation API; not the same-title source list.
 */
export default function PlayRecommendations({
  excludeTitle,
  preferCategory = 'movie',
  className,
}: PlayRecommendationsProps) {
  const [items, setItems] = useState<PlayRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const cardWidthClass =
    'w-24 min-w-[96px] min-[440px]:w-36 min-[440px]:min-w-[140px] sm:w-44 sm:min-w-[180px]';

  useEffect(() => {
    let cancelled = false;

    const fetchRecommendations = async () => {
      try {
        setLoading(true);
        const [moviesData, tvShowsData, varietyShowsData] = await Promise.all([
          getDoubanCategories({
            kind: 'movie',
            category: '热门',
            type: '全部',
          }),
          getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
          getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
        ]);

        if (cancelled) return;

        const movies: DoubanItem[] =
          moviesData.code === 200 ? moviesData.list : [];
        const tvShows: DoubanItem[] =
          tvShowsData.code === 200 ? tvShowsData.list : [];
        const varietyShows: DoubanItem[] =
          varietyShowsData.code === 200 ? varietyShowsData.list : [];

        setItems(
          selectPlayRecommendations({
            excludeTitle,
            preferCategory,
            movies,
            tvShows,
            varietyShows,
          })
        );
      } catch {
        if (!cancelled) {
          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchRecommendations();

    return () => {
      cancelled = true;
    };
  }, [excludeTitle, preferCategory]);

  if (!loading && items.length === 0) {
    return null;
  }

  return (
    <section
      aria-label='猜你喜欢'
      className={`space-y-4 ${className || ''}`.trim()}
    >
      <SectionHeader title='猜你喜欢' />
      <ScrollableRow>
        {loading
          ? Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={cardWidthClass}>
                <SkeletonPosterCard
                  delayIndex={index}
                  widths={['84%', '62%']}
                />
              </div>
            ))
          : items.map(({ item, type }) => (
              <div key={`${type}-${item.id}`} className={cardWidthClass}>
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
      </ScrollableRow>
    </section>
  );
}
