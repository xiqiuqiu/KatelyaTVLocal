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

interface SignalData {
  playRecords: HomeRecommendationSignal[];
  favorites: HomeRecommendationSignal[];
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
 *
 * 两类信号放在**同一个 state** 里一次性写入：分成两个 state 会让首屏
 * 先按「只有播放记录」算出一版推荐、再按「记录 + 收藏」算第二版，
 * 于是首屏会多画出一次中间布局（骨架 → 分栏 → 横图的来源之一）。
 */
export default function useHomeSignals(): HomeSignals {
  const [data, setData] = useState<SignalData>({
    playRecords: [],
    favorites: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // 初次读取完成前忽略订阅事件，避免重复写入导致推荐列表二次变化
    let settled = false;

    const load = async () => {
      try {
        const [records, favoriteMap] = await Promise.all([
          getRecentPlayRecords(SIGNAL_RECORD_LIMIT),
          getAllFavorites(),
        ]);
        if (cancelled) return;
        setData({
          playRecords: toRecordSignals(records),
          favorites: toFavoriteSignals(favoriteMap),
        });
      } catch {
        // 读取失败时退回「只看热榜」，首屏仍然可用
        if (cancelled) return;
        setData({ playRecords: [], favorites: [] });
      } finally {
        settled = true;
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    const unsubscribeRecords = subscribeToDataUpdates(
      'playRecordsUpdated',
      (records: Record<string, PlayRecord>) => {
        if (!settled) return;
        setData((previous) => ({
          ...previous,
          playRecords: toRecordSignals(records),
        }));
      }
    );
    const unsubscribeFavorites = subscribeToDataUpdates(
      'favoritesUpdated',
      (favoriteMap: Record<string, Favorite>) => {
        if (!settled) return;
        setData((previous) => ({
          ...previous,
          favorites: toFavoriteSignals(favoriteMap),
        }));
      }
    );

    return () => {
      cancelled = true;
      unsubscribeRecords();
      unsubscribeFavorites();
    };
  }, []);

  return { ...data, loading };
}
