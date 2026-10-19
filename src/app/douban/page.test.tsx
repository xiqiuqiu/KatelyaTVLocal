import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

import { getDoubanCategories } from '@/lib/douban.client';

import DoubanPage from './page';

let mockParams = new URLSearchParams();
jest.mock('next/navigation', () => ({ useSearchParams: () => mockParams }));
jest.mock('@/lib/douban.client', () => ({ getDoubanCategories: jest.fn() }));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({
    children,
    tvMode,
  }: {
    children: ReactNode;
    tvMode?: boolean;
  }) => <main data-tv-mode={tvMode}>{children}</main>,
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title, tvMode }: { title: string; tvMode?: boolean }) => (
    <button data-tv-mode={tvMode}>{title}</button>
  ),
}));
const fetchCategories = jest.mocked(getDoubanCategories);
const item = {
  id: '1',
  title: '测试影片',
  poster: '',
  rate: '8.0',
  year: '2026',
};

beforeEach(() => {
  mockParams = new URLSearchParams('type=movie');
  fetchCategories.mockReset();
  fetchCategories.mockResolvedValue({ code: 200, message: '', list: [item] });
});

it('retains movie filter request values through the shared selectors', async () => {
  render(<DoubanPage />);
  await screen.findByRole('button', { name: '测试影片' });
  fireEvent.click(screen.getByRole('button', { name: '最新电影' }));
  fireEvent.click(screen.getByRole('button', { name: '日本' }));
  await waitFor(() =>
    expect(fetchCategories).toHaveBeenLastCalledWith({
      kind: 'movie',
      category: '最新',
      type: '日本',
      pageLimit: 25,
      pageStart: 0,
    })
  );
  expect(screen.getByRole('button', { name: '最新电影' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

it('keeps TV category values and paginates explicitly in 25 item pages', async () => {
  mockParams = new URLSearchParams('type=tv&tv=1');
  fetchCategories.mockResolvedValueOnce({
    code: 200,
    message: '',
    list: Array.from({ length: 25 }, (_, i) => ({
      ...item,
      id: String(i),
      title: `剧集${i}`,
    })),
  });
  render(<DoubanPage />);
  await screen.findByRole('button', { name: '剧集0' });
  expect(screen.getByRole('main')).toHaveAttribute('data-tv-mode', 'true');
  expect(screen.getByRole('button', { name: '剧集0' })).toHaveAttribute(
    'data-tv-mode',
    'true'
  );
  fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
  await waitFor(() =>
    expect(fetchCategories).toHaveBeenLastCalledWith({
      kind: 'tv',
      category: 'tv',
      type: 'tv',
      pageLimit: 25,
      pageStart: 25,
    })
  );
  fireEvent.click(screen.getByRole('button', { name: '纪录片' }));
  await waitFor(() =>
    expect(fetchCategories).toHaveBeenLastCalledWith({
      kind: 'tv',
      category: 'tv',
      type: 'tv_documentary',
      pageLimit: 25,
      pageStart: 0,
    })
  );
});

it('ends the initial skeleton on a failed request and retries the same filter', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockParams = new URLSearchParams('type=show');
  fetchCategories.mockRejectedValueOnce(new Error('offline'));
  render(<DoubanPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '内容暂时加载失败'
  );
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await screen.findByRole('button', { name: '测试影片' });
  expect(fetchCategories).toHaveBeenLastCalledWith({
    kind: 'tv',
    category: 'show',
    type: 'show',
    pageLimit: 25,
    pageStart: 0,
  });
  jest.restoreAllMocks();
});
