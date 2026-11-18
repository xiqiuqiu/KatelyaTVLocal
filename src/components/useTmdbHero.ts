'use client';

import { useEffect, useMemo, useState } from 'react';

import type { HomeRecommendation } from '@/lib/home-recommendations';
import { getHomeRecommendationKey } from '@/lib/home-recommendations';
import type { TmdbHeroEnrichment, TmdbHeroSeed } from '@/lib/tmdb/hero';

const STORAGE_PREFIX = 'reelfind:tmdb-hero:';

export interface TmdbHeroState {
  items: TmdbHeroEnrichment[];
  /** TMDB 未配置时为 false，首屏据此保持竖版海报布局 */
  enabled: boolean;
}

/**
 * 首屏补数据：一次请求拿回 5 部片的 backdrop / 简介 / 时长 / 类型。
 *
 * 结果按 sessionStorage 缓存，同一份推荐列表在本次会话里不会重复请求；
 * 服务端另有 24 小时边缘缓存。
 */
export default function useTmdbHero(
  recommendations: HomeRecommendation[]
): TmdbHeroState {
  const [state, setState] = useState<TmdbHeroState>({
    items: [],
    enabled: true,
  });

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

  useEffect(() => {
    if (seeds.length === 0) return;

    let cancelled = false;
    try {
      const cached = window.sessionStorage.getItem(cacheKey);
      if (cached) {
        setState(JSON.parse(cached) as TmdbHeroState);
        return;
      }
    } catch {
      /* sessionStorage 不可用（隐私模式）时继续走网络 */
    }

    // jsdom 等没有 fetch 的环境直接跳过补数据，保持竖版海报布局
    if (typeof globalThis.fetch !== 'function') return;

    const url = `/api/tmdb/hero?items=${encodeURIComponent(
      JSON.stringify(seeds)
    )}`;

    void fetch(url)
      .then(async (response) => {
        if (!response.ok) return { items: [], enabled: false };
        const payload = (await response.json()) as Partial<TmdbHeroState>;
        return {
          items: Array.isArray(payload.items) ? payload.items : [],
          enabled: payload.enabled !== false,
        };
      })
      .then((next) => {
        if (cancelled) return;
        setState(next);
        try {
          window.sessionStorage.setItem(cacheKey, JSON.stringify(next));
        } catch {
          /* 缓存失败不影响展示 */
        }
      })
      .catch(() => {
        if (!cancelled) setState({ items: [], enabled: false });
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, seeds]);

  return state;
}
