import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import Swal from 'sweetalert2';

import * as dbClient from '@/lib/db.client';

import HistoryPage from './page';

const push = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => mockSearchParams,
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
  deletePlayRecordByKey: jest.fn(),
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
    mockSearchParams = new URLSearchParams();
    push.mockReset();
    (Swal.fire as jest.Mock).mockResolvedValue({ isConfirmed: true });
    (dbClient.getAllPlayRecords as jest.Mock).mockResolvedValue(mockRecords());
    (dbClient.deletePlayRecordByKey as jest.Mock).mockResolvedValue(undefined);
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

  it('groups records by local date and keeps destructive controls in management mode', async () => {
    const records = mockRecords();
    const now = Date.now();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    (dbClient.getAllPlayRecords as jest.Mock).mockResolvedValue({
      'source-today+1': {
        ...records['source-b+2'],
        title: '今天的影片',
        search_title: '今天的影片',
        save_time: now,
      },
      'source-yesterday+2': {
        ...records['source-b+2'],
        title: '昨天的影片',
        search_title: '昨天的影片',
        save_time: yesterday.getTime(),
      },
      'source-b+2': records['source-b+2'],
    });
    render(<HistoryPage />);
    expect(
      await screen.findByRole('region', { name: '今天' })
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: '昨天' })).getByText(
        '昨天的影片',
        { selector: 'button.line-clamp-2' }
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '更早' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '清空全部' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '选择播放记录' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '管理记录' }));
    expect(
      screen.getByRole('button', { name: '清空全部' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '完成管理' }));
    expect(
      screen.queryByRole('button', { name: '清空全部' })
    ).not.toBeInTheDocument();
  });

  it('cancels desktop deletion and deletes all grouped source keys only after confirmation', async () => {
    const records = mockRecords();
    (dbClient.getAllPlayRecords as jest.Mock).mockResolvedValue({
      ...records,
      'other-source+legacy': {
        ...records['cdp-src+keep+id&hash#eq=1'],
        save_time: 1,
      },
    });
    render(<HistoryPage />);
    await screen.findAllByText('特殊记录');
    fireEvent.click(screen.getByRole('button', { name: '管理记录' }));
    (Swal.fire as jest.Mock).mockResolvedValueOnce({ isConfirmed: false });
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    await waitFor(() =>
      expect(Swal.fire).toHaveBeenCalledWith(
        expect.objectContaining({ focusCancel: true })
      )
    );
    expect(dbClient.deletePlayRecordByKey).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    await waitFor(() =>
      expect(dbClient.deletePlayRecordByKey).toHaveBeenCalledWith(
        'other-source+legacy'
      )
    );
    expect(dbClient.deletePlayRecordByKey).toHaveBeenCalledWith(
      'cdp-src+keep+id&hash#eq=1'
    );
  });

  it('deletes one record through the single-record API path', async () => {
    render(<HistoryPage />);

    await screen.findAllByText('特殊记录');
    fireEvent.click(screen.getByRole('button', { name: '管理记录' }));
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);

    await waitFor(() => {
      expect(dbClient.deletePlayRecordByKey).toHaveBeenCalledWith(
        'cdp-src+keep+id&hash#eq=1'
      );
    });
    expect(dbClient.clearAllPlayRecords).not.toHaveBeenCalled();
  });

  it('keeps TV mode on every resume route and defaults destructive confirmation to cancel', async () => {
    mockSearchParams.set('tv', '1');
    render(<HistoryPage />);
    await screen.findAllByText('特殊记录');
    fireEvent.click(screen.getByRole('button', { name: '继续播放 特殊记录' }));
    fireEvent.click(screen.getAllByRole('button', { name: '继续播放' })[0]);
    for (const [href] of push.mock.calls) {
      const params = new URLSearchParams(href.split('?')[1]);
      expect(params.get('tv')).toBe('1');
      expect(params.get('id')).toBe('keep+id&hash#eq=1');
    }
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute(
      'href',
      '/?tv=1'
    );
    (Swal.fire as jest.Mock).mockResolvedValueOnce({ isConfirmed: false });
    fireEvent.click(screen.getByRole('button', { name: '管理记录' }));
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    await waitFor(() =>
      expect(Swal.fire).toHaveBeenCalledWith(
        expect.objectContaining({ focusCancel: true })
      )
    );
    expect(dbClient.deletePlayRecordByKey).not.toHaveBeenCalled();
  });

  it('deletes selected records one by one and keeps clear-all separate', async () => {
    render(<HistoryPage />);

    await screen.findAllByText('特殊记录');
    fireEvent.click(screen.getByRole('button', { name: '管理记录' }));
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    fireEvent.click(screen.getByRole('button', { name: /删除已选/ }));

    await waitFor(() => {
      expect(dbClient.deletePlayRecordByKey).toHaveBeenCalledTimes(2);
    });
    expect(dbClient.deletePlayRecordByKey).toHaveBeenCalledWith(
      'cdp-src+keep+id&hash#eq=1'
    );
    expect(dbClient.deletePlayRecordByKey).toHaveBeenCalledWith('source-b+2');
    expect(dbClient.clearAllPlayRecords).not.toHaveBeenCalled();
  });

  it('uses clear-all only from the explicit clear-all action', async () => {
    render(<HistoryPage />);

    await screen.findAllByText('特殊记录');
    fireEvent.click(screen.getByRole('button', { name: '管理记录' }));
    fireEvent.click(screen.getByRole('button', { name: /清空全部/ }));

    await waitFor(() => {
      expect(dbClient.clearAllPlayRecords).toHaveBeenCalledTimes(1);
    });
    expect(dbClient.deletePlayRecordByKey).not.toHaveBeenCalled();
  });
});
