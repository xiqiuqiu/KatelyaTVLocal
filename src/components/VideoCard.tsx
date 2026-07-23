import {
  CheckCircle,
  Heart,
  Link,
  Loader2,
  PlayCircleIcon,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useMemo,
  useState,
  useTransition,
} from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  saveFavorite,
} from '@/lib/db.client';
import { useFavoriteStatus } from '@/lib/favorites-store.client';
import { buildHomeHeroPlayHref } from '@/lib/home-hero';
import { SearchResult } from '@/lib/types';
import { type ImageProxyOptions, processImageUrl } from '@/lib/utils';

import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import CardActions from '@/components/ui/CardActions';
import Surface from '@/components/ui/Surface';

interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  episodes?: number;
  source_name?: string;
  progress?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban';
  currentEpisode?: number;
  douban_id?: string;
  onDelete?: () => void;
  onDeleteRecord?: () => Promise<void> | void;
  rate?: string;
  items?: SearchResult[];
  type?: string;
  typeName?: string;
  statusText?: string;
  size?: 'default' | 'small';
  imagePriority?: boolean;
  imageSize?: ImageProxyOptions;
}

interface FavoriteHeartButtonProps {
  storageKey: string;
  actualSource: string;
  actualId: string;
  actualTitle: string;
  actualPoster: string;
  actualYear?: string;
  actualEpisodes?: number;
  source_name?: string;
  iconButtonClass: string;
  isSmall: boolean;
}

function FavoriteHeartButton({
  storageKey,
  actualSource,
  actualId,
  actualTitle,
  actualPoster,
  actualYear,
  actualEpisodes,
  source_name,
  iconButtonClass,
  isSmall,
}: FavoriteHeartButtonProps) {
  const favorited = useFavoriteStatus(storageKey);

  const handleToggleFavorite = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      try {
        if (favorited) {
          await deleteFavorite(actualSource, actualId);
        } else {
          await saveFavorite(actualSource, actualId, {
            title: actualTitle,
            source_name: source_name || '',
            year: actualYear || '',
            cover: actualPoster,
            total_episodes: actualEpisodes ?? 1,
            save_time: Date.now(),
          });
        }
      } catch (err) {
        throw new Error('切换收藏状态失败');
      }
    },
    [
      actualEpisodes,
      actualId,
      actualPoster,
      actualSource,
      actualTitle,
      actualYear,
      favorited,
      source_name,
    ]
  );

  return (
    <button
      aria-label='切换收藏'
      className={`${iconButtonClass} ${
        favorited
          ? 'border-[rgb(var(--ui-critical)/0.42)] bg-[rgb(var(--ui-critical)/0.2)] text-[rgb(var(--ui-critical))]'
          : ''
      }`}
      onClick={handleToggleFavorite}
      type='button'
    >
      <Heart
        className={favorited ? 'fill-current' : ''}
        size={isSmall ? 18 : 20}
      />
    </button>
  );
}

export default function VideoCard({
  id,
  title = '',
  query = '',
  poster = '',
  episodes,
  source,
  source_name,
  progress = 0,
  year,
  from,
  currentEpisode,
  douban_id,
  onDelete,
  onDeleteRecord,
  rate,
  items,
  type = '',
  typeName,
  statusText,
  size = 'default',
  imagePriority = false,
  imageSize,
}: VideoCardProps) {
  const router = useRouter();
  const [hasImageLoaded, setHasImageLoaded] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [isNavigationPending, startNavigationTransition] = useTransition();
  const showOpeningState = isOpening || isNavigationPending;

  const isAggregate = from === 'search' && !!items?.length;

  const aggregateData = useMemo(() => {
    if (!isAggregate || !items) return null;

    const countMap = new Map<string | number, number>();
    const episodeCountMap = new Map<number, number>();

    items.forEach((item) => {
      if (item.douban_id && item.douban_id !== 0) {
        countMap.set(item.douban_id, (countMap.get(item.douban_id) || 0) + 1);
      }

      const length = item.episodes?.length || 0;
      if (length > 0) {
        episodeCountMap.set(length, (episodeCountMap.get(length) || 0) + 1);
      }
    });

    const getMostFrequent = <T extends string | number>(
      map: Map<T, number>
    ) => {
      let maxCount = 0;
      let result: T | undefined;

      map.forEach((count, key) => {
        if (count > maxCount) {
          maxCount = count;
          result = key;
        }
      });

      return result;
    };

    return {
      first: items[0],
      mostFrequentDoubanId: getMostFrequent(countMap),
      mostFrequentEpisodes: getMostFrequent(episodeCountMap) || 0,
    };
  }, [isAggregate, items]);

  const actualTitle = aggregateData?.first.title ?? title;
  const actualPoster = aggregateData?.first.poster ?? poster;
  const actualSource = aggregateData?.first.source ?? source;
  const actualId = aggregateData?.first.id ?? id;
  const actualDoubanId = String(
    aggregateData?.mostFrequentDoubanId ?? douban_id
  );
  const actualEpisodes = aggregateData?.mostFrequentEpisodes ?? episodes;
  const actualYear = aggregateData?.first.year ?? year;
  const displayYear =
    (year && year !== 'unknown' ? year : undefined) ||
    (actualYear && actualYear !== 'unknown' ? actualYear : undefined);
  const actualQuery = query || '';
  const actualSearchType = isAggregate
    ? aggregateData?.first.episodes?.length === 1
      ? 'movie'
      : 'tv'
    : type;

  const favoriteStorageKey =
    from !== 'douban' && actualSource && actualId
      ? generateStorageKey(actualSource, actualId)
      : null;

  const handleDeleteRecord = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (from !== 'playrecord' || !actualSource || !actualId) return;

      try {
        if (onDeleteRecord) {
          await onDeleteRecord();
        } else {
          await deletePlayRecord(actualSource, actualId);
        }
        onDelete?.();
      } catch (err) {
        throw new Error('删除播放记录失败');
      }
    },
    [actualId, actualSource, from, onDelete, onDeleteRecord]
  );

  const handleClick = useCallback(() => {
    if (showOpeningState) return;

    let href = '';

    if (from === 'douban') {
      href = buildHomeHeroPlayHref(
        { title: actualTitle, year: actualYear || '' },
        actualSearchType === 'movie' ||
          actualSearchType === 'tv' ||
          actualSearchType === 'show'
          ? actualSearchType
          : ''
      );
    } else if (actualSource && actualId) {
      const params = new URLSearchParams();
      params.set('source', actualSource);
      params.set('id', actualId);
      params.set('title', actualTitle);
      if (actualYear) params.set('year', actualYear);
      if (isAggregate) params.set('prefer', 'true');
      if (actualQuery) params.set('stitle', actualQuery.trim());
      if (actualSearchType) params.set('stype', actualSearchType);
      if (from === 'playrecord') params.set('from', 'playrecord');
      href = `/play?${params.toString()}`;
    }

    if (!href) return;

    setIsOpening(true);
    startNavigationTransition(() => {
      router.push(href);
    });
  }, [
    actualId,
    actualQuery,
    actualSearchType,
    actualSource,
    actualTitle,
    actualYear,
    from,
    isAggregate,
    router,
    showOpeningState,
  ]);

  const config = useMemo(() => {
    const configs = {
      playrecord: {
        showSourceName: true,
        showProgress: true,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: true,
        showDoubanLink: false,
        showRating: false,
      },
      favorite: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: false,
      },
      search: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: !isAggregate,
        showCheckCircle: false,
        showDoubanLink: !!actualDoubanId,
        showRating: false,
      },
      douban: {
        showSourceName: false,
        showProgress: false,
        showPlayButton: true,
        showHeart: false,
        showCheckCircle: false,
        showDoubanLink: true,
        showRating: !!rate,
      },
    };

    return configs[from] || configs.search;
  }, [actualDoubanId, from, isAggregate, rate]);

  const isSmall = size === 'small';
  const badgeSizeClass = isSmall
    ? 'text-[10px] px-2 py-1'
    : 'text-xs px-2.5 py-1';
  const iconButtonClass =
    'inline-flex h-9 w-9 items-center justify-center rounded-full border border-[rgb(var(--ui-border)/0.46)] bg-[rgb(var(--ui-bg)/0.45)] text-[rgb(var(--ui-text))] shadow-ui-soft backdrop-blur-md transition-[border-color,background-color,transform] duration-200 ease-out hover:border-[rgb(var(--ui-accent)/0.32)] hover:bg-[rgb(var(--ui-surface-strong)/0.62)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';
  const doubanLinkClass =
    'absolute left-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[rgb(var(--ui-border)/0.58)] bg-[rgb(var(--ui-bg)/0.48)] text-[rgb(var(--ui-success))] shadow-ui-glass backdrop-blur-xl transition-[border-color,background-color,transform] duration-200 ease-out hover:border-[rgb(var(--ui-success)/0.48)] hover:bg-[rgb(var(--ui-surface-strong)/0.68)] hover:text-[rgb(var(--ui-on-accent))] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';
  const posterActionLabel = `打开 ${actualTitle} 海报`;
  const titleActionLabel = `打开 ${actualTitle}`;
  const defaultImageSize = isSmall
    ? { width: 240, height: 360, quality: 76 }
    : { width: 360, height: 540, quality: 78 };
  const resolvedImageSize = imageSize || defaultImageSize;

  return (
    <article
      className={`group relative w-full hover:z-[500] ${
        isSmall ? 'origin-top-left scale-75' : ''
      }`}
    >
      <Surface className='relative overflow-hidden' variant='raised'>
        <div className='relative aspect-[2/3] overflow-hidden rounded-[inherit]'>
          {!hasImageLoaded ? (
            <ImagePlaceholder aspectRatio='aspect-[2/3]' />
          ) : null}

          <Image
            alt={actualTitle}
            className='object-cover'
            fill
            loading={imagePriority ? undefined : 'lazy'}
            onLoad={() => setHasImageLoaded(true)}
            priority={imagePriority}
            referrerPolicy='no-referrer'
            sizes={
              isSmall
                ? '(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 180px'
                : '(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 240px'
            }
            src={processImageUrl(actualPoster, resolvedImageSize)}
          />

          <button
            aria-label={posterActionLabel}
            aria-busy={showOpeningState}
            className='absolute inset-0 z-10 rounded-[inherit]'
            disabled={showOpeningState}
            onClick={handleClick}
            type='button'
          />

          <div
            className={`pointer-events-none absolute inset-0 bg-gradient-to-t from-[rgb(var(--ui-bg)/0.9)] via-[rgb(var(--ui-bg)/0.2)] to-transparent transition-opacity duration-150 ease group-hover:opacity-100 ${
              showOpeningState ? 'opacity-100' : 'opacity-80'
            }`}
          />

          {config.showPlayButton || showOpeningState ? (
            <div
              className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-150 ease ${
                showOpeningState
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              {showOpeningState ? (
                <span className='inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-3 py-2 text-xs font-medium text-white shadow-ui-soft backdrop-blur-md'>
                  <Loader2 className='animate-spin' size={16} />
                  正在打开
                </span>
              ) : (
                <PlayCircleIcon
                  className='fill-transparent text-[rgb(var(--ui-text))] drop-shadow-[0_8px_20px_rgba(0,0,0,0.45)]'
                  size={isSmall ? 34 : 52}
                  strokeWidth={0.9}
                />
              )}
            </div>
          ) : null}

          {config.showDoubanLink && actualDoubanId ? (
            <a
              aria-label='打开豆瓣页面'
              className={doubanLinkClass}
              href={`https://movie.douban.com/subject/${actualDoubanId}`}
              onClick={(event) => event.stopPropagation()}
              rel='noopener noreferrer'
              target='_blank'
            >
              <Link size={isSmall ? 14 : 16} />
            </a>
          ) : null}

          <div className='absolute right-3 top-3 z-20 flex flex-col items-end gap-2'>
            {config.showRating && rate ? (
              <span
                className={`inline-flex items-center justify-center rounded-full bg-[rgb(var(--ui-accent-warm))] font-semibold text-[rgb(var(--ui-bg))] shadow-ui-soft ${badgeSizeClass}`}
              >
                {rate}
              </span>
            ) : null}

            {actualEpisodes && actualEpisodes > 1 ? (
              <span
                className={`inline-flex items-center justify-center rounded-full bg-[rgb(var(--ui-success)/0.9)] font-semibold text-[rgb(var(--ui-on-accent))] shadow-ui-soft ${badgeSizeClass}`}
              >
                {currentEpisode
                  ? `${currentEpisode}/${actualEpisodes}`
                  : actualEpisodes}
              </span>
            ) : null}
          </div>

          {config.showHeart || config.showCheckCircle ? (
            <CardActions>
              {config.showCheckCircle ? (
                <button
                  aria-label='删除播放记录'
                  className={iconButtonClass}
                  onClick={handleDeleteRecord}
                  type='button'
                >
                  <CheckCircle size={isSmall ? 18 : 20} />
                </button>
              ) : null}

              {config.showHeart && favoriteStorageKey && actualSource && actualId ? (
                <FavoriteHeartButton
                  actualEpisodes={actualEpisodes}
                  actualId={actualId}
                  actualPoster={actualPoster}
                  actualSource={actualSource}
                  actualTitle={actualTitle}
                  actualYear={actualYear}
                  iconButtonClass={iconButtonClass}
                  isSmall={isSmall}
                  source_name={source_name}
                  storageKey={favoriteStorageKey}
                />
              ) : null}
            </CardActions>
          ) : null}
        </div>
      </Surface>

      {config.showProgress ? (
        <div className='mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10'>
          <div
            className='h-full w-full origin-left rounded-full bg-[rgb(var(--ui-accent))] transition-transform duration-200 ease-out'
            style={{
              transform: `scaleX(${Math.min(Math.max(progress, 0), 100) / 100})`,
            }}
          />
        </div>
      ) : null}

      <div className={`text-center ${isSmall ? 'mt-2' : 'mt-3'}`}>
        <button
          aria-label={titleActionLabel}
          className={`block w-full truncate font-semibold text-[rgb(var(--ui-text))] transition-colors duration-300 hover:text-[rgb(var(--ui-success))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${
            isSmall ? 'text-lg leading-6' : 'text-base leading-5'
          }`}
          disabled={showOpeningState}
          onClick={handleClick}
          title={actualTitle}
          type='button'
        >
          <span className='inline-flex min-w-0 items-center justify-center gap-1.5'>
            {showOpeningState ? (
              <Loader2 className='shrink-0 animate-spin' size={14} />
            ) : null}
            <span className='truncate'>{actualTitle}</span>
          </span>
        </button>

        {from === 'search' && (typeName || displayYear || statusText) ? (
          <div
            className={`mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-[rgb(var(--ui-text-muted))] ${
              isSmall ? 'text-[10px]' : 'text-xs'
            }`}
          >
            {typeName ? (
              <span className='inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-0.5'>
                {typeName}
              </span>
            ) : null}
            {displayYear ? <span>{displayYear}</span> : null}
            {statusText ? <span>{statusText}</span> : null}
          </div>
        ) : null}

        {config.showSourceName && source_name ? (
          <span
            className={`mt-1 block text-[rgb(var(--ui-text-muted))] ${
              isSmall ? 'text-[10px]' : 'text-xs'
            }`}
          >
            <span className='inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 transition-colors duration-300 group-hover:border-[rgba(var(--ui-success),0.3)] group-hover:text-[rgb(var(--ui-success))]'>
              {source_name}
            </span>
          </span>
        ) : null}
      </div>
    </article>
  );
}
