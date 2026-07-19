'use client';

import { useEffect, useState } from 'react';

import { getAllPlayRecords } from '@/lib/db.client';
import { getDoubanRecommends } from '@/lib/douban.client';
import {
  CATEGORY_TO_TYPE,
  collectHeavilyWatchedTitles,
  type PlayRecommendation,
  type PlayRecommendationCategory,
  selectPlayRecommendations,
} from '@/lib/play-recommendations';

import ScrollableRow from '@/components/ScrollableRow';
import { SkeletonPosterCard } from '@/components/ui/LoadingPrimitives';
import SectionHeader from '@/components/ui/SectionHeader';
import VideoCard from '@/components/VideoCard';

interface PlayRecommendationsProps {
  excludeTitle?: string;
  preferCategory?: PlayRecommendationCategory;
  /** Current title `vod_class` / `detail.class` for genre-fallback candidates. */
  vodClass?: string;
  /** Current title Douban id when the source provides one (forward-compatible). */
  doubanId?: number;
  className?: string;
}

function categoryToDoubanType(
  category: PlayRecommendationCategory
): 'movie' | 'tv' {
  return category === 'movie' ? 'movie' : 'tv';
}

/**
 * Play-page Related Recommendation row — content-based candidates from
 * `/api/douban/recommends`, with client-side heavily-watched filtering.
 */
export default function PlayRecommendations({
  excludeTitle,
  preferCategory = 'movie',
  vodClass,
  doubanId,
  className,
}: PlayRecommendationsProps) {
  const [items, setItems] = useState<PlayRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const cardWidthClass =
    'w-24 min-w-[96px] min-[440px]:w-36 min-[440px]:min-w-[140px] sm:w-44 sm:min-w-[180px]';
  const cardType = CATEGORY_TO_TYPE[preferCategory];

  useEffect(() => {
    let cancelled = false;

    const fetchRecommendations = async () => {
      if (!excludeTitle?.trim()) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);
        const [recommends, playRecords] = await Promise.all([
          getDoubanRecommends({
            title: excludeTitle.trim(),
            class: vodClass,
            type: categoryToDoubanType(preferCategory),
            doubanId,
          }),
          getAllPlayRecords(),
        ]);

        if (cancelled) return;

        const watchedTitles = collectHeavilyWatchedTitles(playRecords);
        const selected = selectPlayRecommendations({
          alsoLiked: recommends.alsoLiked || [],
          genreFallback: recommends.genreFallback || [],
          excludeTitle,
          watchedTitles,
        });

        setItems(selected.map((item) => ({ item, type: cardType })));
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
  }, [cardType, doubanId, excludeTitle, preferCategory, vodClass]);

  if (!loading && items.length === 0) {
    return null;
  }

  return (
    <section
      aria-label='相关推荐'
      className={`space-y-4 ${className || ''}`.trim()}
    >
      <SectionHeader title='相关推荐' />
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
