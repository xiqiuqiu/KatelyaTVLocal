import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import Swal from 'sweetalert2';

import * as dbClient from '@/lib/db.client';

import HomePage from '@/app/page';

jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: jest.fn() },
}));

const push = jest.fn();
let mockSearchParams = new URLSearchParams();
const mockSearchParamsAdapter = {
  get: (key: string) => mockSearchParams.get(key),
};

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
  }),
  useSearchParams: () => mockSearchParamsAdapter,
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={props.alt} src={props.src} />
  ),
}));

jest.mock('@/lib/db.client', () => ({
  clearAllFavorites: jest.fn(),
  deletePlayRecordByKey: jest.fn(),
  getAllFavorites: jest.fn().mockResolvedValue({}),
  getAllPlayRecords: jest.fn().mockResolvedValue({}),
  getRecentPlayRecords: jest.fn().mockResolvedValue({
    'source-a+1': {
      title: '续看示例',
      source_name: '测试源',
      year: '2026',
      cover: 'https://img.example/continue.jpg',
      index: 1,
      total_episodes: 12,
      play_time: 60,
      total_time: 1800,
      save_time: 1,
      search_title: '续看示例',
    },
  }),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));

jest.mock('@/lib/douban.client', () => ({
  getDoubanCategories: jest.fn(async ({ kind }: { kind: string }) => {
    if (kind === 'movie') {
      return {
        code: 200,
        message: 'ok',
        list: [
          {
            id: 'hero-1',
            title: '庆余年',
            poster: 'https://img.example/hero.jpg',
            rate: '9.4',
            year: '2024',
          },
        ],
      };
    }
    return { code: 200, message: 'ok', list: [] };
  }),
}));

jest.mock('@/components/SiteProvider', () => ({
  useSite: () => ({ siteName: 'ReelFind' }),
}));

jest.mock(
  '@/components/PageLayout',
  () =>
    ({ children, tvMode }: { children: React.ReactNode; tvMode?: boolean }) =>
      (
        <div data-testid='page-layout' data-tv-mode={tvMode}>
          {children}
        </div>
      )
);

jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({
    title,
    tvMode,
    showFavoriteAction,
  }: {
    title: string;
    tvMode?: boolean;
    showFavoriteAction?: boolean;
  }) => (
    <div
      data-tv-card-mode={tvMode}
      data-show-favorite-action={showFavoriteAction}
    >
      {title}
    </div>
  ),
}));

describe('Home page composition', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    push.mockReset();
    jest.mocked(dbClient.clearAllFavorites).mockReset();
    jest.mocked(Swal.fire).mockReset();
  });

  it('shows Continue Watching before the movie catalog without a recommendation banner', async () => {
    const { container } = render(<HomePage />);
    await screen.findByText('庆余年');
    expect(
      screen.queryByRole('region', { name: '精选推荐' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /立即播放/i })
    ).not.toBeInTheDocument();

    const continueHeading = await screen.findByRole('heading', {
      name: '继续观看',
    });
    const continueSection = continueHeading.closest('section');
    expect(continueSection).not.toBeNull();
    expect(
      within(continueSection as HTMLElement).getByRole('link', {
        name: /更多/i,
      })
    ).toHaveAttribute('href', '/history');

    const movieIndex = container.textContent?.indexOf('庆余年') ?? -1;
    const continueIndex = container.textContent?.indexOf('继续观看') ?? -1;
    expect(movieIndex).toBeGreaterThanOrEqual(0);
    expect(movieIndex).toBeGreaterThan(continueIndex);

    expect(
      screen.getByRole('heading', { name: '首页', level: 1 })
    ).toBeInTheDocument();
  });

  it('keeps TV mode on catalog cards, continue watching and history', async () => {
    mockSearchParams.set('tv', '1');
    render(<HomePage />);
    await screen.findByText('庆余年');
    expect(screen.getByTestId('page-layout')).toHaveAttribute(
      'data-tv-mode',
      'true'
    );
    expect(screen.getByText('庆余年')).toHaveAttribute(
      'data-tv-card-mode',
      'true'
    );
    expect(
      screen.queryByRole('region', { name: '精选推荐' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '更多' })).toHaveAttribute(
      'href',
      '/history?tv=1'
    );
    expect(await screen.findByText('续看示例')).toHaveAttribute(
      'data-tv-card-mode',
      'true'
    );
  });
  it('keeps TV favorites accessible and confirms before clearing the collection', async () => {
    mockSearchParams = new URLSearchParams('tab=favorites&tv=1');
    jest.mocked(dbClient.getAllFavorites).mockResolvedValueOnce({
      'source-a+1': {
        title: '收藏示例',
        source_name: '测试源',
        year: '2026',
        cover: 'https://img.example/favorite.jpg',
        total_episodes: 12,
        save_time: 1,
      },
    });
    jest.mocked(Swal.fire).mockResolvedValueOnce({
      isConfirmed: false,
      isDenied: false,
      isDismissed: true,
    });
    render(<HomePage />);
    expect(await screen.findByText('收藏示例')).toHaveAttribute(
      'data-tv-card-mode',
      'true'
    );
    expect(screen.getByTestId('page-layout')).toHaveAttribute(
      'data-tv-mode',
      'true'
    );
    expect(
      screen.queryByRole('button', { name: '清空' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '管理收藏' }));
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    await waitFor(() =>
      expect(Swal.fire).toHaveBeenCalledWith(
        expect.objectContaining({ focusCancel: true })
      )
    );
    expect(dbClient.clearAllFavorites).not.toHaveBeenCalled();
    jest.mocked(Swal.fire).mockResolvedValueOnce({
      isConfirmed: true,
      isDenied: false,
      isDismissed: false,
    });
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    await waitFor(() =>
      expect(dbClient.clearAllFavorites).toHaveBeenCalledTimes(1)
    );
  });

  it('filters favorites without deleting and exposes removal only during management', async () => {
    mockSearchParams = new URLSearchParams('tab=favorites');
    jest.mocked(dbClient.getAllFavorites).mockResolvedValueOnce({
      'source-a+movie': {
        title: '收藏电影',
        source_name: '测试源',
        year: '2026',
        cover: '',
        total_episodes: 1,
        save_time: 2,
      },
      'source-a+series': {
        title: '收藏剧集',
        source_name: '测试源',
        year: '2026',
        cover: '',
        total_episodes: 12,
        save_time: 1,
      },
    });
    render(<HomePage />);
    expect(await screen.findByText('收藏电影')).toHaveAttribute(
      'data-show-favorite-action',
      'false'
    );
    fireEvent.click(screen.getByRole('button', { name: '电影' }));
    expect(screen.getByText('收藏电影')).toBeInTheDocument();
    expect(screen.queryByText('收藏剧集')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '管理收藏' }));
    expect(screen.getByText('收藏电影')).toHaveAttribute(
      'data-show-favorite-action',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: '剧集' }));
    expect(screen.getByText('收藏剧集')).toBeInTheDocument();
    expect(screen.queryByText('收藏电影')).not.toBeInTheDocument();
    expect(dbClient.clearAllFavorites).not.toHaveBeenCalled();
  });
});
