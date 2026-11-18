'use client';

import { useEffect, useMemo, useState } from 'react';

import type { HomeRecommendation } from '@/lib/home-recommendations';
import { getHomeRecommendationKey } from '@/lib/home-recommendations';
import type { TmdbHeroEnrichment, TmdbHeroSeed } from '@/lib/tmdb/hero';

const STORAGE_PREFIX = 'reelfind:tmdb-hero:';

interface ResolvedState {
  /** 这份结果对应的推荐列表 key；与当前 key 不一致即视为「还没有结果」 */
  key: string;
  items: TmdbHeroEnrichment[];
  enabled: boolean;
}

export interface TmdbHeroState {
  items: TmdbHeroEnrichment[];
  /** TMDB 未配置时为 false，可用豆瓣海报兜底 */
  enabled: boolean;
  /** 当前推荐列表还没有结果：首屏用骨架占位，避免「先分栏再闪成横图」 */
  pending: boolean;
}

function readCache(
  key: string
): { items: TmdbHeroEnrichment[]; enabled: boolean } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      items?: TmdbHeroEnrichment[];
      enabled?: boolean;
    };
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      enabled: parsed.enabled !== false,
    };
  } catch {
    return null;
  }
}

function writeCache(
  key: string,
  value: { items: TmdbHeroEnrichment[]; enabled: boolean }
) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式下写入失败不影响展示 */
  }
}

/**
 * 首屏补数据：一次请求拿回 5 部片的 backdrop / 简介 / 时长 / 类型。
 *
 * 关键点：`pending` 是**渲染期推导**出来的（当前列表 key ≠ 结果 key），
 * 而不是在 effect 里手动置位。否则推荐列表一变，就会先用上一份结果
 * 渲染一帧（正是「骨架 → 分栏 → 横图」里中间那一跳的来源）。
 */
export default function useTmdbHero(
  recommendations: HomeRecommendation[]
): TmdbHeroState {
  const seeds = useMemo<TmdbHeroSeed[]>(
    () =>
      recommendations.slice(0, 6).map((recommendation) => ({
        title: recommendation.item.title,
        year: recommendation.item.year,
        kind: recommendation.type,
      })),
    [recommendations]
  );

  const cacheKey = useMemo(
    () =>
      `${STORAGE_PREFIX}${recommendations
        .map(getHomeRecommendationKey)
        .join('|')}`,
    [recommendations]
  );

  const [resolved, setResolved] = useState<ResolvedState>(() => {
    const cached = readCache(cacheKey);
    return cached
      ? { key: cacheKey, items: cached.items, enabled: cached.enabled }
      : { key: '', items: [], enabled: true };
  });

  useEffect(() => {
    let cancelled = false;

    const finish = (value: {
      items: TmdbHeroEnrichment[];
      enabled: boolean;
    }) => {
      if (cancelled) return;
      setResolved({ key: cacheKey, ...value });
      writeCache(cacheKey, value);
    };

    if (seeds.length === 0) {
      finish({ items: [], enabled: true });
      return () => {
        cancelled = true;
      };
    }

    const cached = readCache(cacheKey);
    if (cached) {
      finish(cached);
      return () => {
        cancelled = true;
      };
    }

    // jsdom 等没有 fetch 的环境直接结束占位，使用豆瓣海报
    if (typeof globalThis.fetch !== 'function') {
      finish({ items: [], enabled: false });
      return () => {
        cancelled = true;
      };
    }

    const url = `/api/tmdb/hero?items=${encodeURIComponent(
      JSON.stringify(seeds)
    )}`;

    const request = async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`tmdb hero ${response.status}`);
      const payload = (await response.json()) as {
        items?: unknown;
        enabled?: boolean;
      };
      return {
        items: Array.isArray(payload.items)
          ? (payload.items as TmdbHeroEnrichment[])
          : [],
        enabled: payload.enabled !== false,
      };
    };

    // 偶发失败重试一次，尽量保留横图
    void request()
      .catch(() =>
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error('retry')), 600)
        ).then(request)
      )
      .then(finish)
      .catch(() => finish({ items: [], enabled: false }));

    return () => {
      cancelled = true;
    };
  }, [cacheKey, seeds]);

  const isCurrent = resolved.key === cacheKey;

  return {
    items: isCurrent ? resolved.items : [],
    enabled: resolved.enabled,
    pending: !isCurrent,
  };
}
