import type { DoubanItem } from '@/lib/types';

/** TMDB 图片 CDN，国内访问不稳，实际使用时要走 /api/image-proxy。 */
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export type TmdbImageSize =
  | 'w92'
  | 'w154'
  | 'w185'
  | 'w300'
  | 'w342'
  | 'w500'
  | 'w780'
  | 'w1280'
  | 'original';

export type TmdbMediaKind = 'movie' | 'tv';

/** 我们关心的最小字段集：列表页够用，详情页再取更多。 */
export interface TmdbSearchResult {
  id: number;
  media_type?: TmdbMediaKind;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  genre_ids?: number[];
}

export interface TmdbTitleMatch {
  result: TmdbSearchResult;
  /** 0–1，越低越不可信；低于阈值时调用方应回退到无 TMDB 的展示 */
  confidence: number;
  year: number | null;
}

export interface TmdbMatchInput {
  title: string;
  year?: string | number;
  kind?: TmdbMediaKind;
}

/** 标题归一化：去掉空白、标点、括号内容与常见后缀，便于跨库比对。 */
export function normalizeTmdbTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/[（(【[][^）)】\]]*[）)】\]]/g, '')
    .replace(/[\s·・:：\-—_~!！?？,，.。'""'']/g, '')
    .replace(
      /(第[一二三四五六七八九十0-9]+季|season\s*\d+|第[一二三四五六七八九十0-9]+部)$/,
      ''
    )
    .trim();
}

function parseYear(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 1900 ? parsed : null;
}

function resultTitle(result: TmdbSearchResult): string {
  return (
    result.title ||
    result.name ||
    result.original_title ||
    result.original_name ||
    ''
  );
}

function resultYear(result: TmdbSearchResult): number | null {
  return parseYear(result.release_date || result.first_air_date);
}

/**
 * 从 TMDB 搜索结果里挑最可信的一条。
 *
 * 我们的片源标题多是中文，TMDB 返回 `title` 与 `original_title` 可能分别是
 * 中文名与原名，两边都要参与比较；年份相差超过 1 年视为不匹配。
 */
export function pickTmdbMatch(
  input: TmdbMatchInput,
  results: TmdbSearchResult[]
): TmdbTitleMatch | null {
  const targetTitle = normalizeTmdbTitle(input.title);
  if (!targetTitle) return null;

  const targetYear = parseYear(input.year);
  let best: TmdbTitleMatch | null = null;

  for (const result of results) {
    const candidates = [
      normalizeTmdbTitle(resultTitle(result)),
      normalizeTmdbTitle(result.original_title || ''),
      normalizeTmdbTitle(result.original_name || ''),
    ].filter(Boolean);
    if (candidates.length === 0) continue;

    const exact = candidates.some((candidate) => candidate === targetTitle);
    const startsWith = candidates.some(
      (candidate) =>
        candidate.startsWith(targetTitle) || targetTitle.startsWith(candidate)
    );
    if (!exact && !startsWith) continue;

    const year = resultYear(result);
    let yearPenalty = 0;
    if (targetYear !== null && year !== null) {
      const delta = Math.abs(year - targetYear);
      if (delta > 1) continue;
      yearPenalty = delta === 0 ? 0 : 0.15;
    } else {
      // 一边缺年份时降低可信度，但不要直接排除
      yearPenalty = 0.2;
    }

    const titlePenalty = exact ? 0 : 0.25;
    const confidence = Math.max(0, Math.min(1, 1 - titlePenalty - yearPenalty));

    if (!best || confidence > best.confidence) {
      best = { result, confidence, year };
    }
  }

  return best;
}

export function buildTmdbImageUrl(
  path: string | null | undefined,
  size: TmdbImageSize = 'w780'
): string {
  if (!path) return '';
  return `${TMDB_IMAGE_BASE}/${size}${
    path.startsWith('/') ? path : `/${path}`
  }`;
}

/** 把豆瓣条目转成匹配入参，便于把现有数据直接喂给 TMDB。 */
export function toTmdbMatchInput(
  item: Pick<DoubanItem, 'title' | 'year'>,
  kind: TmdbMediaKind = 'movie'
): TmdbMatchInput {
  return { title: item.title, year: item.year, kind };
}
