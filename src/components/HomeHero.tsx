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

  return (
    <section
      aria-label='精选推荐'
      className='ui-home-feature'
      data-playback-preparation-card={playbackCardKey}
      ref={surfaceRef}
    >
      <div className='ui-home-feature-copy'>
        <h2 className='line-clamp-2 text-xl font-semibold leading-snug text-[rgb(var(--ui-text))] sm:text-2xl'>
          {item.title}
        </h2>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[rgb(var(--ui-text-muted))]'>
          {item.rate && (
            <span className='inline-flex items-center gap-1 font-semibold text-[rgb(var(--ui-accent-warm))]'>
              <Star
                aria-hidden
                className='h-4 w-4 fill-current'
                strokeWidth={0}
              />
              {item.rate}
            </span>
          )}
          {metadata && <span>{metadata}</span>}
        </div>
        <Link
          data-tv-focus-key='hero-play'
          data-tv-primary={tvMode || undefined}
          href={playHref}
          onClick={handlePlay}
          className='inline-flex min-h-11 items-center justify-center gap-2 rounded-ui-sm bg-[rgb(var(--ui-accent))] px-4 py-2 text-sm font-semibold text-[rgb(var(--ui-on-accent))] transition-[filter] duration-150 hover:brightness-110'
        >
          <Play aria-hidden className='h-4 w-4 fill-current' />
          立即播放
        </Link>
      </div>
      <div className='ui-home-feature-art'>
        <Image
          alt=''
          aria-hidden
          className='object-cover object-[center_18%]'
          fill
          loading='lazy'
          referrerPolicy='no-referrer'
          sizes='(max-width: 767px) 38vw, 560px'
          src={posterSrc}
        />
      </div>
    </section>
  );
}
