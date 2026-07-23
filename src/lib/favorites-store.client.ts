'use client';

import { useSyncExternalStore } from 'react';

import { getAllFavorites, subscribeToDataUpdates, type Favorite } from './db.client';

let snapshot: Record<string, Favorite> = {};
let loadPromise: Promise<void> | null = null;
let sourceUnsubscribe: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function ensureLoaded() {
  loadPromise ??= getAllFavorites()
    .then((favorites) => {
      snapshot = favorites;
      emit();
    })
    .catch(() => {
      loadPromise = null;
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureLoaded();
  sourceUnsubscribe ??= subscribeToDataUpdates(
    'favoritesUpdated',
    (favorites: Record<string, Favorite>) => {
      snapshot = favorites;
      emit();
    }
  );
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      sourceUnsubscribe?.();
      sourceUnsubscribe = null;
      // Force a fresh getAllFavorites() after a subscription gap so
      // mutations that happened while unsubscribed are not missed.
      loadPromise = null;
    }
  };
}

export function useFavoriteStatus(storageKey: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (storageKey ? Boolean(snapshot[storageKey]) : false),
    () => false
  );
}

/** Test-only reset when module state leaks across Jest cases. */
export function __resetFavoritesStoreForTests(): void {
  snapshot = {};
  loadPromise = null;
  sourceUnsubscribe?.();
  sourceUnsubscribe = null;
  listeners.clear();
}
