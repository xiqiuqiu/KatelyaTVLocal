import type { SearchResult } from '@/lib/types';

export type SearchCategory = 'all' | 'movie' | 'tv' | 'variety';

export type SearchCategoryTab = {
  value: SearchCategory;
  label: string;
  count: number;
};

export type SearchCardMeta = {
  typeChip?: string;
  year?: string;
  statusText?: string;
};

const VARIETY_PATTERNS = [
  '综艺',
  '真人秀',
  '晚会',
  '脱口秀',
  'variety',
  'reality',
];

const MOVIE_PATTERNS = ['电影', '影片', '剧场版', 'movie', 'film'];

const TV_PATTERNS = [
  '电视剧',
  '连续剧',
  '国产剧',
  '港剧',
  '台剧',
  '日剧',
  '韩剧',
  '美剧',
  '剧集',
  '动漫',
  '动画',
  '纪录片',
  '短剧',
  'series',
  'tv',
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/[·・:：\-_[\]【】()（）]/g, '');
}

function matchesAny(haystack: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    haystack.includes(normalizeText(pattern))
  );
}

/**
 * Client-side category for Design Direction search tabs.
 * Prefers type_name / class keywords; falls back to episode-count cues.
 * Does not inspect title — avoids misclassifying by name keywords.
 */
export function classifySearchResult(
  item: Pick<SearchResult, 'class' | 'type_name' | 'episodes'>
): Exclude<SearchCategory, 'all'> {
  const haystack = normalizeText(
    `${item.type_name || ''} ${item.class || ''}`
  );

  if (matchesAny(haystack, VARIETY_PATTERNS)) return 'variety';
  if (matchesAny(haystack, MOVIE_PATTERNS)) return 'movie';
  if (matchesAny(haystack, TV_PATTERNS)) return 'tv';

  return item.episodes.length <= 1 ? 'movie' : 'tv';
}

export function filterSearchResultsByCategory<T extends SearchResult>(
  results: T[],
  category: SearchCategory
): T[] {
  if (category === 'all') return results;
  return results.filter((item) => classifySearchResult(item) === category);
}

export function buildSearchCategoryTabs(
  results: SearchResult[]
): SearchCategoryTab[] {
  const counts: Record<Exclude<SearchCategory, 'all'>, number> = {
    movie: 0,
    tv: 0,
    variety: 0,
  };

  for (const item of results) {
    counts[classifySearchResult(item)] += 1;
  }

  return [
    { value: 'all', label: '全部', count: results.length },
    { value: 'movie', label: '电影', count: counts.movie },
    { value: 'tv', label: '剧集', count: counts.tv },
    { value: 'variety', label: '综艺', count: counts.variety },
  ];
}

/** Rich-card copy from already-available SearchResult fields only. */
export function getSearchCardMeta(
  item: Pick<SearchResult, 'type_name' | 'class' | 'year' | 'episodes'>
): SearchCardMeta {
  const typeChip = (item.type_name || item.class || '').trim() || undefined;
  const year =
    item.year?.trim() && item.year !== 'unknown' ? item.year : undefined;
  const episodeCount = item.episodes?.length ?? 0;
  // Only surface an episode cue when there is more than one episode; do not
  // invent "电影" when type_name/class already carry the label (or are absent).
  const statusText = episodeCount > 1 ? `共${episodeCount}集` : undefined;

  return { typeChip, year, statusText };
}
