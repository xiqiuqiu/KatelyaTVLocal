import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Swal from 'sweetalert2';

import * as dbClient from '@/lib/db.client';

import HistoryPage from './page';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('sweetalert2', () => ({
  fire: jest.fn(),
}));

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

jest.mock('@/lib/db.client', () => ({
  clearAllPlayRecords: jest.fn(),
  deletePlayRecord: jest.fn(),
  getAllPlayRecords: jest.fn(),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));

function mockRecords() {
  return {
    'cdp-src+keep+id&hash#eq=1': {
      title: '特殊记录',
      source_name: 'CDP测试源',
      year: '2026',
      cover: '',
      index: 2,
      total_episodes: 12,
      play_time: 90,
      total_time: 1800,
      save_time: 2,
      search_title: '特殊记录',
    },
    'source-b+2': {
      title: '普通记录',
      source_name: '测试源',
      year: '2025',
      cover: '',
      index: 1,
      total_episodes: 1,
      play_time: 30,
      total_time: 300,
      save_time: 1,
      search_title: '普通记录',
    },
  };
}

describe('HistoryPage', () => {
  beforeEach(() => {
    push.mockReset();
    (Swal.fire as jest.Mock).mockResolvedValue({ isConfirmed: true });
    (dbClient.getAllPlayRecords as jest.Mock).mockResolvedValue(mockRecords());
    (dbClient.deletePlayRecord as jest.Mock).mockResolvedValue(undefined);
    (dbClient.clearAllPlayRecords as jest.Mock).mockResolvedValue(undefined);
    (dbClient.subscribeToDataUpdates as jest.Mock).mockReturnValue(jest.fn());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders all records and routes playback with encoded special id', async () => {
    render(<HistoryPage />);

    await screen.findAllByText('特殊记录');
    fireEvent.click(screen.getByRole('button', { name: '继续播放 特殊记录' }));

    expect(push).toHaveBeenCalledTimes(1);
    const href = push.mock.calls[0][0] as string;
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('source')).toBe('cdp-src');
    expect(params.get('id')).toBe('keep+id&hash#eq=1');
    expect(params.get('from')).toBe('playrecord');
  });

  it('deletes one record through the single-record API path', async () => {
    render(<HistoryPage />);

    await screen.findAllByText('特殊记录');
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);

    await waitFor(() => {
      expect(dbClient.deletePlayRecord).toHaveBeenCalledWith(
        'cdp-src',
        'keep+id&hash#eq=1'
      );
    });
    expect(dbClient.clearAllPlayRecords).not.toHaveBeenCalled();
  });

  it('deletes selected records one by one and keeps clear-all separate', async () => {
    render(<HistoryPage />);

    await screen.findAllByText('特殊记录');
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    fireEvent.click(screen.getByRole('button', { name: /删除已选/ }));

    await waitFor(() => {
      expect(dbClient.deletePlayRecord).toHaveBeenCalledTimes(2);
    });
    expect(dbClient.deletePlayRecord).toHaveBeenCalledWith(
      'cdp-src',
      'keep+id&hash#eq=1'
    );
    expect(dbClient.deletePlayRecord).toHaveBeenCalledWith('source-b', '2');
    expect(dbClient.clearAllPlayRecords).not.toHaveBeenCalled();
  });

  it('uses clear-all only from the explicit clear-all action', async () => {
    render(<HistoryPage />);

    await screen.findAllByText('特殊记录');
    fireEvent.click(screen.getByRole('button', { name: /清空全部/ }));

    await waitFor(() => {
      expect(dbClient.clearAllPlayRecords).toHaveBeenCalledTimes(1);
    });
    expect(dbClient.deletePlayRecord).not.toHaveBeenCalled();
  });
});
