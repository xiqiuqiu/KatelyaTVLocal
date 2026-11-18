'use client';

import { useMemo } from 'react';

import type { TopRatedEntry } from '@/lib/top-rated';
import { getTopRatedKey } from '@/lib/top-rated';

import ScrollableRow from '@/components/ScrollableRow';
import PosterGrid from '@/components/ui/PosterGrid';
import SectionHeader from '@/components/ui/SectionHeader';
import VideoCard from '@/components/VideoCard';

interface TopRatedRailProps {
  entries: TopRatedEntry[];
  tvMode?: boolean;
}

const MEDIA_TYPE_NAME: Record<TopRatedEntry['type'], string> = {
  movie: '电影',
  tv: '剧集',
  show: '综艺',
};

export default function TopRatedRail({
  entries,
  tvMode = false,
}: TopRatedRailProps) {
  const items = useMemo(() => entries, [entries]);

  if (items.length === 0) return null;

  const Row = tvMode ? PosterGrid : ScrollableRow;

  return (
    <section aria-label='豆瓣高分 Top 10' className='space-y-4'>
      <SectionHeader
        subtitle='三个榜单合池，按豆瓣评分排序'
        title='豆瓣高分 Top 10'
      />
      <Row
        className={
          tvMode
            ? 'grid-cols-2 gap-6 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
            : '[&>div:first-child]:pb-2'
        }
      >
        {items.map((entry) => (
          <div
            className={
              tvMode ? 'w-full' : 'w-[46vw] max-w-40 shrink-0 sm:w-36 xl:w-40'
            }
            key={getTopRatedKey(entry)}
          >
            <div className='ui-top10-item'>
              <span aria-hidden='true' className='ui-top10-rank'>
                {entry.rank}
              </span>
              <div className='ui-top10-card'>
                <VideoCard
                  douban_id={entry.item.id}
                  from='douban'
                  poster={entry.item.poster}
                  rate={entry.item.rate}
                  size={tvMode ? 'default' : 'small'}
                  title={entry.item.title}
                  tvMode={tvMode}
                  type={entry.type}
                  typeName={MEDIA_TYPE_NAME[entry.type]}
                  year={entry.item.year}
                />
              </div>
            </div>
          </div>
        ))}
      </Row>
    </section>
  );
}
