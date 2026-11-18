import type { DoubanItem } from '@/lib/types';

export type HomeRecommendationType = 'movie' | 'tv' | 'show';

/** 用来做本地打分的个人信号，只需标题与集数，不涉及任何网络请求。 */
export interface HomeRecommendationSignal {
  title: string;
  episodes?: number;
  category?: HomeRecommendationType | '';
}

export interface HomeRecommendation {
  item: DoubanItem;
  type: HomeRecommendationType;
  /** 展示给用户的一句话理由，例如「豆瓣 9.4 · 你常看剧集」 */
  reason: string;
  score: number;
}

export interface BuildHomeRecommendationsInput {
  movies: DoubanItem[];
  tvShows?: DoubanItem[];
  varietyShows?: DoubanItem[];
  /** 播放历史片段；只用于本地打分，不会离开浏览器 */
  playRecords?: HomeRecommendationSignal[];
  favorites?: HomeRecommendationSignal[];
  limit?: number;
}

const TYPE_LABELS: Record<HomeRecommendationType, string> = {
  movie: '电影',
  tv: '剧集',
  show: '综艺',
};

/** 同一类型最多占几张，避免 5 张全是剧集。 */
const MAX_PER_TYPE = 3;

function normalizeTitle(title: string | undefined): string {
  return (title || '').trim().toLowerCase();
}

function parseRate(rate: string | undefined): number {
  const value = Number.parseFloat(rate || '');
  return Number.isFinite(value) ? value : 0;
}

function inferSignalType(
  signal: HomeRecommendationSignal
): HomeRecommendationType {
  if (
    signal.category === 'movie' ||
    signal.category === 'tv' ||
    signal.category === 'show'
  ) {
    return signal.category;
  }
  return (signal.episodes ?? 0) > 1 ? 'tv' : 'movie';
}

function describeReason(input: {
  type: HomeRecommendationType;
  rate: number;
  affinity: number;
  hasSignals: boolean;
}): string {
  const label = TYPE_LABELS[input.type];
  const familiar = input.hasSignals && input.affinity >= 0.5;

  // 评分已经在标题行单独显示，这里只说「为什么排在你面前」
  if (familiar) return `你常看${label} · 优先推荐`;
  if (input.rate >= 8.5) return '本周口碑高分';
  return `本周${label}热榜`;
}

/**
 * 首屏推荐：从豆瓣热榜里挑 3–5 张，顺序按「评分 + 个人类型偏好」排。
 *
 * - 纯本地计算：只用播放历史与收藏的标题/集数，不发任何请求
 * - 已经看过或收藏过的片不再推荐
 * - 同类型最多 3 张，保证首屏有变化
 * - 候选不足时按评分顺序补位；完全没数据时返回空数组
 */
export function buildHomeRecommendations(
  input: BuildHomeRecommendationsInput
): HomeRecommendation[] {
  const limit = input.limit ?? 5;
  const signals = [...(input.playRecords ?? []), ...(input.favorites ?? [])];
  const seen = new Set(
    signals.map((signal) => normalizeTitle(signal.title)).filter(Boolean)
  );

  const typeCounts: Record<HomeRecommendationType, number> = {
    movie: 0,
    tv: 0,
    show: 0,
  };
  for (const signal of signals) {
    typeCounts[inferSignalType(signal)] += 1;
  }
  const hasSignals = signals.length > 0;

  const pool: Array<{
    item: DoubanItem;
    type: HomeRecommendationType;
    order: number;
  }> = [];
  const push = (items: DoubanItem[], type: HomeRecommendationType) => {
    items.forEach((item, index) => {
      if (!item.poster?.trim()) return;
      if (seen.has(normalizeTitle(item.title))) return;
      pool.push({ item, type, order: index });
    });
  };
  push(input.movies, 'movie');
  push(input.tvShows ?? [], 'tv');
  push(input.varietyShows ?? [], 'show');

  const scored = pool.map((candidate) => {
    const rate = parseRate(candidate.item.rate);
    const affinity = hasSignals
      ? typeCounts[candidate.type] / signals.length
      : 0;
    return {
      ...candidate,
      rate,
      affinity,
      // 评分是主项，个人偏好最多加权 4 分，不会盖过 9 分以上的好片
      score: Number((rate + affinity * 4).toFixed(3)),
    };
  });

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.order - b.order ||
      a.item.title.localeCompare(b.item.title)
  );

  const picked: typeof scored = [];
  const pickedPerType: Record<HomeRecommendationType, number> = {
    movie: 0,
    tv: 0,
    show: 0,
  };
  for (const candidate of scored) {
    if (picked.length >= limit) break;
    if (pickedPerType[candidate.type] >= MAX_PER_TYPE) continue;
    pickedPerType[candidate.type] += 1;
    picked.push(candidate);
  }
  if (picked.length < limit) {
    for (const candidate of scored) {
      if (picked.length >= limit) break;
      if (picked.includes(candidate)) continue;
      picked.push(candidate);
    }
  }

  return picked.map((candidate) => ({
    item: candidate.item,
    type: candidate.type,
    reason: describeReason({
      type: candidate.type,
      rate: candidate.rate,
      affinity: candidate.affinity,
      hasSignals,
    }),
    score: candidate.score,
  }));
}

/** 推荐的稳定标识，用于 React key 与「推荐列表是否变化」判断。 */
export function getHomeRecommendationKey(
  recommendation: HomeRecommendation
): string {
  return `${recommendation.type}:${
    recommendation.item.id || recommendation.item.title
  }`;
}
