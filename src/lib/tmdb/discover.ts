export type DiscoverMedia = 'movie' | 'tv';

export interface DiscoverFilters {
  media: DiscoverMedia;
  /** TMDB genre id 列表，空数组表示不限 */
  genres: number[];
  /** 年份区间，null 表示不限 */
  yearRange: string | null;
  /** 评分下限，null 表示不限 */
  minRating: number | null;
  /** 原始语言，null 表示不限 */
  language: string | null;
  sortBy: string;
}

export interface TmdbDiscoverItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  poster_path?: string | null;
  overview?: string;
}

/** 年份档位：用区间而不是逐年列，筛选条才不会爆炸。 */
export const YEAR_OPTIONS: Array<{
  key: string;
  label: string;
  gte: string;
  lte: string;
}> = [
  { key: '2020s', label: '2020 年代', gte: '2020-01-01', lte: '2029-12-31' },
  { key: '2010s', label: '2010 年代', gte: '2010-01-01', lte: '2019-12-31' },
  { key: '2000s', label: '2000 年代', gte: '2000-01-01', lte: '2009-12-31' },
  { key: 'older', label: '更早', gte: '1950-01-01', lte: '1999-12-31' },
];

export const RATING_OPTIONS: Array<{
  key: string;
  label: string;
  value: number;
}> = [
  { key: '7', label: '7 分以上', value: 7 },
  { key: '8', label: '8 分以上', value: 8 },
  { key: '9', label: '9 分以上', value: 9 },
];

export const LANGUAGE_OPTIONS: Array<{
  key: string;
  label: string;
  value: string;
}> = [
  { key: 'zh', label: '华语', value: 'zh' },
  { key: 'en', label: '英语', value: 'en' },
  { key: 'ja', label: '日语', value: 'ja' },
  { key: 'ko', label: '韩语', value: 'ko' },
];

export const SORT_OPTIONS: Array<{
  key: string;
  label: string;
  value: string;
}> = [
  { key: 'popularity', label: '人气', value: 'popularity.desc' },
  { key: 'vote', label: '评分', value: 'vote_average.desc' },
  { key: 'newest', label: '最新', value: 'primary_release_date.desc' },
];

/** 评分排序必须带票数下限，否则会出现 10 分 3 人评的冷门片。 */
const VOTE_COUNT_FLOOR = 200;

export function createDefaultFilters(
  media: DiscoverMedia = 'movie'
): DiscoverFilters {
  return {
    media,
    genres: [],
    yearRange: null,
    minRating: null,
    language: null,
    sortBy: 'popularity.desc',
  };
}

/** 把筛选状态翻译成 TMDB discover 的查询参数。 */
export function buildDiscoverParams(
  filters: DiscoverFilters,
  page: number
): Record<string, string> {
  const params: Record<string, string> = {
    page: String(Math.max(1, page)),
    sort_by: filters.sortBy,
    language: 'zh-CN',
  };

  if (filters.genres.length > 0) {
    params.with_genres = filters.genres.join(',');
  }

  if (filters.yearRange) {
    const range = YEAR_OPTIONS.find(
      (option) => option.key === filters.yearRange
    );
    if (range) {
      const gteKey =
        filters.media === 'movie'
          ? 'primary_release_date.gte'
          : 'first_air_date.gte';
      const lteKey =
        filters.media === 'movie'
          ? 'primary_release_date.lte'
          : 'first_air_date.lte';
      params[gteKey] = range.gte;
      params[lteKey] = range.lte;
      // 显式带区间时不要再传单一 year，TMDB 会以 year 为准
    }
  }

  if (filters.minRating) {
    params['vote_average.gte'] = String(filters.minRating);
    params['vote_count.gte'] = String(VOTE_COUNT_FLOOR);
  }

  if (filters.language) {
    params.with_original_language = filters.language;
  }

  return params;
}

/** TMDB 结果 → 卡片需要的字段；标题与年份都要兼容 movie / tv 两套命名。 */
export function mapDiscoverItem(item: TmdbDiscoverItem): {
  id: string;
  title: string;
  year: string;
  rate: string;
  posterPath: string;
  /** 原名，用来在播放页搜不到时再试一次 */
  originalTitle: string;
} {
  const title = item.title || item.name || '';
  const date = item.release_date || item.first_air_date || '';
  const year = date.slice(0, 4);
  const rate =
    typeof item.vote_average === 'number' && item.vote_average > 0
      ? item.vote_average.toFixed(1)
      : '';

  const originalTitle = item.original_title || item.original_name || '';
  return {
    id: String(item.id),
    title,
    year,
    rate,
    posterPath: item.poster_path || '',
    originalTitle: originalTitle !== title ? originalTitle : '',
  };
}

/** 筛选条件是否等于默认值，用于决定要不要显示「重置」。 */
export function hasActiveFilters(filters: DiscoverFilters): boolean {
  const isDefaultSort =
    filters.sortBy === createDefaultFilters(filters.media).sortBy;
  return (
    filters.genres.length > 0 ||
    filters.yearRange !== null ||
    filters.minRating !== null ||
    filters.language !== null ||
    !isDefaultSort
  );
}
