import type { SearchResult } from '@/lib/types';

const NOISY_TITLE_PATTERNS = [
  '电影解说',
  '解说',
  '国语版',
  '国语',
  '粤语版',
  '粤语',
  '剧场版',
  '预告片',
  '预告',
  '短剧',
  '番外',
  '特典',
  '抢先',
  '花絮',
];

const MOVIE_QUERY_PATTERNS = ['电影', '剧场版', 'movie'];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/[·・:：\-_[\]【】()（）]/g, '');
}

function parseYearValue(year: string): number {
  const parsed = Number.parseInt(year, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getSearchResultNoiseScore(item: SearchResult): number {
  const title = normalizeText(item.title);
  const className = normalizeText(item.class || '');
  const typeName = normalizeText(item.type_name || '');
  const searchableText = `${title}${className}${typeName}`;

  return NOISY_TITLE_PATTERNS.reduce((score, pattern) => {
    return searchableText.includes(normalizeText(pattern)) ? score + 1 : score;
  }, 0);
}

export function getSearchResultRankingScore(
  query: string,
  item: SearchResult
): number {
  const normalizedQuery = normalizeText(query);
  const normalizedTitle = normalizeText(item.title);
  const queryAsksForMovie = MOVIE_QUERY_PATTERNS.some((pattern) =>
    normalizedQuery.includes(normalizeText(pattern))
  );
  const noiseScore = getSearchResultNoiseScore(item);
  const episodeCount = item.episodes.length;

  let score = 0;

  if (normalizedTitle === normalizedQuery) {
    score += 160;
  } else if (normalizedTitle.startsWith(normalizedQuery)) {
    score += 80;
  } else if (normalizedTitle.includes(normalizedQuery)) {
    score += 45;
  }

  if (episodeCount >= 20) {
    score += 56;
  } else if (episodeCount >= 12) {
    score += 42;
  } else if (episodeCount >= 2) {
    score += 18;
  }

  if (item.douban_id && item.douban_id > 0) {
    score += 22;
  }

  if (!queryAsksForMovie) {
    score -= noiseScore * 42;
  }

  score += Math.min(parseYearValue(item.year) / 100, 30);

  return score;
}

export function sortSearchResultsByRanking(
  query: string,
  results: SearchResult[]
): SearchResult[] {
  return results
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const scoreDiff =
        getSearchResultRankingScore(query, b.item) -
        getSearchResultRankingScore(query, a.item);
      if (scoreDiff !== 0) return scoreDiff;

      const yearDiff =
        parseYearValue(b.item.year) - parseYearValue(a.item.year);
      if (yearDiff !== 0) return yearDiff;

      const titleDiff = a.item.title.localeCompare(b.item.title);
      if (titleDiff !== 0) return titleDiff;

      return a.index - b.index;
    })
    .map(({ item }) => item);
}

export function getSearchResultGroupRankingScore(
  query: string,
  group: SearchResult[]
): number {
  if (group.length === 0) return Number.NEGATIVE_INFINITY;

  const bestItemScore = Math.max(
    ...group.map((item) => getSearchResultRankingScore(query, item))
  );
  const maxEpisodeCount = Math.max(
    ...group.map((item) => item.episodes.length)
  );
  const validDoubanIdCount = group.filter(
    (item) => item.douban_id && item.douban_id > 0
  ).length;
  const groupSourceBonus = Math.min(group.length, 8) * 3;

  return (
    bestItemScore +
    Math.min(maxEpisodeCount, 60) * 0.5 +
    validDoubanIdCount * 4 +
    groupSourceBonus
  );
}

export function sortSearchResultGroupsByRanking(
  query: string,
  groups: Array<[string, SearchResult[]]>
): Array<[string, SearchResult[]]> {
  return groups
    .map(([key, group], index) => ({ key, group, index }))
    .sort((a, b) => {
      const scoreDiff =
        getSearchResultGroupRankingScore(query, b.group) -
        getSearchResultGroupRankingScore(query, a.group);
      if (scoreDiff !== 0) return scoreDiff;

      return a.index - b.index;
    })
    .map(({ key, group }) => [key, sortSearchResultsByRanking(query, group)]);
}

export function shouldSuggestAiFind(
  query: string,
  results: SearchResult[]
): boolean {
  if (!query.trim() || results.length === 0) return false;

  if (results.length > 30) {
    return true;
  }

  const noisyCount = results.filter(
    (item) => getSearchResultNoiseScore(item) > 0
  ).length;

  return results.length >= 12 && noisyCount / results.length >= 0.35;
}
