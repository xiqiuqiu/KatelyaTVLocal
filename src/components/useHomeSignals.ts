'use client';

import { useEffect, useState } from 'react';

import type { Favorite, PlayRecord } from '@/lib/db.client';
import {
  getAllFavorites,
  getRecentPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import type { HomeRecommendationSignal } from '@/lib/home-recommendations';

const SIGNAL_RECORD_LIMIT = 50;

export interface HomeSignals {
  playRecords: HomeRecommendationSignal[];
  favorites: HomeRecommendationSignal[];
  /** 数据还没到齐时为 true，首屏据此决定是否显示骨架 */
  loading: boolean;
}

function toRecordSignals(
  records: Record<string, PlayRecord>
): HomeRecommendationSignal[] {
  return Object.values(records).map((record) => ({
    title: record.title || record.search_title || '',
    episodes: record.total_episodes,
  }));
}

function toFavoriteSignals(
  favorites: Record<string, Favorite>
): HomeRecommendationSignal[] {
  return Object.values(favorites).map((favorite) => ({
    title: favorite.title || favorite.search_title || '',
    episodes: favorite.total_episodes,
  }));
}

/**
 * 首屏推荐只需要「看过什么 / 收藏过什么」两类本地信号。
 * 全部在浏览器本地读取与计算，不上报服务器。
 */
export default function useHomeSignals(): HomeSignals {
  const [playRecords, setPlayRecords] = useState<HomeRecommendationSignal[]>(
    []
  );
  const [favorites, setFavorites] = useState<HomeRecommendationSignal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [records, favoriteMap] = await Promise.all([
          getRecentPlayRecords(SIGNAL_RECORD_LIMIT),
          getAllFavorites(),
        ]);
        if (cancelled) return;
        setPlayRecords(toRecordSignals(records));
        setFavorites(toFavoriteSignals(favoriteMap));
      } catch {
        // 读取失败时退回「只看热榜」，首屏仍然可用
        if (cancelled) return;
        setPlayRecords([]);
        setFavorites([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    const unsubscribeRecords = subscribeToDataUpdates(
      'playRecordsUpdated',
      (records: Record<string, PlayRecord>) => {
        setPlayRecords(toRecordSignals(records));
      }
    );
    const unsubscribeFavorites = subscribeToDataUpdates(
      'favoritesUpdated',
      (favoriteMap: Record<string, Favorite>) => {
        setFavorites(toFavoriteSignals(favoriteMap));
      }
    );

    return () => {
      cancelled = true;
      unsubscribeRecords();
      unsubscribeFavorites();
    };
  }, []);

  return { playRecords, favorites, loading };
}
