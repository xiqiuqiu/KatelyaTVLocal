'use client';

import { Play, Star } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { type MouseEvent, useRef } from 'react';

import {
  type HomeHeroCandidate,
  type HomeHeroMediaType,
  buildHomeHeroPlayHref,
} from '@/lib/home-hero';
import { buildTvModeHref } from '@/lib/tv-interaction';
import { processImageUrl } from '@/lib/utils';

import { usePlaybackPreparation } from '@/components/playback-preparation/PlaybackPreparationProvider';

const MEDIA_TYPE_LABEL: Record<Exclude<HomeHeroMediaType, ''>, string> = {
  movie: '电影',
  tv: '剧集',
  show: '综艺',
};

interface HomeHeroProps {
  candidate: HomeHeroCandidate | null;
  loading?: boolean;
  tvMode?: boolean;
}

function HomeHeroSkeleton() {
  return (
    <section aria-busy='true' aria-label='精选推荐' className='ui-home-feature'>
      <div className='ui-home-feature-copy'>
        <div className='ui-skeleton-block h-7 w-3/4 rounded-ui-sm' />
        <div className='ui-skeleton-block h-4 w-1/2 rounded-ui-sm' />
        <div className='ui-skeleton-block h-11 w-28 rounded-ui-sm' />
      </div>
      <div className='ui-skeleton-block ui-home-feature-art' />
    </section>
  );
}

export default function HomeHero({
  candidate,
  loading = false,
  tvMode = false,
}: HomeHeroProps) {
  const surfaceRef = useRef<HTMLElement>(null);
  const playbackPreparation = usePlaybackPreparation();

  if (loading) {
    return <HomeHeroSkeleton />;
  }

  if (!candidate) {
    return null;
  }

  const { item, type } = candidate;
  const href = buildHomeHeroPlayHref(item, type);
  const playHref = tvMode ? buildTvModeHref(href, true) : href;
  const typeLabel = type ? MEDIA_TYPE_LABEL[type] : null;
  const metadata = [item.year, typeLabel].filter(Boolean).join(' · ');
  const posterSrc = processImageUrl(item.poster, {
    width: 640,
    height: 360,
    quality: 78,
  });
  const playbackCardKey = `hero:douban:${item.id || item.title}`;

  const handlePlay = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!playbackPreparation.active) return;
    event.preventDefault();
    const rect = surfaceRef.current?.getBoundingClientRect();
    playbackPreparation.start({
      href: playHref,
      cardKey: playbackCardKey,
      title: item.title,
      poster: item.poster,
      year: item.year,
      rect: {
        top: rect?.top ?? 0,
        left: rect?.left ?? 0,
        width: rect?.width || 320,
        height: rect?.height || 180,
      },
    });
  };

  const listHref = type ? `/douban?type=${type}` : '/douban?type=movie';

  return (
    <section
      aria-label='精选推荐'
      className='ui-home-feature'
      data-playback-preparation-card={playbackCardKey}
      ref={surfaceRef}
    >
      <div className='ui-home-feature-art' aria-hidden>
        <Image
          alt=''
          aria-hidden
          className='ui-home-feature-image object-cover'
          fill
          priority
          referrerPolicy='no-referrer'
          sizes='(max-width: 767px) 100vw, 720px'
          src={posterSrc}
        />
        <div className='ui-home-feature-scrim' />
      </div>
      <div className='ui-home-feature-copy'>
        <p className='ui-home-feature-kicker'>今日私人放映</p>
        <h2 className='ui-home-feature-title line-clamp-2'>{item.title}</h2>
        <div className='ui-home-feature-meta'>
          {item.rate && (
            <span className='ui-home-feature-score'>
              <Star
                aria-hidden
                className='h-3.5 w-3.5 fill-current'
                strokeWidth={0}
              />
              豆瓣 {item.rate}
            </span>
          )}
          {metadata && <span>{metadata}</span>}
        </div>
        <div className='ui-home-feature-actions'>
          <Link
            data-tv-focus-key='hero-play'
            data-tv-primary={tvMode || undefined}
            href={playHref}
            onClick={handlePlay}
            className='ui-home-feature-cta'
          >
            <Play aria-hidden className='h-4 w-4 fill-current' />
            立即播放
          </Link>
          <Link
            href={tvMode ? buildTvModeHref(listHref, true) : listHref}
            className='ui-home-feature-secondary'
          >
            查看片单
          </Link>
        </div>
      </div>
    </section>
  );
}
