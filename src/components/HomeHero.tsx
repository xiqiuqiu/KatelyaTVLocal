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

import { buildHomeHeroPlayHref } from '@/lib/home-hero';
import {
  type HomeRecommendation,
  type HomeRecommendationType,
  getHomeRecommendationKey,
} from '@/lib/home-recommendations';
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

/** 首屏只有竖版海报可用，取三种尺寸：虚化铺底、完整海报、侧栏缩略图。 */
const AMBIENT_IMAGE_SIZE = { width: 480, height: 720, quality: 70 };
const POSTER_IMAGE_SIZE = { width: 480, height: 720, quality: 80 };
const THUMB_IMAGE_SIZE = { width: 144, height: 216, quality: 66 };
const BACKDROP_IMAGE_SIZE = { width: 1280, height: 720, quality: 78 };

interface HomeHeroProps {
  recommendations: HomeRecommendation[];
  loading?: boolean;
  tvMode?: boolean;
}

function HomeHeroSkeleton() {
  return (
    <section
      aria-busy='true'
      aria-label='为你推荐'
      className='ui-home-feature'
      data-layout='backdrop'
    >
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
}: HomeHeroProps) {
  const surfaceRef = useRef<HTMLElement>(null);
  const playbackPreparation = usePlaybackPreparation();
  const tmdb = useTmdbHero(recommendations);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = recommendations.length;
  const safeIndex = count > 0 ? Math.min(activeIndex, count - 1) : 0;
  const active = count > 0 ? recommendations[safeIndex] : null;
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

  if ((loading && count === 0) || (count > 0 && tmdb.pending)) {
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
  const activeBackdrop = activeEnrichment?.matched
    ? activeEnrichment.backdropPath || ''
    : '';
  // 有横版剧照就走全幅大图，否则保持竖版海报双栏
  const layout = activeBackdrop ? 'backdrop' : 'split';
  const extraMeta = activeEnrichment?.matched
    ? [
        (activeEnrichment.genres ?? []).slice(0, 2).join(' / '),
        activeEnrichment.runtime ? `${activeEnrichment.runtime} 分钟` : '',
      ].filter(Boolean)
    : [];
  const href = buildHomeHeroPlayHref(item, type);
  const playHref = tvMode ? buildTvModeHref(href, true) : href;
  const metadata = [item.year, MEDIA_TYPE_LABEL[type]]
    .filter(Boolean)
    .join(' · ');
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
      aria-label='为你推荐'
      className='ui-home-feature'
      data-layout={layout}
      data-playback-preparation-card={playbackCardKey}
      onBlurCapture={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      ref={surfaceRef}
    >
      {/* 左半：虚化铺底 + 文案 + 完整竖版海报；右半：候选清单 */}
      <div className='ui-home-feature-stage'>
        <div className='ui-home-feature-art' aria-hidden>
          {recommendations.map((recommendation, index) => (
            <span
              className='ui-home-feature-slide'
              data-active={index === safeIndex}
              key={getHomeRecommendationKey(recommendation)}
            >
              {enrichmentByTitle.get(recommendation.item.title)?.matched &&
              enrichmentByTitle.get(recommendation.item.title)?.backdropPath ? (
                <Image
                  alt=''
                  aria-hidden
                  className='ui-home-feature-backdrop object-cover'
                  fill
                  priority={index === 0}
                  referrerPolicy='no-referrer'
                  sizes='100vw'
                  src={processImageUrl(
                    buildTmdbImageUrl(
                      enrichmentByTitle.get(recommendation.item.title)
                        ?.backdropPath ?? '',
                      'w1280'
                    ),
                    BACKDROP_IMAGE_SIZE
                  )}
                />
              ) : (
                <Image
                  alt=''
                  aria-hidden
                  className='ui-home-feature-ambient object-cover'
                  fill
                  priority={index === 0}
                  referrerPolicy='no-referrer'
                  sizes='(max-width: 1023px) 100vw, 760px'
                  src={processImageUrl(
                    recommendation.item.poster,
                    AMBIENT_IMAGE_SIZE
                  )}
                />
              )}
            </span>
          ))}
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

          <div className='ui-home-feature-poster'>
            {recommendations.map((recommendation, index) => (
              <span
                className='ui-home-feature-slide'
                data-active={index === safeIndex}
                key={getHomeRecommendationKey(recommendation)}
              >
                <Image
                  alt=''
                  aria-hidden
                  className='object-cover'
                  fill
                  priority={index === 0}
                  referrerPolicy='no-referrer'
                  sizes='(max-width: 767px) 34vw, 260px'
                  src={processImageUrl(
                    recommendation.item.poster,
                    POSTER_IMAGE_SIZE
                  )}
                />
              </span>
            ))}
          </div>
        </div>
      </div>

      {count > 1 && (
        <aside aria-label='更多推荐' className='ui-home-feature-list'>
          <p className='ui-home-feature-list-title'>接下来</p>
          <ul>
            {recommendations.map((recommendation, index) => (
              <li key={getHomeRecommendationKey(recommendation)}>
                <button
                  aria-current={index === safeIndex ? 'true' : undefined}
                  aria-label={`切换到${recommendation.item.title}`}
                  className='ui-home-feature-list-item'
                  data-tv-focus-key={`hero-item-${index}`}
                  onClick={() => goTo(index)}
                  type='button'
                >
                  <span className='ui-home-feature-list-thumb'>
                    <Image
                      alt=''
                      aria-hidden
                      className='object-cover'
                      fill
                      referrerPolicy='no-referrer'
                      sizes='72px'
                      src={processImageUrl(
                        recommendation.item.poster,
                        THUMB_IMAGE_SIZE
                      )}
                    />
                  </span>
                  <span className='ui-home-feature-list-text'>
                    <span className='ui-home-feature-list-name'>
                      {recommendation.item.title}
                    </span>
                    <span className='ui-home-feature-list-meta'>
                      {[
                        recommendation.item.year,
                        MEDIA_TYPE_LABEL[recommendation.type],
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {recommendation.item.rate && (
                    <span className='ui-home-feature-list-score'>
                      {recommendation.item.rate}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </section>
  );
}
