import type { DoubanItem } from '@/lib/types';

export type TopRatedType = 'movie' | 'tv' | 'show';

export interface TopRatedEntry {
  item: DoubanItem;
  type: TopRatedType;
  rank: number;
}

export interface BuildTopRatedInput {
  movies: DoubanItem[];
  tvShows?: DoubanItem[];
  varietyShows?: DoubanItem[];
  limit?: number;
}

function parseRate(rate: string | undefined): number {
  const value = Number.parseFloat(rate || '');
  return Number.isFinite(value) ? value : 0;
}

function normalizeTitle(title: string | undefined): string {
  return (title || '').trim().toLowerCase();
}

/**
 * 「豆瓣高分 Top N」：把三个榜单合池，按评分从高到低取前 N。
 *
 * 说明：这是**评分榜**，不是播放量榜——我们没有真实观看数据，
 * 所以文案必须写「豆瓣高分」，不能写「今日热播」。
 */
export function buildTopRated(input: BuildTopRatedInput): TopRatedEntry[] {
  const limit = input.limit ?? 10;
  const pool: Array<{ item: DoubanItem; type: TopRatedType; order: number }> =
    [];
  const seen = new Set<string>();

  const push = (items: DoubanItem[], type: TopRatedType) => {
    items.forEach((item, index) => {
      const key = normalizeTitle(item.title);
      if (!key || !item.poster?.trim() || seen.has(key)) return;
      // 没有评分的条目不进榜，否则会出现 0 分排在榜尾的怪现象
      if (parseRate(item.rate) <= 0) return;
      seen.add(key);
      pool.push({ item, type, order: index });
    });
  };

  push(input.movies, 'movie');
  push(input.tvShows ?? [], 'tv');
  push(input.varietyShows ?? [], 'show');

  pool.sort(
    (a, b) =>
      parseRate(b.item.rate) - parseRate(a.item.rate) ||
      a.order - b.order ||
      a.item.title.localeCompare(b.item.title)
  );

  return pool.slice(0, limit).map((entry, index) => ({
    item: entry.item,
    type: entry.type,
    rank: index + 1,
  }));
}

export function getTopRatedKey(entry: TopRatedEntry): string {
  return `${entry.type}:${entry.item.id || entry.item.title}`;
}
