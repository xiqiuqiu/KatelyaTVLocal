'use client';

import { useEffect, useState } from 'react';

import {
  getAllFavorites,
  getRecentPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

export interface LibraryCounts {
  favorites: number;
  history: number;
}

/**
 * 侧栏计数：收藏夹与播放历史的条数。
 * 数据来自本地缓存/存储，并在对应数据更新事件后自动刷新。
 */
export function useLibraryCounts(): LibraryCounts {
  const [counts, setCounts] = useState<LibraryCounts>({
    favorites: 0,
    history: 0,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [favorites, records] = await Promise.all([
          getAllFavorites(),
          getRecentPlayRecords(50),
        ]);
        if (cancelled) return;
        setCounts({
          favorites: Object.keys(favorites).length,
          history: Object.keys(records).length,
        });
      } catch {
        /* 取数失败时保持上一次的计数，不阻塞导航 */
      }
    };

    void load();
    const reload = () => {
      void load();
    };
    const unsubscribeFavorites = subscribeToDataUpdates(
      'favoritesUpdated',
      reload
    );
    const unsubscribeRecords = subscribeToDataUpdates(
      'playRecordsUpdated',
      reload
    );

    return () => {
      cancelled = true;
      unsubscribeFavorites();
      unsubscribeRecords();
    };
  }, []);

  return counts;
}
