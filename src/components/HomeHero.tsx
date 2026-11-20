'use client';

import { ChevronLeft, ChevronRight, Play, Star } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { rememberBannerClick } from '@/lib/home-banner.client';
import { buildHomeHeroPlayHref } from '@/lib/home-hero';
import {
  type HomeRecommendation,
  type HomeRecommendationType,
  getHomeRecommendationKey,
} from '@/lib/home-recommendations';
import type { BannerVisit } from '@/lib/playback-quality';
import { createPlaybackQualityReporter } from '@/lib/playback-quality.client';
import { buildTmdbImageUrl } from '@/lib/tmdb/matching';
import { buildTvModeHref } from '@/lib/tv-interaction';
import { processImageUrl } from '@/lib/utils';

import { usePlaybackPreparation } from '@/components/playback-preparation/PlaybackPreparationProvider';
import useTmdbHero from '@/components/useTmdbHero';

const MEDIA_TYPE_LABEL: Record<HomeRecommendationType, string> = {
  movie: '电影',
  tv: '剧集',
  show: '综艺',
};

/** 自动轮播间隔；手动切换后会重新计时。 */
const ROTATE_INTERVAL_MS = 9000;

const POSTER_IMAGE_SIZE = { width: 480, height: 720, quality: 80 };
const BACKDROP_IMAGE_SIZE = { width: 1280, height: 720, quality: 78 };

interface HomeHeroProps {
  recommendations: HomeRecommendation[];
  loading?: boolean;
  tvMode?: boolean;
  testSession?: boolean;
}

function HomeHeroSkeleton() {
  return (
    <section aria-busy='true' aria-label='为你推荐' className='ui-home-feature'>
      <div className='ui-home-feature-stage'>
        <div className='ui-skeleton-block ui-home-feature-stage-fill' />
        <div className='ui-home-feature-body'>
          <div className='ui-home-feature-copy'>
            <div className='ui-skeleton-block h-3 w-24 rounded-ui-sm' />
            <div className='ui-skeleton-block h-9 w-3/4 rounded-ui-sm' />
            <div className='ui-skeleton-block h-4 w-1/2 rounded-ui-sm' />
            <div className='ui-skeleton-block h-11 w-28 rounded-ui-sm' />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HomeHero({
  recommendations,
  loading = false,
  tvMode = false,
  testSession = false,
}: HomeHeroProps) {
  const surfaceRef = useRef<HTMLElement>(null);
  const playbackPreparation = usePlaybackPreparation();
  const tmdb = useTmdbHero(recommendations);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(
    () => new Set()
  );

  const count = recommendations.length;
  const safeIndex = count > 0 ? Math.min(activeIndex, count - 1) : 0;
  const active = count > 0 ? recommendations[safeIndex] : null;
  const visit = useRef<BannerVisit | null>(null);
  const [metrics] = useState(() => createPlaybackQualityReporter());
  const ready = !loading && !tmdb.pending && count > 0;
  const recordStage = useCallback(
    (seq: 1 | 2) => {
      if (!visit.current) {
        if (!globalThis.crypto?.randomUUID) return;
        visit.current = {
          rowKind: 'banner',
          sessionId: crypto.randomUUID(),
          startedAt: Date.now(),
          testSession,
          seq,
        };
      } else {
        if (visit.current.seq >= seq) return visit.current;
        visit.current = { ...visit.current, seq };
      }
      metrics.visit(visit.current);
      return visit.current;
    },
    [metrics, testSession]
  );

  useEffect(() => {
    const node = surfaceRef.current;
    if (
      !ready ||
      !node ||
      visit.current ||
      typeof IntersectionObserver === 'undefined'
    )
      return;
    let visible = false;
    const report = () => {
      if (visible && document.visibilityState === 'visible') {
        recordStage(1);
        observer.disconnect();
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.1;
        report();
      },
      { threshold: 0.1 }
    );
    observer.observe(node);
    document.addEventListener('visibilitychange', report);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', report);
    };
  }, [ready, recordStage]);
  const listKey = useMemo(
    () => recommendations.map(getHomeRecommendationKey).join('|'),
    [recommendations]
  );

  // 推荐列表变化时回到第一张，避免索引越界指到别的内容
  useEffect(() => {
    setActiveIndex(0);
  }, [listKey]);

  const goTo = useCallback(
    (next: number) => {
      if (count < 2) return;
      setActiveIndex(((next % count) + count) % count);
    },
    [count]
  );

  // 自动轮播：电视端、悬停/聚焦中、系统要求减少动效时都不自动切换
  useEffect(() => {
    if (tvMode || paused || count < 2) return;
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const timer = window.setInterval(
      () => setActiveIndex((current) => (current + 1) % count),
      ROTATE_INTERVAL_MS
    );
    return () => window.clearInterval(timer);
  }, [count, paused, tvMode, safeIndex]);

  // 只要还在等数据（热榜 / 本地信号 / TMDB 任一未就绪）就保持骨架，
  // 不能因为「热榜先到」就先画一版中间布局
  if (loading || (count > 0 && tmdb.pending)) {
    return <HomeHeroSkeleton />;
  }

  if (!active) {
    return null;
  }

  const { item, type, reason } = active;
  // 按标题查而不是按下标：推荐列表可能在本地信号到达后重排
  const enrichmentByTitle = new Map(
    tmdb.items.map((entry) => [entry.title, entry])
  );
  const activeEnrichment = enrichmentByTitle.get(item.title);
  const slideImages = recommendations.map(({ item }) => {
    const enrichment = enrichmentByTitle.get(item.title);
    const backdrop =
      enrichment?.matched && enrichment.backdropPath
        ? processImageUrl(
            buildTmdbImageUrl(enrichment.backdropPath, 'w1280'),
            BACKDROP_IMAGE_SIZE
          )
        : '';
    const poster = processImageUrl(item.poster, POSTER_IMAGE_SIZE);
    return {
      backdrop: failedImages.has(backdrop) ? '' : backdrop,
      poster: failedImages.has(poster) ? '' : poster,
    };
  });
  const { backdrop, poster } = slideImages[safeIndex];
  const markImageFailed = (src: string) =>
    setFailedImages((failed) => new Set(failed).add(src));

  const extraMeta = activeEnrichment?.matched
    ? [
        (activeEnrichment.genres ?? []).slice(0, 2).join(' / '),
        activeEnrichment.runtime ? `${activeEnrichment.runtime} 分钟` : '',
      ].filter(Boolean)
    : [];
  const href =
    buildHomeHeroPlayHref(item, type) +
    '&from=home-banner' +
    (testSession ? '&playbackTest=1' : '');
  const playHref = tvMode ? buildTvModeHref(href, true) : href;
  const metadata = [item.year, MEDIA_TYPE_LABEL[type]]
    .filter(Boolean)
    .join(' · ');
  const playbackCardKey = `hero:douban:${item.id || item.title}`;

  const handlePlay = (event: MouseEvent<HTMLAnchorElement>) => {
    const clicked = recordStage(2);
    if (clicked) rememberBannerClick(clicked, playHref);
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
      aria-label='为你推荐'
      aria-roledescription='轮播'
      className='ui-home-feature'
      data-playback-preparation-card={playbackCardKey}
      onBlurCapture={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      ref={surfaceRef}
    >
      <div className='ui-home-feature-stage'>
        <div className='ui-home-feature-art' aria-hidden>
          {slideImages.map(({ backdrop, poster }, index) => {
            const src = backdrop || poster;
            return (
              <span
                className='ui-home-feature-slide'
                data-active={index === safeIndex}
                key={getHomeRecommendationKey(recommendations[index])}
              >
                {src && (
                  <Image
                    alt=''
                    className={
                      backdrop
                        ? 'ui-home-feature-backdrop object-cover'
                        : 'ui-home-feature-ambient object-cover'
                    }
                    fill
                    onError={() => markImageFailed(src)}
                    priority={index === 0}
                    referrerPolicy='no-referrer'
                    sizes={backdrop ? '100vw' : '480px'}
                    src={src}
                  />
                )}
              </span>
            );
          })}
          <div className='ui-home-feature-scrim' />
        </div>

        <div className='ui-home-feature-body'>
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
              {extraMeta.map((entry) => (
                <span key={entry}>{entry}</span>
              ))}
            </div>
            <p className='ui-home-feature-reason'>{reason}</p>
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
            </div>

            {count > 1 && (
              <div className='ui-home-feature-pager'>
                <button
                  aria-label='上一张推荐'
                  className='ui-home-feature-arrow'
                  data-tv-focus-key='hero-prev'
                  onClick={() => goTo(safeIndex - 1)}
                  type='button'
                >
                  <ChevronLeft aria-hidden className='h-4 w-4' />
                </button>
                <span className='ui-home-feature-counter' aria-hidden>
                  {safeIndex + 1} / {count}
                </span>
                <div className='ui-home-feature-dots'>
                  {recommendations.map((recommendation, index) => (
                    <button
                      aria-current={index === safeIndex ? 'true' : undefined}
                      aria-label={`第 ${index + 1} 张推荐：${
                        recommendation.item.title
                      }`}
                      className='ui-home-feature-dot'
                      data-tv-focus-key={`hero-dot-${index}`}
                      key={getHomeRecommendationKey(recommendation)}
                      onClick={() => goTo(index)}
                      type='button'
                    />
                  ))}
                </div>
                <button
                  aria-label='下一张推荐'
                  className='ui-home-feature-arrow'
                  data-tv-focus-key='hero-next'
                  onClick={() => goTo(safeIndex + 1)}
                  type='button'
                >
                  <ChevronRight aria-hidden className='h-4 w-4' />
                </button>
              </div>
            )}
          </div>

          {!backdrop && poster && (
            <div className='ui-home-feature-poster' aria-hidden>
              <Image
                alt=''
                className='object-cover'
                fill
                onError={() => markImageFailed(poster)}
                referrerPolicy='no-referrer'
                sizes='(min-width: 1024px) 320px, 1px'
                src={poster}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
