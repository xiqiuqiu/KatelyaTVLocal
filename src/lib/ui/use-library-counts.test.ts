import { act, renderHook } from '@testing-library/react';

import * as dbClient from '@/lib/db.client';

import { useLibraryCounts } from './use-library-counts';

jest.mock('@/lib/db.client', () => ({
  ...jest.requireActual('@/lib/db.client'),
  getRecentPlayRecords: jest.fn(),
  getAllFavorites: jest.fn(),
}));

it('uses update payloads without refetching or reverting them when initial reads arrive late', async () => {
  let finishHistory!: (records: Record<string, dbClient.PlayRecord>) => void;
  let finishFavorites!: (favorites: Record<string, dbClient.Favorite>) => void;
  const history = jest.mocked(dbClient.getRecentPlayRecords).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishHistory = resolve;
      })
  );
  const favorites = jest.mocked(dbClient.getAllFavorites).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishFavorites = resolve;
      })
  );
  const { result } = renderHook(useLibraryCounts);
  const records = Object.fromEntries(
    Array.from({ length: 51 }, (_, i) => [
      'qa+' + i,
      { title: '影片' + i, year: '2026', save_time: i, total_episodes: 2 },
    ])
  );
  act(() => {
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', { detail: records })
    );
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', { detail: { 'qa+1': {} } })
    );
  });
  await act(async () => {
    finishHistory({});
    finishFavorites({});
  });
  expect(result.current).toEqual({ history: 50, favorites: 1 });
  expect(history).toHaveBeenCalledTimes(1);
  expect(favorites).toHaveBeenCalledTimes(1);
});
