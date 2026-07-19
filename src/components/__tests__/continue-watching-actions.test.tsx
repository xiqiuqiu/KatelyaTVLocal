import { act, render, screen, waitFor } from '@testing-library/react';

import * as dbClient from '@/lib/db.client';

import ContinueWatching from '@/components/ContinueWatching';

jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

jest.mock('@/lib/db.client', () => ({
  deletePlayRecord: jest.fn(),
  getRecentPlayRecords: jest.fn(),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));

describe('ContinueWatching actions', () => {
  beforeEach(() => {
    (dbClient.getRecentPlayRecords as jest.Mock).mockResolvedValue({
      'source-a+1': {
        title: '示例影片',
        source_name: '测试源',
        year: '2026',
        cover: '',
        index: 1,
        total_episodes: 12,
        play_time: 60,
        total_time: 1800,
        save_time: 1,
        search_title: '示例影片',
      },
    });
    (dbClient.subscribeToDataUpdates as jest.Mock).mockReturnValue(jest.fn());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('ignores stale play records fetch after unmount', async () => {
    let resolveRecords!: (value: Record<string, dbClient.PlayRecord>) => void;

    (dbClient.getRecentPlayRecords as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRecords = resolve;
        })
    );

    const { unmount } = render(<ContinueWatching />);

    expect(screen.getByText('继续观看')).toBeInTheDocument();
    unmount();

    await act(async () => {
      resolveRecords({
        'source-a+1': {
          title: '示例影片',
          source_name: '测试源',
          year: '2026',
          cover: '',
          index: 1,
          total_episodes: 12,
          play_time: 60,
          total_time: 1800,
          save_time: 1,
          search_title: '示例影片',
        },
      });
      await Promise.resolve();
    });

    expect(screen.queryByText('示例影片')).not.toBeInTheDocument();
  });

  it('links to the full history page instead of exposing clear-all on the home section', async () => {
    render(<ContinueWatching />);

    const moreLink = await screen.findByRole('link', { name: /更多/i });

    expect(moreLink).toHaveAttribute('href', '/history');
    expect(
      screen.queryByRole('button', { name: '清空' })
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(dbClient.getRecentPlayRecords).toHaveBeenCalledWith(50);
    });
  });
});
