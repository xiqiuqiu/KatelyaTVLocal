import type { TmdbMediaKind, TmdbSearchResult } from '@/lib/tmdb/matching';
import { pickTmdbMatch } from '@/lib/tmdb/matching';

export interface TmdbHeroSeed {
  title: string;
  year?: string;
  kind: 'movie' | 'tv' | 'show';
}

export interface TmdbHeroEnrichment {
  title: string;
  matched: boolean;
  tmdbId?: number;
  media?: TmdbMediaKind;
  backdropPath?: string | null;
  overview?: string;
  runtime?: number | null;
  genres?: string[];
  vote?: number;
}

/** 一次最多补 6 条，避免代理被当成批量查询工具。 */
export const TMDB_HERO_LIMIT = 6;

/** 详情里我们要的字段，别的字段不透传，避免响应过大。 */
export interface TmdbDetailShape {
  id?: number;
  backdrop_path?: string | null;
  overview?: string;
  runtime?: number | null;
  episode_run_time?: number[];
  genres?: Array<{ name?: string }>;
  vote_average?: number;
}

export type TmdbJsonFetcher = (
  path: string,
  params?: Record<string, string>
) => Promise<unknown>;

function toMedia(kind: TmdbHeroSeed['kind']): TmdbMediaKind {
  return kind === 'movie' ? 'movie' : 'tv';
}

function readResultList(payload: unknown): TmdbSearchResult[] {
  const value = payload as { results?: unknown } | null;
  const results = value?.results;
  return Array.isArray(results) ? (results as TmdbSearchResult[]) : [];
}

/**
 * 首屏补数据：给每部片补 backdrop / 简介 / 时长 / 类型。
 *
 * - 匹配不到就返回 `matched: false`，调用方回退到竖版海报布局
 * - 单条失败不影响其它条目（首屏不能因为一部片查不到就整体降级）
 * - 按输入顺序返回，调用方可直接用下标对应
 */
export async function enrichTmdbHero(
  seeds: TmdbHeroSeed[],
  fetchJson: TmdbJsonFetcher
): Promise<TmdbHeroEnrichment[]> {
  const limited = seeds.slice(0, TMDB_HERO_LIMIT);

  const settled = await Promise.all(
    limited.map(async (seed): Promise<TmdbHeroEnrichment> => {
      const media = toMedia(seed.kind);
      const base: TmdbHeroEnrichment = {
        title: seed.title,
        matched: false,
      };
      if (!seed.title?.trim()) return base;

      try {
        const params: Record<string, string> = { query: seed.title };
        if (seed.year) {
          if (media === 'movie') params.year = seed.year;
          else params.first_air_date_year = seed.year;
        }
        const searchPayload = await fetchJson(`search/${media}`, params);
        const match = pickTmdbMatch(
          { title: seed.title, year: seed.year, kind: media },
          readResultList(searchPayload)
        );
        if (!match) return base;

        const detail = ((await fetchJson(`${media}/${match.result.id}`)) ??
          {}) as TmdbDetailShape;

        const runtimeList = Array.isArray(detail.episode_run_time)
          ? detail.episode_run_time
          : [];
        const runtime = detail.runtime ?? runtimeList[0] ?? null;

        return {
          title: seed.title,
          matched: true,
          tmdbId: match.result.id,
          media,
          backdropPath:
            detail.backdrop_path ?? match.result.backdrop_path ?? null,
          overview: detail.overview || match.result.overview || '',
          runtime: runtime ?? null,
          genres: (detail.genres ?? [])
            .map((genre) => genre.name || '')
            .filter(Boolean),
          vote: detail.vote_average ?? match.result.vote_average,
        };
      } catch {
        return base;
      }
    })
  );

  return settled;
}

/** 解析 `items` 查询串，做形状与长度校验。 */
export function parseTmdbHeroSeeds(raw: string | null): TmdbHeroSeed[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seeds: TmdbHeroSeed[] = [];
  for (const entry of parsed.slice(0, TMDB_HERO_LIMIT)) {
    const value = entry as Partial<TmdbHeroSeed> | null;
    const title = typeof value?.title === 'string' ? value.title.trim() : '';
    if (!title) continue;
    const kind =
      value?.kind === 'movie' || value?.kind === 'tv' || value?.kind === 'show'
        ? value.kind
        : 'movie';
    const year =
      typeof value?.year === 'string' && /^\d{4}$/.test(value.year)
        ? value.year
        : undefined;
    seeds.push({ title: title.slice(0, 120), year, kind });
  }
  return seeds;
}
