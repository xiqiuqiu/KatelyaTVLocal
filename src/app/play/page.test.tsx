import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { getAllPlayRecords } from '@/lib/db.client';
import type { SearchResult } from '@/lib/types';

import PlayPage from '@/app/play/page';

let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    back: jest.fn(),
    push: jest.fn(),
  }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@/lib/db.client', () => ({
  deleteFavorite: jest.fn(),
  deletePlayRecordByKey: jest.fn(),
  generateStorageKey: (source: string, id: string) => `${source}+${id}`,
  getAllPlayRecords: jest.fn(),
  isFavorited: jest.fn().mockResolvedValue(false),
  saveFavorite: jest.fn(),
  savePlayRecord: jest.fn(),
  savePlayRecordKeys: jest.fn(),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));

jest.mock('@/components/player/InitialLoadingOverlay', () => ({
  __esModule: true,
  default: ({ message }: { message: string }) => (
    <div data-testid='initial-loading'>{message}</div>
  ),
}));

jest.mock('@/components/player/PlayerHeader', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

jest.mock('@/components/player/PlayerLoadingOverlay', () => ({
  __esModule: true,
  default: () => <div data-testid='player-loading' />,
}));

jest.mock('@/components/player/PlayerSidebar', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => (
    <aside data-testid='player-sidebar'>{children}</aside>
  ),
}));

jest.mock('@/components/SkipController', () => ({
  __esModule: true,
  default: () => <div data-testid='skip-controller' />,
}));

jest.mock('@/components/EpisodeSelector', () => ({
  __esModule: true,
  default: ({ availableSources }: { availableSources: SearchResult[] }) => (
    <div data-testid='episode-selector-sources'>
      {availableSources.map((source) => source.source_name).join(',')}
    </div>
  ),
}));

jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

jest.mock('artplayer', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    currentTime: 0,
    duration: 120,
    on: jest.fn(),
    pause: jest.fn(),
    destroy: jest.fn(),
    video: {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      canPlayType: jest.fn(() => ''),
      currentTime: 0,
      duration: 120,
      getElementsByTagName: jest.fn(() => []),
      hasAttribute: jest.fn(() => false),
      load: jest.fn(),
      pause: jest.fn(),
      play: jest.fn().mockResolvedValue(undefined),
      removeAttribute: jest.fn(),
      appendChild: jest.fn(),
      src: '',
    },
  })),
}));

jest.mock('hls.js', () => ({
  __esModule: true,
  default: {
    DefaultConfig: { loader: class TestHlsLoader {} },
    isSupported: () => false,
  },
}));

function createSource(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'detail-id',
    source: 'detail-source',
    title: '详情影片',
    year: '2026',
    poster: '',
    episodes: ['https://example.com/detail.m3u8'],
    source_name: '详情源',
    ...overrides,
  };
}

async function settlePlayPage() {
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/detail?source=detail-source&id=detail-id',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  act(() => {
    jest.advanceTimersByTime(1000);
  });

  expect(
    await screen.findByTestId('episode-selector-sources')
  ).toHaveTextContent('详情源');
}

describe('PlayPage source initialization', () => {
  const mockedGetAllPlayRecords = getAllPlayRecords as jest.MockedFunction<
    typeof getAllPlayRecords
  >;

  beforeEach(() => {
    jest.useFakeTimers();
    mockSearchParams = new URLSearchParams(
      'source=detail-source&id=detail-id&title=%E8%AF%A6%E6%83%85%E5%BD%B1%E7%89%87'
    );
    mockedGetAllPlayRecords.mockResolvedValue({});
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith('/api/playback-debug')) {
        return {
          ok: true,
          json: async () => ({ enabled: false }),
        } as Response;
      }
      if (url.startsWith('/api/search')) {
        return {
          ok: true,
          json: async () => ({ results: [] }),
        } as Response;
      }
      if (url.startsWith('/api/detail')) {
        return {
          ok: true,
          json: async () => createSource(),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('syncs available sources from detail fallback after search misses the current source', async () => {
    render(<PlayPage />);
    await settlePlayPage();
  });
});

describe('PlayPage lower detail composition', () => {
  const mockedGetAllPlayRecords = getAllPlayRecords as jest.MockedFunction<
    typeof getAllPlayRecords
  >;

  function mockPlayPageFetch(
    recommends: {
      alsoLiked?: Array<Record<string, string>>;
      genreFallback?: Array<Record<string, string>>;
    } = {
      genreFallback: [
        {
          id: 'rec-1',
          title: '推荐电影甲',
          poster: 'https://img.example/rec1.jpg',
          rate: '8.8',
          year: '2025',
        },
      ],
    },
    detailOverrides: Partial<SearchResult> = {}
  ) {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith('/api/playback-debug')) {
        return {
          ok: true,
          json: async () => ({ enabled: false }),
        } as Response;
      }
      if (url.startsWith('/api/search')) {
        return {
          ok: true,
          json: async () => ({ results: [] }),
        } as Response;
      }
      if (url.startsWith('/api/detail')) {
        return {
          ok: true,
          json: async () =>
            createSource({
              poster: 'https://img.example/detail.jpg',
              class: '剧情',
              type_name: '电视剧',
              desc: '这是一段剧情简介。',
              ...detailOverrides,
            }),
        } as Response;
      }
      if (url.startsWith('/api/douban/recommends')) {
        return {
          ok: true,
          json: async () => ({
            code: 200,
            message: 'ok',
            alsoLiked: recommends.alsoLiked ?? [],
            genreFallback: recommends.genreFallback ?? [],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mockSearchParams = new URLSearchParams(
      'source=detail-source&id=detail-id&title=%E8%AF%A6%E6%83%85%E5%BD%B1%E7%89%87'
    );
    mockedGetAllPlayRecords.mockResolvedValue({});
    mockPlayPageFetch();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('shows Design Direction detail hierarchy and 相关推荐 below the side panel', async () => {
    const { container } = render(<PlayPage />);
    await settlePlayPage();
    jest.useRealTimers();

    expect(screen.getByTestId('player-sidebar')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /详情|讨论/ })).toBeNull();

    const detail = await screen.findByRole('region', { name: '影片详情' });
    expect(
      within(detail).getByRole('heading', { name: '详情影片' })
    ).toBeTruthy();
    expect(within(detail).getByAltText('详情影片')).toHaveAttribute(
      'src',
      expect.stringContaining('detail.jpg')
    );
    expect(within(detail).getByText('2026')).toBeTruthy();
    expect(within(detail).getByText('电视剧')).toBeTruthy();
    expect(within(detail).getByText('这是一段剧情简介。')).toBeTruthy();

    const recommendations = await screen.findByRole('region', {
      name: '相关推荐',
    });
    expect(
      within(recommendations).getByRole('heading', { name: '相关推荐' })
    ).toBeTruthy();
    expect(await within(recommendations).findByText('推荐电影甲')).toBeTruthy();

    const synopsisIndex =
      container.textContent?.indexOf('这是一段剧情简介。') ?? -1;
    const recommendIndex = container.textContent?.indexOf('相关推荐') ?? -1;
    expect(synopsisIndex).toBeGreaterThanOrEqual(0);
    expect(recommendIndex).toBeGreaterThan(synopsisIndex);
  });

  it('hides 相关推荐 when the recommends endpoint returns an empty list', async () => {
    mockPlayPageFetch({ alsoLiked: [], genreFallback: [] });
    render(<PlayPage />);
    await settlePlayPage();
    jest.useRealTimers();

    expect(await screen.findByRole('region', { name: '影片详情' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: '相关推荐' })).toBeNull();
    });
    expect(screen.queryByRole('region', { name: '猜你喜欢' })).toBeNull();
  });

  it('forwards detail.douban_id and leads the row with also-liked items', async () => {
    mockPlayPageFetch(
      {
        alsoLiked: [
          {
            id: 'also-1',
            title: '也喜欢甲',
            poster: 'https://img.example/also1.jpg',
            rate: '9.0',
            year: '2024',
          },
        ],
        genreFallback: [
          {
            id: 'rec-1',
            title: '推荐电影甲',
            poster: 'https://img.example/rec1.jpg',
            rate: '8.8',
            year: '2025',
          },
        ],
      },
      { douban_id: 1292052 }
    );

    render(<PlayPage />);
    await settlePlayPage();
    jest.useRealTimers();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/douban/recommends?')
      );
    });
    const recommendsCall = (global.fetch as jest.Mock).mock.calls
      .map(([input]) => String(input))
      .find((url) => url.startsWith('/api/douban/recommends?'));
    expect(recommendsCall).toContain('doubanId=1292052');

    const recommendations = await screen.findByRole('region', {
      name: '相关推荐',
    });
    expect(await within(recommendations).findByText('也喜欢甲')).toBeTruthy();
    const alsoLikedIndex =
      recommendations.textContent?.indexOf('也喜欢甲') ?? -1;
    const genreIndex =
      recommendations.textContent?.indexOf('推荐电影甲') ?? -1;
    expect(alsoLikedIndex).toBeGreaterThanOrEqual(0);
    expect(genreIndex).toBeGreaterThan(alsoLikedIndex);
  });
});
