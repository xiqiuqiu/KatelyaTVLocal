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
}

function HomeHeroSkeleton() {
  return (
    <section
      aria-busy='true'
      aria-label='精选推荐'
      className='relative overflow-hidden rounded-ui-lg border border-[rgb(var(--ui-border)/0.28)] bg-[rgb(var(--ui-surface)/0.35)]'
    >
      <div className='aspect-[16/10] w-full animate-pulse bg-[rgb(var(--ui-surface-strong)/0.45)] sm:aspect-[21/9]' />
    </section>
  );
}

export default function HomeHero({
  candidate,
  loading = false,
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
  const playHref = buildHomeHeroPlayHref(item, type);
  const typeLabel = type ? MEDIA_TYPE_LABEL[type] : null;
  const metadata = [item.year, typeLabel].filter(Boolean).join(' · ');
  const posterSrc = processImageUrl(item.poster, {
    width: 1280,
    height: 720,
    quality: 82,
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
      className='relative overflow-hidden rounded-ui-lg border border-[rgb(var(--ui-border)/0.28)] bg-[rgb(var(--ui-bg))] shadow-ui-soft'
      data-playback-preparation-card={playbackCardKey}
      ref={surfaceRef}
    >
      <div className='relative aspect-[16/10] w-full sm:aspect-[21/9]'>
        <Image
          alt=''
          aria-hidden
          className='object-cover object-[center_18%]'
          fill
          priority
          referrerPolicy='no-referrer'
          sizes='(max-width: 640px) 100vw, (max-width: 1280px) 90vw, 1100px'
          src={posterSrc}
        />

        {/* Wide-banner read: vertical poster crop + layered gradients */}
        <div
          aria-hidden
          className='absolute inset-0 bg-gradient-to-r from-[rgb(var(--ui-bg)/0.96)] via-[rgb(var(--ui-bg)/0.55)] to-[rgb(var(--ui-bg)/0.18)]'
        />
        <div
          aria-hidden
          className='absolute inset-0 bg-gradient-to-t from-[rgb(var(--ui-bg)/0.92)] via-[rgb(var(--ui-bg)/0.2)] to-transparent'
        />

        <div className='absolute inset-0 flex items-end'>
          <div className='flex w-full max-w-xl flex-col gap-3 px-4 py-5 sm:gap-4 sm:px-8 sm:py-8 lg:px-10'>
            <div className='space-y-2'>
              <h2 className='text-2xl font-semibold tracking-tight text-[rgb(var(--ui-text))] sm:text-3xl lg:text-4xl'>
                {item.title}
              </h2>

              <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[rgb(var(--ui-text-muted))] sm:text-base'>
                {item.rate ? (
                  <span className='inline-flex items-center gap-1 font-semibold text-[rgb(var(--ui-accent-warm))]'>
                    <Star
                      aria-hidden
                      className='h-4 w-4 fill-current'
                      strokeWidth={0}
                    />
                    {item.rate}
                  </span>
                ) : null}
                {metadata ? <span>{metadata}</span> : null}
              </div>
            </div>

            <div className='flex flex-wrap items-center gap-2 sm:gap-3'>
              <Link
                className='inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[rgb(var(--ui-accent))] px-4 text-sm font-semibold text-[rgb(var(--ui-on-accent))] shadow-ui-soft transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent sm:min-h-11 sm:px-5'
                href={playHref}
                onClick={handlePlay}
              >
                <Play aria-hidden className='h-4 w-4 fill-current' />
                立即播放
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
