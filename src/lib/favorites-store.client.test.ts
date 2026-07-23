import { act, renderHook } from '@testing-library/react';

import * as dbClient from '@/lib/db.client';

import {
  __resetFavoritesStoreForTests,
  useFavoriteStatus,
} from './favorites-store.client';

jest.mock('@/lib/db.client', () => ({
  getAllFavorites: jest.fn(),
  subscribeToDataUpdates: jest.fn(),
}));

describe('favorites-store.client', () => {
  let favoritesUpdateCallback:
    | ((favorites: Record<string, dbClient.Favorite>) => void)
    | null = null;
  const sourceUnsubscribe = jest.fn();

  beforeEach(() => {
    __resetFavoritesStoreForTests();
    favoritesUpdateCallback = null;

    (dbClient.getAllFavorites as jest.Mock).mockResolvedValue({
      'source-a+1': {
        title: 'A',
        source_name: '源A',
        year: '2026',
        cover: '',
        total_episodes: 1,
        save_time: 1,
      },
    });
    (dbClient.subscribeToDataUpdates as jest.Mock).mockImplementation(
      (_event, callback) => {
        favoritesUpdateCallback = callback;
        return sourceUnsubscribe;
      }
    );
  });

  afterEach(() => {
    __resetFavoritesStoreForTests();
    jest.clearAllMocks();
  });

  it('deduplicates initial load and source subscription across consumers', async () => {
    const hooks = Array.from({ length: 10 }, () =>
      renderHook(() => useFavoriteStatus('source-a+1'))
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(dbClient.getAllFavorites).toHaveBeenCalledTimes(1);
    expect(dbClient.subscribeToDataUpdates).toHaveBeenCalledTimes(1);
    expect(dbClient.subscribeToDataUpdates).toHaveBeenCalledWith(
      'favoritesUpdated',
      expect.any(Function)
    );

    hooks.forEach(({ result }) => {
      expect(result.current).toBe(true);
    });

    hooks.forEach(({ unmount }) => unmount());

    expect(sourceUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not change unrelated key snapshots on source updates', async () => {
    const { result: watchedResult } = renderHook(() =>
      useFavoriteStatus('source-a+1')
    );
    const { result: otherResult } = renderHook(() =>
      useFavoriteStatus('source-b+2')
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(watchedResult.current).toBe(true);
    expect(otherResult.current).toBe(false);

    act(() => {
      favoritesUpdateCallback?.({
        'source-b+2': {
          title: 'B',
          source_name: '源B',
          year: '2026',
          cover: '',
          total_episodes: 1,
          save_time: 2,
        },
      });
    });

    expect(watchedResult.current).toBe(false);
    expect(otherResult.current).toBe(true);
  });

  it('retries initial load after rejection without throwing during render', async () => {
    (dbClient.getAllFavorites as jest.Mock)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        'source-a+1': {
          title: 'A',
          source_name: '源A',
          year: '2026',
          cover: '',
          total_episodes: 1,
          save_time: 1,
        },
      });

    const { result, unmount } = renderHook(() =>
      useFavoriteStatus('source-a+1')
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe(false);
    expect(dbClient.getAllFavorites).toHaveBeenCalledTimes(1);

    unmount();

    const { result: retryResult } = renderHook(() =>
      useFavoriteStatus('source-a+1')
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(dbClient.getAllFavorites).toHaveBeenCalledTimes(2);
    expect(retryResult.current).toBe(true);
  });

  it('returns false for null storage keys without treating them as favorited', async () => {
    const { result } = renderHook(() => useFavoriteStatus(null));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe(false);
  });

  it('reloads favorites after a subscription gap', async () => {
    const { unmount } = renderHook(() => useFavoriteStatus('source-a+1'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(dbClient.getAllFavorites).toHaveBeenCalledTimes(1);
    unmount();

    (dbClient.getAllFavorites as jest.Mock).mockResolvedValueOnce({
      'source-a+1': {
        title: 'A',
        source_name: '源A',
        year: '2026',
        cover: '',
        total_episodes: 1,
        save_time: 1,
      },
      'source-b+2': {
        title: 'B',
        source_name: '源B',
        year: '2026',
        cover: '',
        total_episodes: 1,
        save_time: 2,
      },
    });

    const { result } = renderHook(() => useFavoriteStatus('source-b+2'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(dbClient.getAllFavorites).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(true);
  });
});
