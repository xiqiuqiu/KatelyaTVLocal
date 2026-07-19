'use client';

import { useEffect, useState } from 'react';

import {
  deleteFavorite,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import type { SearchResult } from '@/lib/types';

type PlayFavoriteRefs = {
  currentSourceRef: React.MutableRefObject<string>;
  currentIdRef: React.MutableRefObject<string>;
  videoTitleRef: React.MutableRefObject<string>;
  detailRef: React.MutableRefObject<SearchResult | null>;
};

export function usePlayFavorite(
  currentSource: string,
  currentId: string,
  searchTitle: string,
  refs: PlayFavoriteRefs
) {
  const [favorited, setFavorited] = useState(false);

  useEffect(() => {
    if (!currentSource || !currentId) return;

    let cancelled = false;

    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        if (cancelled) return;
        setFavorited(fav);
      } catch (err) {
        if (!cancelled) {
          console.error('检查收藏状态失败:', err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentSource, currentId]);

  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, unknown>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  const handleToggleFavorite = async () => {
    const { videoTitleRef, detailRef, currentSourceRef, currentIdRef } = refs;

    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    ) {
      return;
    }

    try {
      if (favorited) {
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  return { favorited, handleToggleFavorite };
}
