/* eslint-disable @next/next/no-img-element */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as dbClient from '@/lib/db.client';
import { __resetFavoritesStoreForTests } from '@/lib/favorites-store.client';
import type { SearchResult } from '@/lib/types';

import VideoCard from '@/components/VideoCard';

const push = jest.fn();

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt, src }: { alt: string; src: string }) => (
    <img alt={alt} src={src} />
  ),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('@/components/ImagePlaceholder', () => ({
  ImagePlaceholder: () => <div data-testid='image-placeholder' />,
}));

jest.mock('@/lib/db.client', () => ({
  deleteFavorite: jest.fn(),
  deletePlayRecord: jest.fn(),
  generateStorageKey: (source: string, id: string) => `${source}+${id}`,
  getAllFavorites: jest.fn(),
  saveFavorite: jest.fn(),
  subscribeToDataUpdates: jest.fn(),
}));

describe('VideoCard favorites store integration', () => {
  let favoritesUpdateCallback:
    | ((favorites: Record<string, dbClient.Favorite>) => void)
    | null = null;
  const sourceUnsubscribe = jest.fn();

  beforeEach(() => {
    __resetFavoritesStoreForTests();
    push.mockReset();
    favoritesUpdateCallback = null;

    (dbClient.getAllFavorites as jest.Mock).mockResolvedValue({});
    (dbClient.saveFavorite as jest.Mock).mockResolvedValue(undefined);
    (dbClient.deleteFavorite as jest.Mock).mockResolvedValue(undefined);
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

  it('shares one initial favorites load and one source subscription across cards', async () => {
    render(
      <>
        {Array.from({ length: 10 }, (_, index) => (
          <VideoCard
            key={index}
            id={String(index + 1)}
            source='test'
            title={`示例影片 ${index + 1}`}
            poster='https://example.com/poster.jpg'
            from='search'
          />
        ))}
      </>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(dbClient.getAllFavorites).toHaveBeenCalledTimes(1);
    expect(dbClient.subscribeToDataUpdates).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe for douban-only cards', async () => {
    render(
      <VideoCard
        title='豆瓣条目'
        poster='https://example.com/poster.jpg'
        from='douban'
        rate='8.8'
        douban_id='1234567'
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(dbClient.getAllFavorites).not.toHaveBeenCalled();
    expect(dbClient.subscribeToDataUpdates).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: '切换收藏' })
    ).not.toBeInTheDocument();
  });

  it('does not subscribe for aggregate search cards without a heart action', async () => {
    const items: SearchResult[] = [
      {
        id: 'agg-1',
        title: '聚合结果',
        poster: 'https://example.com/poster.jpg',
        episodes: ['ep1', 'ep2'],
        source: 'aggregate-source',
        source_name: '聚合源',
        year: '2026',
      },
    ];

    render(
      <VideoCard
        title='聚合结果'
        poster='https://example.com/poster.jpg'
        from='search'
        items={items}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(dbClient.getAllFavorites).not.toHaveBeenCalled();
    expect(dbClient.subscribeToDataUpdates).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: '切换收藏' })
    ).not.toBeInTheDocument();
  });

  it('updates only the matching card when favorites change through the shared store', async () => {
    (dbClient.getAllFavorites as jest.Mock).mockResolvedValue({
      'test+1': {
        title: '示例影片 1',
        source_name: '测试源',
        year: '2026',
        cover: '',
        total_episodes: 1,
        save_time: 1,
      },
    });

    render(
      <>
        <VideoCard
          id='1'
          source='test'
          title='示例影片 1'
          poster='https://example.com/poster.jpg'
          from='search'
        />
        <VideoCard
          id='2'
          source='test'
          title='示例影片 2'
          poster='https://example.com/poster.jpg'
          from='search'
        />
      </>
    );

    await act(async () => {
      await Promise.resolve();
    });

    const hearts = screen.getAllByRole('button', { name: '切换收藏' });
    expect(hearts[0].className).toContain('ui-critical');
    expect(hearts[1].className).not.toContain('ui-critical');

    act(() => {
      favoritesUpdateCallback?.({
        'test+2': {
          title: '示例影片 2',
          source_name: '测试源',
          year: '2026',
          cover: '',
          total_episodes: 1,
          save_time: 2,
        },
      });
    });

    expect(hearts[0].className).not.toContain('ui-critical');
    expect(hearts[1].className).toContain('ui-critical');
  });

  it('relies on shared favorites events instead of per-card optimistic state', async () => {
    render(
      <VideoCard
        id='1'
        source='test'
        title='示例影片'
        poster='https://example.com/poster.jpg'
        from='favorite'
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: '切换收藏' }));

    await waitFor(() => {
      expect(dbClient.saveFavorite).toHaveBeenCalledWith(
        'test',
        '1',
        expect.any(Object)
      );
    });

    const heart = screen.getByRole('button', { name: '切换收藏' });
    expect(heart.className).not.toContain('ui-critical');

    act(() => {
      favoritesUpdateCallback?.({
        'test+1': {
          title: '示例影片',
          source_name: '测试源',
          year: '2026',
          cover: '',
          total_episodes: 1,
          save_time: 3,
        },
      });
    });

    expect(heart.className).toContain('ui-critical');
  });
});
