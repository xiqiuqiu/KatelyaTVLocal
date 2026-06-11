/* eslint-disable @next/next/no-img-element */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as dbClient from '@/lib/db.client';
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
  isFavorited: jest.fn(),
  saveFavorite: jest.fn(),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));

describe('VideoCard', () => {
  beforeEach(() => {
    const deleteFavoriteMock = dbClient.deleteFavorite as jest.Mock;
    const deletePlayRecordMock = dbClient.deletePlayRecord as jest.Mock;
    const isFavoritedMock = dbClient.isFavorited as jest.Mock;
    const saveFavoriteMock = dbClient.saveFavorite as jest.Mock;
    const subscribeToDataUpdatesMock =
      dbClient.subscribeToDataUpdates as jest.Mock;

    push.mockReset();
    deleteFavoriteMock.mockReset();
    deletePlayRecordMock.mockReset();
    isFavoritedMock.mockReset();
    saveFavoriteMock.mockReset();
    subscribeToDataUpdatesMock.mockClear();

    isFavoritedMock.mockReturnValue(
      new Promise(() => {
        // Keep pending so action-only tests do not get async favorite updates.
      })
    );
    saveFavoriteMock.mockResolvedValue(undefined);
    deleteFavoriteMock.mockResolvedValue(undefined);
    deletePlayRecordMock.mockResolvedValue(undefined);
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
    expect(poster).toHaveAttribute('data-sizes', expect.stringContaining('33vw'));
  });
});
