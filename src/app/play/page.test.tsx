import { act, render, screen, waitFor } from '@testing-library/react';
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
  default: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
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

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/detail?source=detail-source&id=detail-id'
      );
    });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(
      await screen.findByTestId('episode-selector-sources')
    ).toHaveTextContent('详情源');
  });
});
