import {
  CheckCircle,
  Film,
  Heart,
  Link,
  Loader2,
  Play,
  PlayCircleIcon,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useMemo,
  useRef,
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
import { buildTvModeHref } from '@/lib/tv-interaction';
import { SearchResult } from '@/lib/types';
import { type ImageProxyOptions, processImageUrl } from '@/lib/utils';

import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import { usePlaybackPreparation } from '@/components/playback-preparation/PlaybackPreparationProvider';
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
  description?: string;
  showFavoriteAction?: boolean;
  size?: 'default' | 'small';
  imagePriority?: boolean;
  imageSize?: ImageProxyOptions;
  tvMode?: boolean;
  layout?: 'poster' | 'landscape' | 'result';
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

const videoCardIconButtonClass =
  'inline-flex h-11 w-11 items-center justify-center rounded-ui-sm bg-black/80 text-white transition-colors duration-150 hover:bg-black focus-visible:outline-white';
const videoCardDoubanLinkClass =
  'absolute left-2 top-2 z-20 inline-flex h-11 w-11 items-center justify-center rounded-ui-sm bg-black/80 text-white transition-colors duration-150 hover:bg-black';

function buildVideoCardFacts({
  id,
  title,
  query,
  poster,
  episodes,
  source,
  source_name,
  progress,
  year,
  from,
  currentEpisode,
  douban_id,
  rate,
  items,
  type,
  typeName,
  statusText,
  description,
  showFavoriteAction,
  size,
  imagePriority,
  imageSize,
  tvMode,
  layout,
  aggregateData,
  imageState,
  showOpeningState,
  sourcesOpen,
  isAggregate,
}: {
  id?: string;
  title: string;
  query: string;
  poster: string;
  episodes?: number;
  source?: string;
  source_name?: string;
  progress: number;
  year?: string;
  from: VideoCardProps['from'];
  currentEpisode?: number;
  douban_id?: string;
  rate?: string;
  items?: SearchResult[];
  type: string;
  typeName?: string;
  statusText?: string;
  description?: string;
  showFavoriteAction: boolean;
  size: 'default' | 'small';
  imagePriority: boolean;
  imageSize?: ImageProxyOptions;
  tvMode: boolean;
  layout: 'poster' | 'landscape' | 'result';
  aggregateData: {
    first: SearchResult;
    mostFrequentDoubanId?: string | number;
    mostFrequentEpisodes: number;
  } | null;
  imageState: { poster: string; status: 'loaded' | 'error' } | null;
  showOpeningState: boolean;
  sourcesOpen: boolean;
  isAggregate: boolean;
}) {
  const actualTitle = aggregateData?.first.title ?? title;
  const actualPoster = aggregateData?.first.poster ?? poster;
  const hasImageLoaded = imageState?.poster === actualPoster;
  const hasImageError = hasImageLoaded && imageState?.status === 'error';
  const actualSource = aggregateData?.first.source ?? source;
  const actualId = aggregateData?.first.id ?? id;
  const resolvedDoubanId = aggregateData?.mostFrequentDoubanId ?? douban_id;
  const actualDoubanId =
    resolvedDoubanId && String(resolvedDoubanId) !== '0'
      ? String(resolvedDoubanId)
      : '';
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
  const playbackCardKey = `${from}:${actualSource || 'douban'}:${
    actualId || actualDoubanId || actualTitle
  }`;
  const config = {
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
  }[from] || {
    showSourceName: true,
    showProgress: false,
    showPlayButton: true,
    showHeart: !isAggregate,
    showCheckCircle: false,
    showDoubanLink: !!actualDoubanId,
    showRating: false,
  };
  const isSmall = size === 'small';
  const isLandscape = layout === 'landscape';
  const isResult = layout === 'result';
  const defaultImageSize = isSmall
    ? { width: 240, height: 360, quality: 76 }
    : { width: 360, height: 540, quality: 78 };
  const resolvedImageSize =
    imageSize ||
    (isLandscape ? { width: 640, height: 360, quality: 78 } : defaultImageSize);
  const cappedProgress = Math.min(Math.max(progress, 0), 100);

  return {
    actualDoubanId,
    actualEpisodes,
    actualId,
    actualPoster,
    actualQuery,
    actualSearchType,
    actualSource,
    actualTitle,
    actualYear,
    aggregateCountText: `${items?.length ?? 0} 个来源`,
    articleClass: `group relative w-full ${
      isLandscape ? 'ui-resume-card' : ''
    } ${isResult ? 'ui-search-card' : ''}`,
    aspectRatio: isLandscape ? 'aspect-video' : 'aspect-[2/3]',
    badgeSizeClass: isSmall ? 'text-[10px] px-2 py-1' : 'text-xs px-2.5 py-1',
    continueLabel: showOpeningState ? '正在打开' : '继续播放',
    description,
    displayYear,
    doubanLinkClass: videoCardDoubanLinkClass,
    episodeBadgeText: currentEpisode
      ? `${currentEpisode}/${actualEpisodes}`
      : `${actualEpisodes ?? ''}`,
    favoriteBarClass: tvMode ? '!opacity-100' : '',
    favoriteStorageKey,
    hasImageError,
    hasImageLoaded,
    iconButtonClass: videoCardIconButtonClass,
    imageLoading: imagePriority ? undefined : ('lazy' as const),
    imagePriority,
    imageSizes: isLandscape
      ? '(max-width: 640px) 78vw, 320px'
      : isSmall
      ? '(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 180px'
      : '(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 240px',
    imageSrc: processImageUrl(actualPoster, resolvedImageSize),
    isAggregate,
    isResult,
    isSmall,
    items,
    landscapeStatusText: `${
      currentEpisode ? `第 ${currentEpisode} 集 · ` : ''
    }已看 ${Math.round(cappedProgress)}%${
      source_name ? ` · ${source_name}` : ''
    }`,
    linkIconSize: isSmall ? 14 : 16,
    metaClass: `ui-video-meta text-left ${
      isResult ? 'ui-search-meta' : isSmall ? 'mt-2' : 'mt-3'
    }`,
    playIconSize: isSmall ? 34 : 52,
    playOverlayClass: `pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-150 ease ${
      showOpeningState
        ? 'opacity-100'
        : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
    }`,
    playbackCardKey,
    posterActionLabel: `打开 ${actualTitle} 海报`,
    posterCardPrimary: (tvMode && !isLandscape && !isResult) || undefined,
    posterFocusKey:
      !isLandscape && !isResult ? `play:${playbackCardKey}` : undefined,
    posterTabIndex: tvMode && (isLandscape || isResult) ? -1 : undefined,
    primaryActionLabel: showOpeningState ? '正在打开' : '查看并播放',
    progressScale: cappedProgress / 100,
    query,
    rate,
    resultDescription: description || aggregateData?.first.desc || '',
    searchMetaClass: `mt-1.5 flex flex-wrap items-center gap-1.5 text-[rgb(var(--ui-text-muted))] ${
      isSmall ? 'text-[10px]' : 'text-xs'
    }`,
    showAggregateCount: isResult && isAggregate,
    showAggregateToggle: isResult && isAggregate,
    showCheckCircle: config.showCheckCircle,
    showContinue: isLandscape,
    showDoubanLink: !tvMode && config.showDoubanLink && !!actualDoubanId,
    showEpisodeBadge: !!actualEpisodes && actualEpisodes > 1,
    showFavoriteBar: config.showHeart || config.showCheckCircle,
    showHeartButton: !!(
      config.showHeart &&
      showFavoriteAction &&
      favoriteStorageKey &&
      actualSource &&
      actualId
    ),
    showLandscapeStatus: isLandscape,
    showOpeningState,
    showPlayOverlay: config.showPlayButton || showOpeningState,
    showProgress: config.showProgress,
    showRating: !!(config.showRating && rate),
    showResultDescription: !!(description || aggregateData?.first.desc),
    showSearchMeta:
      from === 'search' && !!(typeName || displayYear || statusText),
    showSourceChip: !!(config.showSourceName && source_name && !isLandscape),
    showSourceList: isResult && isAggregate && sourcesOpen,
    smallIconSize: isSmall ? 18 : 20,
    sourceChipClass: `mt-1 block text-[rgb(var(--ui-text-muted))] ${
      isSmall ? 'text-[10px]' : 'text-xs'
    }`,
    source_name,
    sourcesOpen,
    sourcesToggleLabel: sourcesOpen ? '收起来源' : '展开来源',
    statusText,
    surfaceClass: `relative overflow-hidden ${
      isResult ? 'ui-search-poster' : ''
    }`,
    titleActionLabel: `打开 ${actualTitle}`,
    titleTabIndex: tvMode ? -1 : undefined,
    tvCardPrimary: tvMode || undefined,
    tvMode,
    typeName,
  };
}

function useVideoCardModel({
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
  description,
  showFavoriteAction = true,
  size = 'default',
  imagePriority = false,
  imageSize,
  tvMode = false,
  layout = 'poster',
}: VideoCardProps) {
  const router = useRouter();
  const posterRef = useRef<HTMLDivElement>(null);
  const playbackPreparation = usePlaybackPreparation();
  const [imageState, setImageState] = useState<{
    poster: string;
    status: 'loaded' | 'error';
  } | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
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

  const facts = buildVideoCardFacts({
    aggregateData,
    currentEpisode,
    description,
    douban_id,
    episodes,
    from,
    id,
    imagePriority,
    imageSize,
    imageState,
    isAggregate,
    items,
    layout,
    poster,
    progress,
    query,
    rate,
    showFavoriteAction,
    showOpeningState,
    size,
    source,
    source_name,
    sourcesOpen,
    statusText,
    title,
    tvMode,
    type,
    typeName,
    year,
  });
  const {
    actualId,
    actualPoster,
    actualQuery,
    actualSearchType,
    actualSource,
    actualTitle,
    actualYear,
    isAggregate: aggregateCard,
    playbackCardKey,
  } = facts;

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
      if (aggregateCard) params.set('prefer', 'true');
      if (actualQuery) params.set('stitle', actualQuery.trim());
      if (actualSearchType) params.set('stype', actualSearchType);
      if (from === 'playrecord') params.set('from', 'playrecord');
      href = `/play?${params.toString()}`;
    }

    if (!href) return;
    if (tvMode) href = buildTvModeHref(href, true);

    setIsOpening(true);
    if (playbackPreparation.active) {
      const rect = posterRef.current?.getBoundingClientRect();
      playbackPreparation.start({
        href,
        cardKey: playbackCardKey,
        title: actualTitle,
        poster: actualPoster,
        year: actualYear,
        rect: {
          top: rect?.top ?? 0,
          left: rect?.left ?? 0,
          width: rect?.width || 120,
          height: rect?.height || 180,
        },
      });
      return;
    }
    startNavigationTransition(() => {
      router.push(href);
    });
  }, [
    actualId,
    actualPoster,
    actualQuery,
    actualSearchType,
    actualSource,
    actualTitle,
    actualYear,
    aggregateCard,
    from,
    playbackCardKey,
    playbackPreparation,
    router,
    showOpeningState,
    tvMode,
  ]);

  return {
    ...facts,
    handleClick,
    handleDeleteRecord,
    posterRef,
    setImageState,
    setSourcesOpen,
  };
}

type VideoCardModel = ReturnType<typeof useVideoCardModel>;

function VideoCardImage({ model }: { model: VideoCardModel }) {
  if (!model.hasImageLoaded) {
    return (
      <>
        <ImagePlaceholder aspectRatio={model.aspectRatio} />
        <Image
          alt={model.actualTitle}
          className='object-cover'
          fill
          loading={model.imageLoading}
          onLoad={() =>
            model.setImageState({
              poster: model.actualPoster,
              status: 'loaded',
            })
          }
          onError={() =>
            model.setImageState({ poster: model.actualPoster, status: 'error' })
          }
          priority={model.imagePriority}
          referrerPolicy='no-referrer'
          sizes={model.imageSizes}
          src={model.imageSrc}
        />
      </>
    );
  }

  if (model.hasImageError) {
    return (
      <div
        role='img'
        aria-label={`${model.actualTitle} 海报暂不可用`}
        className='absolute inset-0 flex items-center justify-center bg-[rgb(var(--ui-surface-strong))] text-[rgb(var(--ui-text-muted))]'
      >
        <Film aria-hidden className='h-8 w-8' />
      </div>
    );
  }

  return (
    <Image
      alt={model.actualTitle}
      className='object-cover'
      fill
      loading={model.imageLoading}
      onLoad={() =>
        model.setImageState({ poster: model.actualPoster, status: 'loaded' })
      }
      onError={() =>
        model.setImageState({ poster: model.actualPoster, status: 'error' })
      }
      priority={model.imagePriority}
      referrerPolicy='no-referrer'
      sizes={model.imageSizes}
      src={model.imageSrc}
    />
  );
}

function VideoCardHitTarget({ model }: { model: VideoCardModel }) {
  return (
    <button
      data-tv-focus-key={model.posterFocusKey}
      data-tv-card-primary={model.posterCardPrimary}
      aria-label={model.posterActionLabel}
      aria-busy={model.showOpeningState}
      tabIndex={model.posterTabIndex}
      className='absolute inset-0 z-10 rounded-[inherit]'
      disabled={model.showOpeningState}
      onClick={model.handleClick}
      type='button'
    />
  );
}

function VideoCardPlayOverlay({ model }: { model: VideoCardModel }) {
  if (!model.showPlayOverlay) return null;
  return (
    <div className={model.playOverlayClass}>
      {model.showOpeningState ? (
        <span className='inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-3 py-2 text-xs font-medium text-white shadow-ui-soft backdrop-blur-md'>
          <Loader2 className='animate-spin' size={16} />
          正在打开
        </span>
      ) : (
        <PlayCircleIcon
          className='fill-black/50 text-white drop-shadow-md'
          size={model.playIconSize}
          strokeWidth={0.9}
        />
      )}
    </div>
  );
}

function VideoCardDoubanLink({ model }: { model: VideoCardModel }) {
  if (!model.showDoubanLink || !model.actualDoubanId) return null;
  return (
    <a
      aria-label='打开豆瓣页面'
      className={model.doubanLinkClass}
      href={`https://movie.douban.com/subject/${model.actualDoubanId}`}
      onClick={(event) => event.stopPropagation()}
      rel='noopener noreferrer'
      target='_blank'
    >
      <Link size={model.linkIconSize} />
    </a>
  );
}

function VideoCardBadges({ model }: { model: VideoCardModel }) {
  return (
    <div className='absolute right-3 top-3 z-20 flex flex-col items-end gap-2'>
      {model.showRating ? (
        <span
          className={`inline-flex items-center justify-center rounded-md bg-black/80 font-semibold text-amber-200 ${model.badgeSizeClass}`}
        >
          {model.rate}
        </span>
      ) : null}
      {model.showEpisodeBadge ? (
        <span
          className={`inline-flex items-center justify-center rounded-md bg-black/80 font-semibold text-white ${model.badgeSizeClass}`}
        >
          {model.episodeBadgeText}
        </span>
      ) : null}
    </div>
  );
}

function VideoCardFavoriteActions({ model }: { model: VideoCardModel }) {
  if (!model.showFavoriteBar) return null;
  return (
    <CardActions className={model.favoriteBarClass}>
      {model.showCheckCircle ? (
        <button
          aria-label='删除播放记录'
          className={model.iconButtonClass}
          onClick={model.handleDeleteRecord}
          type='button'
        >
          <CheckCircle size={model.smallIconSize} />
        </button>
      ) : null}
      {model.showHeartButton &&
      model.favoriteStorageKey &&
      model.actualSource &&
      model.actualId ? (
        <FavoriteHeartButton
          actualEpisodes={model.actualEpisodes}
          actualId={model.actualId}
          actualPoster={model.actualPoster}
          actualSource={model.actualSource}
          actualTitle={model.actualTitle}
          actualYear={model.actualYear}
          iconButtonClass={model.iconButtonClass}
          isSmall={model.isSmall}
          source_name={model.source_name}
          storageKey={model.favoriteStorageKey}
        />
      ) : null}
    </CardActions>
  );
}

function VideoCardPoster({ model }: { model: VideoCardModel }) {
  return (
    <Surface className={model.surfaceClass} variant='raised'>
      <div
        className={`relative ${model.aspectRatio} overflow-hidden rounded-[inherit]`}
        ref={model.posterRef}
      >
        <VideoCardImage model={model} />
        <VideoCardHitTarget model={model} />
        <VideoCardPlayOverlay model={model} />
        <VideoCardDoubanLink model={model} />
        <VideoCardBadges model={model} />
        <VideoCardFavoriteActions model={model} />
      </div>
    </Surface>
  );
}

function VideoCardProgress({ model }: { model: VideoCardModel }) {
  if (!model.showProgress) return null;
  return (
    <div className='ui-video-progress mt-3 h-1 w-full overflow-hidden rounded-full bg-[rgb(var(--ui-surface-strong))]'>
      <div
        className='h-full w-full origin-left rounded-full bg-[rgb(var(--ui-accent))] transition-transform duration-200 ease-out'
        style={{ transform: `scaleX(${model.progressScale})` }}
      />
    </div>
  );
}

function VideoCardTitle({ model }: { model: VideoCardModel }) {
  return (
    <button
      tabIndex={model.titleTabIndex}
      aria-label={model.titleActionLabel}
      className='ui-video-title w-full text-base font-semibold text-[rgb(var(--ui-text))] transition-colors duration-150 hover:text-[rgb(var(--ui-accent))]'
      disabled={model.showOpeningState}
      onClick={model.handleClick}
      title={model.actualTitle}
      type='button'
    >
      <span className='inline-flex min-w-0 items-center gap-1.5'>
        {model.showOpeningState ? (
          <Loader2 className='shrink-0 animate-spin' size={14} />
        ) : null}
        <span>{model.actualTitle}</span>
      </span>
    </button>
  );
}

function VideoCardSearchMeta({ model }: { model: VideoCardModel }) {
  if (!model.showSearchMeta) return null;
  return (
    <div className={model.searchMetaClass}>
      {model.typeName ? (
        <span className='inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-0.5'>
          {model.typeName}
        </span>
      ) : null}
      {model.displayYear ? <span>{model.displayYear}</span> : null}
      {model.statusText ? <span>{model.statusText}</span> : null}
    </div>
  );
}

function VideoCardLandscapeStatus({ model }: { model: VideoCardModel }) {
  if (!model.showLandscapeStatus) return null;
  return (
    <p className='mt-1 text-sm text-[rgb(var(--ui-text-muted))]'>
      {model.landscapeStatusText}
    </p>
  );
}

function VideoCardSourceChip({ model }: { model: VideoCardModel }) {
  if (!model.showSourceChip) return null;
  return (
    <span className={model.sourceChipClass}>
      <span className='inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 transition-colors duration-300 group-hover:border-[rgba(var(--ui-success),0.3)] group-hover:text-[rgb(var(--ui-success))]'>
        {model.source_name}
      </span>
    </span>
  );
}

function VideoCardResultPanel({ model }: { model: VideoCardModel }) {
  if (!model.isResult) return null;
  return (
    <>
      {model.showAggregateCount ? (
        <p className='mt-2 text-sm text-[rgb(var(--ui-text-muted))]'>
          {model.aggregateCountText}
        </p>
      ) : null}
      {model.showResultDescription ? (
        <p className='ui-search-description'>{model.resultDescription}</p>
      ) : null}
      <div className='mt-4 flex flex-wrap gap-2'>
        <button
          type='button'
          aria-label={`查看并播放 ${model.actualTitle}`}
          aria-busy={model.showOpeningState}
          disabled={model.showOpeningState}
          onClick={model.handleClick}
          data-tv-focus-key={`play:${model.playbackCardKey}`}
          data-tv-card-primary={model.tvCardPrimary}
          className='ui-primary-button'
        >
          {model.showOpeningState ? (
            <Loader2 aria-hidden className='h-4 w-4 animate-spin' />
          ) : (
            <Play aria-hidden className='h-4 w-4' />
          )}
          {model.primaryActionLabel}
        </button>
        {model.showAggregateToggle ? (
          <button
            type='button'
            aria-expanded={model.sourcesOpen}
            aria-controls={`sources-${model.playbackCardKey}`}
            onClick={() => model.setSourcesOpen(!model.sourcesOpen)}
            className='ui-secondary-button'
          >
            {model.sourcesToggleLabel}
          </button>
        ) : null}
      </div>
    </>
  );
}

function VideoCardContinue({ model }: { model: VideoCardModel }) {
  if (!model.showContinue) return null;
  return (
    <button
      type='button'
      aria-label={`继续播放 ${model.actualTitle}`}
      aria-busy={model.showOpeningState}
      disabled={model.showOpeningState}
      onClick={model.handleClick}
      data-tv-focus-key={`play:${model.playbackCardKey}`}
      data-tv-card-primary={model.tvCardPrimary}
      data-tv-primary={model.tvCardPrimary}
      className='mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-ui-sm bg-[rgb(var(--ui-accent))] px-4 py-2 text-sm font-semibold text-[rgb(var(--ui-on-accent))] transition-[filter] duration-150 hover:brightness-110 disabled:opacity-60'
    >
      {model.showOpeningState ? (
        <Loader2 aria-hidden className='h-4 w-4 animate-spin' />
      ) : (
        <Play aria-hidden className='h-4 w-4 fill-current' />
      )}
      {model.continueLabel}
    </button>
  );
}

function VideoCardMeta({ model }: { model: VideoCardModel }) {
  return (
    <div className={model.metaClass}>
      <VideoCardTitle model={model} />
      <VideoCardSearchMeta model={model} />
      <VideoCardLandscapeStatus model={model} />
      <VideoCardSourceChip model={model} />
      <VideoCardResultPanel model={model} />
      <VideoCardContinue model={model} />
    </div>
  );
}

function VideoCardSourceList({ model }: { model: VideoCardModel }) {
  if (!model.showSourceList) return null;
  return (
    <div className='ui-search-sources' id={`sources-${model.playbackCardKey}`}>
      {model.items?.map((item) => (
        <VideoCard
          key={`${item.source}:${item.id}`}
          from='search'
          layout='result'
          tvMode={model.tvMode}
          id={item.id}
          source={item.source}
          source_name={item.source_name}
          title={item.title}
          poster={item.poster}
          episodes={item.episodes.length}
          year={item.year}
          query={model.query}
          type={item.episodes.length > 1 ? 'tv' : 'movie'}
        />
      ))}
    </div>
  );
}

export default function VideoCard(props: VideoCardProps) {
  const model = useVideoCardModel(props);
  return (
    <article
      className={model.articleClass}
      data-playback-preparation-card={model.playbackCardKey}
    >
      <VideoCardPoster model={model} />
      <VideoCardProgress model={model} />
      <VideoCardMeta model={model} />
      <VideoCardSourceList model={model} />
    </article>
  );
}
