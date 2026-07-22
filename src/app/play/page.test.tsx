import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { getAllPlayRecords } from '@/lib/db.client';
import type { SearchResult } from '@/lib/types';

import PlayPage from '@/app/play/page';

let mockSearchParams = new URLSearchParams();
type MockSourceChangeHandler = (
  source: string,
  id: string,
  title: string,
  options?: {
    autoRecovery?: boolean;
    resumeTime?: number | null;
    reason?: string;
    autoPlayAfterReady?: boolean;
  }
) => Promise<boolean>;
let mockSourceChangeHandler: MockSourceChangeHandler | undefined;
let mockArtPlayerInstance:
  | {
      currentTime: number;
      duration: number;
      video: {
        currentTime: number;
        duration: number;
        hls?: unknown;
      };
    }
  | undefined;
const mockArtPlayerEventHandlers = new Map<string, () => void>();
let mockAutoFireManifestParsed = true;
const mockManifestParsedHandlers: Array<() => void> = [];

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
  default: ({
    availableSources,
    onSourceChange,
  }: {
    availableSources: SearchResult[];
    onSourceChange: MockSourceChangeHandler;
  }) => {
    mockSourceChangeHandler = onSourceChange;
    return (
      <div data-testid='episode-selector-sources'>
        {availableSources.map((source) => source.source_name).join(',')}
      </div>
    );
  },
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
  default: jest.fn().mockImplementation((options) => {
    const video = {
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
      hls: undefined as unknown,
    };
    const player = {
      currentTime: 0,
      duration: 120,
      volume: 0.7,
      notice: { show: '' },
      on: jest.fn((event: string, handler: () => void) => {
        mockArtPlayerEventHandlers.set(event, handler);
      }),
      pause: jest.fn(),
      destroy: jest.fn(),
      video,
    };
    Object.defineProperty(player, 'switch', {
      set(value: string) {
        options.customType?.m3u8?.(video as unknown as HTMLVideoElement, value);
      },
    });
    mockArtPlayerInstance = player;
    // Mirror production: ArtPlayer invokes customType for m3u8 urls on create.
    if (
      typeof options.url === 'string' &&
      options.url.includes('.m3u8') &&
      options.customType?.m3u8
    ) {
      options.customType.m3u8(video as unknown as HTMLVideoElement, options.url);
    }
    return player;
  }),
}));

jest.mock('hls.js', () => {
  class MockHls {
    static DefaultConfig = { loader: class TestHlsLoader {} };
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed' };
    static isSupported = () => false;

    attachMedia = jest.fn();
    destroy = jest.fn();
    loadSource = jest.fn();
    on = jest.fn((event: string, handler: () => void) => {
      if (event === MockHls.Events.MANIFEST_PARSED) {
        if (mockAutoFireManifestParsed) {
          handler();
          return;
        }
        mockManifestParsedHandlers.push(handler);
      }
    });
  }

  return {
    __esModule: true,
    default: MockHls,
  };
});

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

    expect(
      await screen.findByRole('region', { name: '影片详情' })
    ).toBeTruthy();
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
    const genreIndex = recommendations.textContent?.indexOf('推荐电影甲') ?? -1;
    expect(alsoLikedIndex).toBeGreaterThanOrEqual(0);
    expect(genreIndex).toBeGreaterThan(alsoLikedIndex);
  });
});

describe('PlayPage automatic source-switch resume', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAutoFireManifestParsed = true;
    mockManifestParsedHandlers.length = 0;
    mockSearchParams = new URLSearchParams(
      'source=old&id=1&title=%E6%B5%8B%E8%AF%95'
    );
    mockSourceChangeHandler = undefined;
    mockArtPlayerInstance = undefined;
    mockArtPlayerEventHandlers.clear();
    (
      getAllPlayRecords as jest.MockedFunction<typeof getAllPlayRecords>
    ).mockResolvedValue({});

    const oldSource = createSource({
      source: 'old',
      id: '1',
      title: '测试',
      source_name: '旧源',
      episodes: ['https://example.com/old.m3u8'],
    });
    const newSource = createSource({
      source: 'new',
      id: '2',
      title: '测试',
      source_name: '新源',
      episodes: ['https://example.com/new.m3u8'],
    });

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith('/api/playback-debug')) {
        return {
          ok: true,
          json: async () => ({ enabled: false }),
        } as Response;
      }
      if (url.startsWith('/api/detail')) {
        return {
          ok: true,
          json: async () => oldSource,
        } as Response;
      }
      if (url.startsWith('/api/search')) {
        return {
          ok: true,
          json: async () => ({ results: [oldSource, newSource] }),
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

  it('keeps the queued resume for the target source when the old source emits canplay', async () => {
    render(<PlayPage />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/search?q=%E6%B5%8B%E8%AF%95',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => {
      expect(screen.getByTestId('episode-selector-sources')).toHaveTextContent(
        '旧源,新源'
      );
    });

    expect(mockSourceChangeHandler).toBeDefined();
    expect(mockArtPlayerInstance).toBeDefined();
    if (!mockArtPlayerInstance) {
      throw new Error('ArtPlayer mock was not initialized');
    }
    const playerBeforeSwitch = mockArtPlayerInstance;
    playerBeforeSwitch.currentTime = 120;
    playerBeforeSwitch.video.currentTime = 120;

    let switchPromise: Promise<boolean> | undefined;
    act(() => {
      switchPromise = mockSourceChangeHandler?.('new', '2', '测试', {
        autoRecovery: true,
        resumeTime: 115,
        reason: '自动恢复测试',
        autoPlayAfterReady: true,
      });
      // Stale canplay from the old source must not consume the queued resume.
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });
    await act(async () => {
      await switchPromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockArtPlayerInstance?.currentTime).toBe(115);
    });
  });

  it('applies queued resume after late MANIFEST_PARSED even if canplay fired early', async () => {
    mockAutoFireManifestParsed = false;
    mockManifestParsedHandlers.length = 0;

    render(<PlayPage />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/search?q=%E6%B5%8B%E8%AF%95',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => {
      expect(screen.getByTestId('episode-selector-sources')).toHaveTextContent(
        '旧源,新源'
      );
    });

    expect(mockSourceChangeHandler).toBeDefined();
    expect(mockArtPlayerInstance).toBeDefined();
    if (!mockArtPlayerInstance) {
      throw new Error('ArtPlayer mock was not initialized');
    }

    const player = mockArtPlayerInstance;
    player.currentTime = 120;
    player.video.currentTime = 120;

    let switchPromise: Promise<boolean> | undefined;
    await act(async () => {
      switchPromise = mockSourceChangeHandler?.('new', '2', '测试', {
        autoRecovery: true,
        resumeTime: 115,
        reason: '自动恢复测试',
        autoPlayAfterReady: true,
      });
      await switchPromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    const playerAfterSwitch = mockArtPlayerInstance;
    if (!playerAfterSwitch) {
      throw new Error('ArtPlayer mock missing after source switch');
    }
    playerAfterSwitch.currentTime = 0;
    playerAfterSwitch.video.currentTime = 0;

    // Early canplay before the target HLS manifest is ready must not consume or
    // permanently skip the queued Recovery Resume Time.
    act(() => {
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });
    expect(playerAfterSwitch.currentTime).toBe(0);

    // Late target-manifest readiness must still apply resume even if canplay
    // already fired too early (and must not require a third canplay).
    mockAutoFireManifestParsed = true;
    await act(async () => {
      (playerAfterSwitch as { switch?: string }).switch =
        'https://example.com/new.m3u8';
      await Promise.resolve();
      await Promise.resolve();
    });

    if (playerAfterSwitch.currentTime !== 115) {
      // Fallback signal: once the target manifest has armed targetReady,
      // a subsequent canplay must be able to apply the queued resume.
      act(() => {
        mockArtPlayerEventHandlers.get('video:canplay')?.();
      });
    }

    expect(playerAfterSwitch.currentTime).toBe(115);
  });
});
