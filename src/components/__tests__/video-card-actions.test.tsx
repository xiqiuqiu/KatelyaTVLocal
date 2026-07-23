/* eslint-disable @next/next/no-img-element */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as dbClient from '@/lib/db.client';
import { __resetFavoritesStoreForTests } from '@/lib/favorites-store.client';
import type { SearchResult } from '@/lib/types';

import VideoCard from '@/components/VideoCard';

const push = jest.fn();

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    alt,
    loading,
    priority,
    sizes,
    src,
  }: {
    alt: string;
    loading?: 'eager' | 'lazy';
    priority?: boolean;
    sizes?: string;
    src: string;
  }) => (
    <img
      alt={alt}
      data-priority={priority ? 'true' : 'false'}
      data-sizes={sizes}
      loading={loading}
      src={src}
    />
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
  getAllFavorites: jest.fn(async () => ({})),
  saveFavorite: jest.fn(),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));

describe('VideoCard', () => {
  beforeEach(() => {
    __resetFavoritesStoreForTests();

    const deleteFavoriteMock = dbClient.deleteFavorite as jest.Mock;
    const deletePlayRecordMock = dbClient.deletePlayRecord as jest.Mock;
    const getAllFavoritesMock = dbClient.getAllFavorites as jest.Mock;
    const saveFavoriteMock = dbClient.saveFavorite as jest.Mock;
    const subscribeToDataUpdatesMock =
      dbClient.subscribeToDataUpdates as jest.Mock;

    push.mockReset();
    deleteFavoriteMock.mockReset();
    deletePlayRecordMock.mockReset();
    getAllFavoritesMock.mockReset();
    saveFavoriteMock.mockReset();
    subscribeToDataUpdatesMock.mockReset();

    getAllFavoritesMock.mockResolvedValue({});
    subscribeToDataUpdatesMock.mockImplementation(() => jest.fn());
    saveFavoriteMock.mockResolvedValue(undefined);
    deleteFavoriteMock.mockResolvedValue(undefined);
    deletePlayRecordMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    __resetFavoritesStoreForTests();
  });

  it('routes on the primary click target for standard cards', () => {
    render(
      <VideoCard
        id='1'
        source='test'
        title='示例影片'
        poster='https://example.com/poster.jpg'
        episodes={12}
        source_name='测试源'
        year='2026'
        from='favorite'
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '打开 示例影片' }));

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('/play?source=test&id=1')
    );
  });

  it('marks play record routes so playback can recover expired source ids', () => {
    render(
      <VideoCard
        id='1'
        source='test'
        title='示例影片'
        poster='https://example.com/poster.jpg'
        episodes={12}
        source_name='测试源'
        year='2026'
        from='playrecord'
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '打开 示例影片' }));

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('from=playrecord')
    );
  });

  it('encodes playback route query params so special source ids round-trip', () => {
    render(
      <VideoCard
        id='video+part&episode#1=final'
        source='source+special'
        title='示例 & 影片'
        poster='https://example.com/poster.jpg'
        episodes={12}
        source_name='测试源'
        year='2026&special'
        from='playrecord'
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '打开 示例 & 影片' }));

    const href = push.mock.calls[0][0] as string;
    const url = new URL(href, 'https://app.example.com');
    expect(url.searchParams.get('source')).toBe('source+special');
    expect(url.searchParams.get('id')).toBe('video+part&episode#1=final');
    expect(url.searchParams.get('title')).toBe('示例 & 影片');
    expect(url.searchParams.get('year')).toBe('2026&special');
    expect(url.searchParams.get('from')).toBe('playrecord');
  });

  it('shows immediate opening feedback and blocks repeated card opens', async () => {
    render(
      <VideoCard
        id='1'
        source='test'
        title='示例影片'
        poster='https://example.com/poster.jpg'
        episodes={12}
        source_name='测试源'
        year='2026'
        from='favorite'
      />
    );

    const titleButton = screen.getByRole('button', { name: '打开 示例影片' });
    const posterButton = screen.getByRole('button', {
      name: '打开 示例影片 海报',
    });

    fireEvent.click(titleButton);

    await waitFor(() => {
      expect(screen.getByText('正在打开')).toBeInTheDocument();
    });
    expect(titleButton).toBeDisabled();
    expect(posterButton).toBeDisabled();
    expect(posterButton).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(titleButton);

    expect(push).toHaveBeenCalledTimes(1);
  });

  it('favorite clicks do not route away from the card', async () => {
    render(
      <VideoCard
        id='1'
        source='test'
        title='示例影片'
        poster='https://example.com/poster.jpg'
        episodes={12}
        source_name='测试源'
        year='2026'
        from='favorite'
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '切换收藏' }));

    await waitFor(() => {
      expect(dbClient.saveFavorite).toHaveBeenCalledWith(
        'test',
        '1',
        expect.any(Object)
      );
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('delete clicks do not route away from the card', async () => {
    render(
      <VideoCard
        id='1'
        source='test'
        title='示例影片'
        poster='https://example.com/poster.jpg'
        episodes={12}
        source_name='测试源'
        year='2026'
        from='playrecord'
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '删除播放记录' }));

    await waitFor(() => {
      expect(dbClient.deletePlayRecord).toHaveBeenCalledWith('test', '1');
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('play record cards can delegate delete handling for grouped records', async () => {
    const onDeleteRecord = jest.fn().mockResolvedValue(undefined);

    render(
      <VideoCard
        id='1'
        source='test'
        title='示例影片'
        poster='https://example.com/poster.jpg'
        episodes={12}
        source_name='测试源'
        year='2026'
        from='playrecord'
        onDeleteRecord={onDeleteRecord}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '删除播放记录' }));

    await waitFor(() => {
      expect(onDeleteRecord).toHaveBeenCalledTimes(1);
    });
    expect(dbClient.deletePlayRecord).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('aggregate search cards still route on the primary click target', () => {
    const items: SearchResult[] = [
      {
        id: 'agg-1',
        title: '聚合结果',
        poster: 'https://example.com/poster.jpg',
        episodes: ['ep1', 'ep2'],
        source: 'aggregate-source',
        source_name: '聚合源',
        year: '2026',
        douban_id: 1234567,
      },
    ];

    render(
      <VideoCard
        title='聚合结果'
        query='原始查询'
        poster='https://example.com/poster.jpg'
        from='search'
        items={items}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '打开 聚合结果' }));

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining(
        '/play?source=aggregate-source&id=agg-1&title=%E8%81%9A%E5%90%88%E7%BB%93%E6%9E%9C'
      )
    );
    expect(push).toHaveBeenCalledWith(expect.stringContaining('prefer=true'));
  });

  it('surfaces rich search metadata without changing primary click routing', () => {
    render(
      <VideoCard
        id='1'
        source='test'
        title='庆余年'
        poster='https://example.com/poster.jpg'
        episodes={36}
        source_name='测试源'
        year='2024'
        from='search'
        typeName='国产剧'
        statusText='共36集'
      />
    );

    expect(screen.getByText('国产剧')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
    expect(screen.getByText('共36集')).toBeInTheDocument();
    expect(screen.getByText('测试源')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开 庆余年' }));

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('/play?source=test&id=1')
    );
  });

  it('keeps favorite clicks from navigating when rich search metadata is present', async () => {
    render(
      <VideoCard
        id='1'
        source='test'
        title='庆余年'
        poster='https://example.com/poster.jpg'
        episodes={12}
        source_name='测试源'
        year='2024'
        from='search'
        typeName='国产剧'
        statusText='共12集'
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '切换收藏' }));

    await waitFor(() => {
      expect(dbClient.saveFavorite).toHaveBeenCalledWith(
        'test',
        '1',
        expect.any(Object)
      );
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('reflects the current source/id favorite key after props change', async () => {
    (dbClient.getAllFavorites as jest.Mock).mockResolvedValue({
      'test+2': {
        title: '示例影片',
        source_name: '测试源',
        year: '2026',
        cover: '',
        total_episodes: 12,
        save_time: 1,
      },
    });

    const cardProps = {
      title: '示例影片',
      poster: 'https://example.com/poster.jpg',
      episodes: 12,
      source_name: '测试源',
      year: '2026',
      from: 'search' as const,
    };

    const { rerender } = render(
      <VideoCard id='1' source='test' {...cardProps} />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByRole('button', { name: '切换收藏' }).className
    ).not.toContain('ui-critical');

    rerender(<VideoCard id='2' source='test' {...cardProps} />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '切换收藏' }).className
      ).toContain('ui-critical');
    });
  });

  it('requests optimized poster sizes and can prioritize first-screen cards', () => {
    window.RUNTIME_CONFIG = {
      IMAGE_PROXY: '/api/image-proxy?url=',
    };

    render(
      <VideoCard
        id='1'
        source='test'
        title='首屏影片'
        poster='https://example.com/poster.jpg'
        from='favorite'
        imagePriority={true}
        size='small'
      />
    );

    const poster = screen.getByRole('img', { name: '首屏影片' });

    expect(poster).toHaveAttribute(
      'src',
      '/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fposter.jpg&w=240&h=360&q=76'
    );
    expect(poster).toHaveAttribute('data-priority', 'true');
    expect(poster).not.toHaveAttribute('loading');
    expect(poster).toHaveAttribute(
      'data-sizes',
      expect.stringContaining('33vw')
    );
  });
});
