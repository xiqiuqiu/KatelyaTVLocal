/* eslint-disable @next/next/no-img-element */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import * as dbClient from '@/lib/db.client';
import { __resetFavoritesStoreForTests } from '@/lib/favorites-store.client';
import type { SearchResult } from '@/lib/types';

import VideoCard from '@/components/VideoCard';

const push = jest.fn();
const mockPlaybackPreparationStart = jest.fn();

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    alt,
    src,
    onError,
  }: {
    alt: string;
    src: string;
    onError?: () => void;
  }) => <img alt={alt} src={src} onError={onError} />,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

jest.mock(
  '@/components/playback-preparation/PlaybackPreparationProvider',
  () => ({
    usePlaybackPreparation: () => ({
      active: true,
      start: mockPlaybackPreparationStart,
      markFrameReady: jest.fn(),
      markTerminalFailure: jest.fn(),
      cancel: jest.fn(),
    }),
  })
);

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
    mockPlaybackPreparationStart.mockReset();
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

  it('expands result sources without navigating and preserves the selected source playback route', async () => {
    const items: SearchResult[] = ['甲', '乙'].map((label, index) => ({
      id: String(index + 1),
      source: `source-${index}`,
      source_name: `源${label}`,
      title: '测试剧集',
      year: '2026',
      poster: 'https://example.com/poster.jpg',
      episodes: ['a', 'b'],
    }));
    render(
      <VideoCard
        from='search'
        layout='result'
        tvMode
        items={items}
        query='测试'
      />
    );
    expect(
      screen.queryByRole('link', { name: '打开豆瓣页面' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开来源' }));
    expect(mockPlaybackPreparationStart).not.toHaveBeenCalled();
    const source = (await screen.findByText('源乙')).closest('article');
    expect(source).not.toBeNull();
    if (!source) throw new Error('source row missing');
    fireEvent.click(
      within(source).getByRole('button', { name: '查看并播放 测试剧集' })
    );
    const href = mockPlaybackPreparationStart.mock.calls[0][0].href;
    const params = new URL(href, 'http://localhost').searchParams;
    expect(params.get('source')).toBe('source-1');
    expect(params.get('id')).toBe('2');
    expect(params.get('stitle')).toBe('测试');
    expect(params.get('tv')).toBe('1');
    expect(params.has('prefer')).toBe(false);
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

  it('starts the shared preparation transition with the resolved play link', () => {
    render(
      <VideoCard
        id='video-1'
        source='source-a'
        title='庆余年'
        poster='https://img.example/poster.jpg'
        year='2024'
        from='search'
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '打开 庆余年 海报' }));

    expect(mockPlaybackPreparationStart).toHaveBeenCalledWith(
      expect.objectContaining({
        href: '/play?source=source-a&id=video-1&title=%E5%BA%86%E4%BD%99%E5%B9%B4&year=2024',
        title: '庆余年',
        poster: 'https://img.example/poster.jpg',
      })
    );
    expect(push).not.toHaveBeenCalled();
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

  it('preserves TV mode and encoded source ids through the shared playback preparation', () => {
    render(
      <VideoCard
        tvMode
        id='id+hash#value'
        source='source-a'
        title='续看'
        from='playrecord'
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '打开 续看 海报' }));
    const href = mockPlaybackPreparationStart.mock.calls[0][0].href;
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('tv')).toBe('1');
    expect(params.get('from')).toBe('playrecord');
    expect(params.get('id')).toBe('id+hash#value');
    expect(screen.getByRole('button', { name: '打开 续看' })).toHaveAttribute(
      'tabindex',
      '-1'
    );
  });

  it('uses the existing resume route from a landscape CTA and keeps a failed poster actionable', () => {
    render(
      <VideoCard
        layout='landscape'
        tvMode
        id='id+hash#value'
        source='source-a'
        title='续看'
        poster='https://example.com/missing.jpg'
        from='playrecord'
        currentEpisode={18}
        progress={40}
        source_name='测试源'
      />
    );
    fireEvent.error(screen.getByRole('img', { name: '续看' }));
    expect(
      screen.getByRole('img', { name: '续看 海报暂不可用' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('第 18 集 · 已看 40% · 测试源')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '打开 续看 海报' })
    ).toHaveAttribute('tabindex', '-1');
    const resume = screen.getByRole('button', { name: '继续播放 续看' });
    expect(resume).toHaveAttribute('data-tv-primary', 'true');
    expect(
      screen.getAllByRole('button').filter((button) => button.tabIndex >= 0)
    ).toEqual([resume]);
    expect(
      screen.queryByRole('button', { name: '删除播放记录' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '切换收藏' })
    ).not.toBeInTheDocument();
    fireEvent.click(resume);
    const params = new URLSearchParams(
      mockPlaybackPreparationStart.mock.calls[0][0].href.split('?')[1]
    );
    expect(params.get('from')).toBe('playrecord');
    expect(params.get('source')).toBe('source-a');
    expect(params.get('id')).toBe('id+hash#value');
    expect(params.get('tv')).toBe('1');
  });

  it('keeps favorite and history management on web resume cards', () => {
    render(
      <VideoCard
        layout='landscape'
        id='1'
        source='source-a'
        title='续看'
        from='playrecord'
      />
    );

    expect(
      screen.getByRole('button', { name: '删除播放记录' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '切换收藏' })
    ).toBeInTheDocument();
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
