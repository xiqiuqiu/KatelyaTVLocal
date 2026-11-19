'use client';

import { useEffect, useState } from 'react';

import {
  type Favorite,
  type PlayRecord,
  getAllFavorites,
  getRecentPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getRecentPlayRecordsFromAll } from '@/lib/play-record-key';
import { buildContinueWatchingRecords } from '@/lib/play-records';

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

    let favoritesUpdated = false;
    let recordsUpdated = false;
    const updateFavorites = (favorites: Record<string, Favorite>) =>
      setCounts((prev) => ({
        ...prev,
        favorites: Object.keys(favorites).length,
      }));
    const updateHistory = (records: Record<string, PlayRecord>) =>
      setCounts((prev) => ({
        ...prev,
        history: buildContinueWatchingRecords(
          getRecentPlayRecordsFromAll(records, 50)
        ).length,
      }));
    const unsubscribeFavorites = subscribeToDataUpdates<
      Record<string, Favorite>
    >('favoritesUpdated', (favorites) => {
      favoritesUpdated = true;
      updateFavorites(favorites);
    });
    const unsubscribeRecords = subscribeToDataUpdates<
      Record<string, PlayRecord>
    >('playRecordsUpdated', (records) => {
      recordsUpdated = true;
      updateHistory(records);
    });

    // A mutation can arrive before its initial read finishes.
    void getAllFavorites()
      .then((favorites) => {
        if (!cancelled && !favoritesUpdated) updateFavorites(favorites);
      })
      .catch(() => undefined);
    void getRecentPlayRecords(50)
      .then((records) => {
        if (!cancelled && !recordsUpdated) updateHistory(records);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribeFavorites();
      unsubscribeRecords();
    };
  }, []);

  return counts;
}
