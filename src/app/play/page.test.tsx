import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ReactNode } from 'react';

import { getAllPlayRecords } from '@/lib/db.client';
import { playbackQualityPayloadSchema } from '@/lib/playback-quality';
import { reducePlaybackSession } from '@/lib/playback-session';
import { getSourceSwitchResumePlan } from '@/lib/playback-source-switch';
import type { SearchResult } from '@/lib/types';
import { rememberSourcePlaybackQuality } from '@/lib/utils';

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
let mockEpisodeChangeHandler: ((episode: number) => void) | undefined;
let mockArtPlayerInstance:
  | {
      currentTime: number;
      duration: number;
      fullscreen: boolean;
      fullscreenWeb: boolean;
      emit?: (event: string) => void;
      pause: jest.Mock;
      controls: {
        isHover: boolean;
        show: boolean;
      };
      template: {
        $player: HTMLElement;
      };
      video: {
        currentTime: number;
        duration: number;
        paused: boolean;
        seeking?: boolean;
        playbackRate?: number;
        addEventListener?: jest.Mock;
        muted?: boolean;
        play: jest.Mock;
        pause: jest.Mock;
        hls?: unknown;
      };
    }
  | undefined;
const mockArtPlayerEventHandlers = new Map<
  string,
  (...args: unknown[]) => void
>();
const mockArtPlayerEventHandlerLists = new Map<
  string,
  Array<(...args: unknown[]) => void>
>();
let mockAutoFireManifestParsed = true;
let mockHlsSupported = false;
let mockDefaultPlayerDuration = 120;
let mockUseRealArtPlayer = false;
const mockManifestParsedHandlers: Array<() => void> = [];
const mockHlsErrorHandlers: Array<
  (event?: unknown, data?: Record<string, unknown>) => void
> = [];
const mockMarkPreparationFrameReady = jest.fn();
const mockRouterBack = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockRouterBack,
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

jest.mock('@/lib/playback-source-switch', () => {
  const actual = jest.requireActual('@/lib/playback-source-switch');
  return {
    ...actual,
    getSourceSwitchResumePlan: jest.fn(actual.getSourceSwitchResumePlan),
  };
});

jest.mock('@/lib/playback-session', () => {
  const actual = jest.requireActual('@/lib/playback-session');
  return {
    ...actual,
    reducePlaybackSession: jest.fn(actual.reducePlaybackSession),
  };
});

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid='page-layout'>{children}</div>
  ),
}));

jest.mock(
  '@/components/playback-preparation/PlaybackPreparationProvider',
  () => ({
    usePlaybackPreparation: () => ({
      active: true,
      start: jest.fn(),
      markFrameReady: mockMarkPreparationFrameReady,
      markTerminalFailure: jest.fn(),
      cancel: jest.fn(),
    }),
  })
);

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
  default: (props: Record<string, unknown>) => {
    const Overlay = jest.requireActual(
      '@/components/player/PlayerLoadingOverlay'
    ).default;
    return (
      <div data-testid='player-loading'>
        <Overlay {...props} />
      </div>
    );
  },
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
    activeTab,
    onChange,
    currentSource,
    value,
  }: {
    onChange: (episode: number) => void;
    currentSource: string;
    value: number;
    availableSources: SearchResult[];
    onSourceChange: MockSourceChangeHandler;
    activeTab?: 'episodes' | 'sources';
  }) => {
    mockSourceChangeHandler = onSourceChange;
    mockEpisodeChangeHandler = onChange;
    return (
      <div
        data-testid='episode-selector-sources'
        data-active-tab={activeTab}
        data-source={currentSource}
        data-episode={value}
      >
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
    if (mockUseRealArtPlayer) {
      const Artplayer = jest.requireActual('artplayer');
      // Exercise real controls and timers without loading media in jsdom.
      const player = new Artplayer({
        ...options,
        autoplay: false,
        customType: { m3u8: () => undefined },
      });
      Object.defineProperties(player.video, {
        playing: { value: true },
        duration: { value: mockDefaultPlayerDuration },
      });
      player.video.play = jest.fn().mockResolvedValue(undefined);
      player.video.pause = jest.fn();
      player.video.load = jest.fn();
      mockArtPlayerInstance = player;
      return player;
    }
    const playerElement = document.createElement('div');
    playerElement.className = 'art-video-player';
    playerElement.innerHTML = `
      <div class="art-bottom">
        <div class="art-progress">
          <div class="art-control art-control-progress"></div>
        </div>
        <div class="art-controls">
          <div class="art-controls-left">
            <div class="art-control art-control-playAndPause">
              <i class="art-icon art-icon-play"></i>
              <i class="art-icon art-icon-pause" style="display:none"></i>
            </div>
            <div class="art-control art-control-volume">
              <i class="art-icon art-icon-volume"></i>
              <i class="art-icon art-icon-volume-close" style="display:none"></i>
            </div>
            <div class="art-control art-control-nextEpisode">
              <i class="art-icon"></i>
            </div>
          </div>
          <div class="art-controls-right">
            <div class="art-control art-control-setting">
              <i class="art-icon"></i>
            </div>
            <div class="art-control art-control-fullscreenWeb"></div>
            <div class="art-control art-control-fullscreen"></div>
          </div>
        </div>
      </div>
    `;
    options.container?.appendChild(playerElement);
    const video = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      canPlayType: jest.fn(() => ''),
      currentTime: 0,
      duration: mockDefaultPlayerDuration,
      paused: false,
      getElementsByTagName: jest.fn(() => []),
      hasAttribute: jest.fn(() => false),
      load: jest.fn(),
      pause: jest.fn(),
      play: jest.fn().mockResolvedValue(undefined),
      removeAttribute: jest.fn(),
      setAttribute: jest.fn(),
      appendChild: jest.fn(),
      src: '',
      hls: undefined as unknown,
    };
    const player = {
      currentTime: 0,
      duration: mockDefaultPlayerDuration,
      fullscreen: false,
      fullscreenWeb: false,
      volume: 0.7,
      controls: { isHover: false, show: true },
      template: { $player: playerElement },
      notice: { show: '' },
      on: jest.fn((event: string, handler: () => void) => {
        mockArtPlayerEventHandlers.set(event, handler);
        const handlers = mockArtPlayerEventHandlerLists.get(event) || [];
        handlers.push(handler);
        mockArtPlayerEventHandlerLists.set(event, handlers);
      }),
      off: jest.fn(),
      pause: jest.fn(),
      destroy: jest.fn(),
      video,
    };
    Object.defineProperty(player, 'switch', {
      set(value: string) {
        options.customType?.m3u8?.(video as unknown as HTMLVideoElement, value);
      },
    });
    Object.defineProperty(player, 'url', {
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
      options.customType.m3u8(
        video as unknown as HTMLVideoElement,
        options.url
      );
    }
    return player;
  }),
}));

jest.mock('hls.js', () => {
  class MockHls {
    static DefaultConfig = { loader: class TestHlsLoader {} };
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed' };
    static isSupported = () => mockHlsSupported;

    attachMedia = jest.fn();
    destroy = jest.fn();
    loadSource = jest.fn();
    startLoad = jest.fn();
    stopLoad = jest.fn();
    on = jest.fn(
      (
        event: string,
        handler: (event?: unknown, data?: Record<string, unknown>) => void
      ) => {
        if (event === MockHls.Events.MANIFEST_PARSED) {
          if (mockAutoFireManifestParsed) {
            handler();
            return;
          }
          mockManifestParsedHandlers.push(() => handler());
        } else if (event === MockHls.Events.ERROR) {
          mockHlsErrorHandlers.push(handler);
        }
      }
    );
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
      '/api/detail?source=detail-source&id=detail-id&v=2',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
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
    mockHlsErrorHandlers.length = 0;
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
    mockUseRealArtPlayer = false;
    mockAutoFireManifestParsed = true;
    mockHlsSupported = false;
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'jsdom',
    });
    delete (window as Window & { ManagedMediaSource?: unknown })
      .ManagedMediaSource;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('direct source critical path', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }
    const response = (data: unknown, ok = true) =>
      ({ ok, json: async () => data } as Response);
    const requested = () =>
      createSource({
        episodes: [
          'https://example.com/one.m3u8',
          'https://example.com/two.m3u8',
        ],
      });
    const alternate = () =>
      createSource({
        source: 'alternate',
        id: '2',
        source_name: '备用源',
        episodes: [
          'https://alternate.example/one.m3u8',
          'https://alternate.example/two.m3u8',
        ],
      });
    function requests(search: Promise<Response>, detail: Promise<Response>) {
      const original = global.fetch;
      global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (input.toString().startsWith('/api/search')) return search;
        if (input.toString().startsWith('/api/detail')) return detail;
        return original(input, init);
      });
    }
    function media() {
      return mockArtPlayerInstance?.video.hls as
        | { loadSource: jest.Mock }
        | undefined;
    }
    function qualityRecords() {
      return jest
        .mocked(global.fetch)
        .mock.calls.flatMap(([url, init]) =>
          url === '/api/playback-quality' && typeof init?.body === 'string'
            ? playbackQualityPayloadSchema.parse(JSON.parse(init.body)).records
            : []
        );
    }
    beforeEach(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem('enableOptimization', 'false');
      mockHlsSupported = true;
      mockAutoFireManifestParsed = false;
      mockDefaultPlayerDuration = 240;
      mockArtPlayerInstance = undefined;
      mockManifestParsedHandlers.length = 0;
      mockArtPlayerEventHandlers.clear();
      mockArtPlayerEventHandlerLists.clear();
      window.history.replaceState(
        {},
        '',
        '/play?' + mockSearchParams.toString()
      );
    });
    afterEach(() => {
      mockDefaultPlayerDuration = 120;
      window.localStorage.clear();
      window.sessionStorage.clear();
    });

    it.each(['card', 'specified'] as const)(
      'loads the complete same-title source list from the %s entry using fresh normalized search data',
      async (entry) => {
        const sources = Array.from({ length: 30 }, (_, index) =>
          createSource({
            source: index === 0 ? 'jisu' : `source-${index}`,
            id: index === 0 ? '151407' : String(index),
            source_name: `线路${index}`,
            title: '思想验证区域第二季',
            year: '2026',
            episodes: [
              'https://video.example/one.m3u8',
              'https://video.example/two.m3u8',
            ],
          })
        );
        mockSearchParams = new URLSearchParams({
          title:
            entry === 'card' ? '思想验证区域 第二季' : '思想验证区域第二季',
          year: '2026',
        });
        if (entry === 'specified') {
          mockSearchParams.set('source', 'jisu');
          mockSearchParams.set('id', '151407');
          mockSearchParams.set('stype', 'tv');
        }
        window.history.replaceState(
          {},
          '',
          '/play?' + mockSearchParams.toString()
        );
        const original = global.fetch;
        global.fetch = jest.fn(
          (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.startsWith('/api/search?'))
              return Promise.resolve(
                response({
                  results: new URL(url, 'https://app.example').searchParams
                    .get('q')
                    ?.includes(' ')
                    ? sources.slice(0, 3)
                    : sources,
                })
              );
            if (url.startsWith('/api/detail?'))
              return Promise.resolve(response(sources[0]));
            return original(input, init);
          }
        );
        render(<PlayPage />);
        expect(
          await screen.findByTestId('episode-selector-sources')
        ).toHaveTextContent('线路29');
        expect(media()?.loadSource).toHaveBeenCalledWith(
          'https://video.example/one.m3u8'
        );
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/search?q=' + encodeURIComponent('思想验证区域第二季') + '&v=2',
          expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
      }
    );

    describe('30 second startup choices', () => {
      const emitNative = (event: string) => {
        mockArtPlayerInstance?.video.addEventListener?.mock.calls
          .filter(([name]) => name === event)
          .forEach(([, listener]) => listener());
      };
      async function readyWithoutFrame() {
        const startedAt = performance.now();
        requests(
          Promise.resolve(response({ results: [requested(), alternate()] })),
          Promise.resolve(response(requested()))
        );
        render(<PlayPage />);
        await screen.findByTestId('episode-selector-sources');
        act(() => {
          mockManifestParsedHandlers.at(-1)?.();
          mockArtPlayerEventHandlers.get('video:canplay')?.();
        });
        return startedAt;
      }
      const expire = async (ms = 30_000) => {
        await act(async () => {
          jest.advanceTimersByTime(ms);
          await Promise.resolve();
        });
      };

      it('offers all three actions before a player exists, aborts requests and ignores late results', async () => {
        const search = deferred<Response>();
        const detail = deferred<Response>();
        requests(search.promise, detail.promise);
        render(<PlayPage />);
        await expire(29_999);
        expect(screen.queryByRole('button', { name: '继续尝试' })).toBeNull();
        await expire(1);
        expect(
          screen.getByText('这次连接已等待 30 秒，暂未开始播放。')
        ).toBeVisible();
        for (const name of ['继续尝试', '手动换线', '返回'])
          expect(screen.getByRole('button', { name })).toBeEnabled();
        const startupRequests = jest
          .mocked(global.fetch)
          .mock.calls.filter(([url]) =>
            /api\/(search|detail)/.test(String(url))
          );
        expect(startupRequests).toHaveLength(2);
        expect(startupRequests.every(([, init]) => init?.signal?.aborted)).toBe(
          true
        );
        await act(async () => {
          detail.resolve(response(requested()));
          search.resolve(response({ results: [requested(), alternate()] }));
        });
        expect(media()).toBeUndefined();
        expect(screen.getByRole('button', { name: '继续尝试' })).toBeVisible();
        expect(
          qualityRecords().some(
            (r) => r.rowKind === 'round' && r.outcome === 'budget-exhausted'
          )
        ).toBe(true);
      });

      it('continues initialization in the same quality chain and grants one new 30 second round', async () => {
        const search = deferred<Response>();
        const detail = deferred<Response>();
        const original = global.fetch;
        let details = 0;
        let searches = 0;
        global.fetch = jest.fn(
          (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).startsWith('/api/search'))
              return ++searches === 1
                ? search.promise
                : Promise.resolve(response({ results: [requested()] }));
            if (String(input).startsWith('/api/detail'))
              return ++details === 1
                ? detail.promise
                : Promise.resolve(response(requested()));
            return original(input, init);
          }
        );
        render(<PlayPage />);
        await expire();
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: '继续尝试' }));
        });
        expect(media()?.loadSource).toHaveBeenCalledWith(
          requested().episodes[0]
        );
        const rounds = qualityRecords().filter((r) => r.rowKind === 'round');
        expect(new Set(rounds.map((r) => r.sessionId)).size).toBe(1);
        expect(
          rounds.some(
            (r) =>
              r.roundId === 1 &&
              r.outcome === 'budget-exhausted' &&
              r.promptChoice === 'continue' &&
              r.nextRoundId === 2
          )
        ).toBe(true);
        expect(
          rounds.some(
            (r) =>
              r.roundId === 2 &&
              r.rootRoundId === 1 &&
              r.roundReason === 'continue'
          )
        ).toBe(true);
      });

      it('retrieves an empty manual source list without autoplay and only plays after selection', async () => {
        const pending = deferred<Response>();
        const original = global.fetch;
        let searches = 0;
        global.fetch = jest.fn(
          (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).startsWith('/api/search'))
              return ++searches === 1
                ? pending.promise
                : Promise.resolve(response({ results: [alternate()] }));
            if (String(input).startsWith('/api/detail')) return pending.promise;
            return original(input, init);
          }
        );
        render(<PlayPage />);
        await expire();
        fireEvent.click(screen.getByRole('button', { name: '手动换线' }));
        expect(
          screen.getByText('暂未获取到线路，可重新获取线路或返回搜索。')
        ).toBeVisible();
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: '重新获取线路' }));
        });
        expect(
          screen.getByTestId('episode-selector-sources')
        ).toHaveTextContent('备用源');
        expect(screen.getByTestId('episode-selector-sources')).toHaveAttribute(
          'data-source',
          ''
        );
        expect(media()).toBeUndefined();
        await act(async () => {
          await mockSourceChangeHandler?.('alternate', '2', '详情影片');
        });
        expect(media()?.loadSource).toHaveBeenCalledWith(
          alternate().episodes[0]
        );
      });

      it('stops the current media at 30 seconds after canplay without a frame and resumes only on continue', async () => {
        await readyWithoutFrame();
        const video = mockArtPlayerInstance?.video;
        const oldHls = media();
        const oldManifest = mockManifestParsedHandlers.at(-1);
        const oldPlayerError = mockArtPlayerEventHandlers.get('error');
        await expire();
        expect(screen.getByRole('button', { name: '继续尝试' })).toBeVisible();
        expect(video?.pause).toHaveBeenCalled();
        const attempts = mockManifestParsedHandlers.length;
        const rememberedBefore = JSON.stringify(window.localStorage);
        const requestsBefore = jest.mocked(global.fetch).mock.calls.length;
        await act(async () => {
          oldManifest?.();
          mockArtPlayerEventHandlers.get('video:canplay')?.();
          emitNative('playing');
          emitNative('timeupdate');
          oldPlayerError?.();
        });
        expect(JSON.stringify(window.localStorage)).toBe(rememberedBefore);
        expect(
          jest
            .mocked(global.fetch)
            .mock.calls.slice(requestsBefore)
            .some(
              ([url, init]) =>
                String(url).startsWith('/api/source-feedback') &&
                JSON.parse(String(init?.body)).startupSuccess === false
            )
        ).toBe(false);
        expect(screen.getByRole('button', { name: '继续尝试' })).toBeVisible();
        expect(mockManifestParsedHandlers).toHaveLength(attempts);
        expect(
          qualityRecords().some(
            (r) => r.rowKind === 'source' && r.outcome === 'cancelled'
          )
        ).toBe(true);
        expect(
          qualityRecords().some((r) => r.outcome === 'source-timeout')
        ).toBe(false);
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: '继续尝试' }));
        });
        expect(media()).not.toBe(oldHls);
        expect(mockManifestParsedHandlers).toHaveLength(attempts + 1);
      });

      it('recreates the player on continue if its host was lost before the first frame', async () => {
        await readyWithoutFrame();
        const oldPlayer = mockArtPlayerInstance;
        await expire();
        oldPlayer?.template.$player.remove();
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: '继续尝试' }));
        });
        expect(mockArtPlayerInstance).not.toBe(oldPlayer);
        expect(media()?.loadSource).toHaveBeenCalledWith(
          requested().episodes[0]
        );
        act(() => {
          mockManifestParsedHandlers.at(-1)?.();
          mockArtPlayerEventHandlers.get('video:canplay')?.();
          emitNative('playing');
          if (mockArtPlayerInstance)
            mockArtPlayerInstance.video.currentTime = 1;
          emitNative('timeupdate');
        });
        await expire(31_000);
        expect(screen.queryByRole('button', { name: '继续尝试' })).toBeNull();
        expect(qualityRecords()).toContainEqual(
          expect.objectContaining({
            rowKind: 'round',
            roundId: 2,
            rootRoundId: 1,
            outcome: 'frame-ready',
          })
        );
        expect(qualityRecords()).toContainEqual(
          expect.objectContaining({
            rowKind: 'source',
            roundId: 2,
            attemptId: 2,
            outcome: 'frame-ready',
          })
        );
      });

      it('explicitly reloads the interrupted current line when manually selected', async () => {
        await readyWithoutFrame();
        const previous = media();
        await expire();
        fireEvent.click(screen.getByRole('button', { name: '手动换线' }));
        expect(screen.getByTestId('episode-selector-sources')).toHaveAttribute(
          'data-source',
          ''
        );
        await act(async () => {
          await mockSourceChangeHandler?.(
            'detail-source',
            'detail-id',
            '详情影片'
          );
        });
        expect(media()).not.toBe(previous);
        expect(media()?.loadSource).toHaveBeenCalledWith(
          requested().episodes[0]
        );
        act(() => {
          mockManifestParsedHandlers.at(-1)?.();
          mockArtPlayerEventHandlers.get('video:canplay')?.();
          emitNative('playing');
          if (mockArtPlayerInstance)
            mockArtPlayerInstance.video.currentTime = 1;
          emitNative('timeupdate');
        });
        await expire(31_000);
        expect(screen.queryByRole('button', { name: '继续尝试' })).toBeNull();
        expect(qualityRecords()).toContainEqual(
          expect.objectContaining({
            rowKind: 'round',
            roundId: 2,
            rootRoundId: 1,
            roundReason: 'manual-source',
            outcome: 'frame-ready',
          })
        );
      });

      it.each(['timer', 'blocked-main-thread'] as const)(
        'rejects a stale source probe across the budget boundary (%s) and a new round',
        async (boundary) => {
          const startedAt = await readyWithoutFrame();
          await expire(29_000 - (performance.now() - startedAt));
          const selected = mockSourceChangeHandler;
          const probe = deferred<void>();
          const selection = probe.promise.then(() =>
            selected?.('alternate', '2', '详情影片')
          );
          const attempts = mockManifestParsedHandlers.length;
          const clock =
            boundary === 'blocked-main-thread'
              ? jest
                  .spyOn(performance, 'now')
                  .mockReturnValue(startedAt + 31_000)
              : null;
          if (!clock) await expire(1000);
          try {
            await act(async () => {
              probe.resolve();
              await selection;
            });
          } finally {
            clock?.mockRestore();
          }
          expect(
            screen.getByRole('button', { name: '继续尝试' })
          ).toBeVisible();
          expect(mockManifestParsedHandlers).toHaveLength(attempts);
          expect(qualityRecords().every((r) => r.roundId === 1)).toBe(true);
          await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '继续尝试' }));
          });
          const newAttempts = mockManifestParsedHandlers.length;
          await act(async () => {
            expect(await selected?.('alternate', '2', '详情影片')).toBe(false);
          });
          expect(mockManifestParsedHandlers).toHaveLength(newAttempts);
          expect(qualityRecords().every((r) => r.roundId <= 2)).toBe(true);
        }
      );

      it.each(['pause', 'hidden'] as const)(
        'preserves the last second while %s and expires only after returning',
        async (kind) => {
          const startedAt = await readyWithoutFrame();
          await expire(29_000 - (performance.now() - startedAt));
          act(() => {
            if (kind === 'hidden') {
              Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                value: 'hidden',
              });
              document.dispatchEvent(new Event('visibilitychange'));
            } else {
              if (mockArtPlayerInstance)
                mockArtPlayerInstance.video.paused = true;
              mockArtPlayerEventHandlers.get('video:pause')?.();
            }
          });
          await expire(60_000);
          expect(screen.queryByRole('button', { name: '继续尝试' })).toBeNull();
          act(() => {
            if (kind === 'hidden') {
              Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                value: 'visible',
              });
              document.dispatchEvent(new Event('visibilitychange'));
            } else {
              if (mockArtPlayerInstance)
                mockArtPlayerInstance.video.paused = false;
              mockArtPlayerEventHandlers.get('video:play')?.();
            }
          });
          await expire(999);
          expect(screen.queryByRole('button', { name: '继续尝试' })).toBeNull();
          await expire(1);
          expect(
            screen.getByRole('button', { name: '继续尝试' })
          ).toBeVisible();
        }
      );

      it('does not charge silent autoplay waiting, and stops the budget only after a real frame', async () => {
        await readyWithoutFrame();
        const video = mockArtPlayerInstance?.video;
        if (!video) throw new Error('video missing');
        video.paused = true;
        await act(async () => {
          emitNative('canplay');
          jest.advanceTimersByTime(0);
        });
        await expire(60_000);
        expect(screen.queryByRole('button', { name: '继续尝试' })).toBeNull();
        act(() => {
          video.paused = false;
          mockArtPlayerEventHandlers.get('video:play')?.();
          emitNative('playing');
          video.currentTime = 1;
          emitNative('timeupdate');
        });
        expect(
          qualityRecords().some(
            (r) => r.rowKind === 'round' && r.outcome === 'frame-ready'
          )
        ).toBe(true);
        await expire(60_000);
        expect(screen.queryByRole('button', { name: '继续尝试' })).toBeNull();
      });

      it('limits consecutive source attempts to the initial 30 seconds and never loads a fourth source', async () => {
        const sources = [
          requested(),
          alternate(),
          alternate(),
          alternate(),
        ].map((source, index) => ({
          ...source,
          source: `candidate-${index}`,
          id: String(index),
          episodes: [`https://candidate-${index}.example/episode.m3u8`],
        }));
        sources[0] = requested();
        requests(
          Promise.resolve(response({ results: sources })),
          Promise.resolve(response(requested()))
        );
        render(<PlayPage />);
        await screen.findByTestId('episode-selector-sources');
        await expire(10_000);
        await expire(10_000);
        await expire(10_000);
        expect(screen.getByRole('button', { name: '继续尝试' })).toBeVisible();
        expect(mockManifestParsedHandlers.length).toBeLessThanOrEqual(3);
        const attempts = mockManifestParsedHandlers.length;
        await expire(60_000);
        expect(mockManifestParsedHandlers).toHaveLength(attempts);
      });

      it('records leave once and does not start any extra source', async () => {
        const pending = deferred<Response>();
        requests(pending.promise, pending.promise);
        render(<PlayPage />);
        await expire();
        fireEvent.click(screen.getByRole('button', { name: '返回' }));
        expect(mockRouterBack).toHaveBeenCalledTimes(1);
        expect(
          qualityRecords().some(
            (r) =>
              r.rowKind === 'round' &&
              r.outcome === 'budget-exhausted' &&
              r.promptChoice === 'leave'
          )
        ).toBe(true);
        expect(media()).toBeUndefined();
      });
    });

    it('starts media while search is pending, but waits for history before choosing episode and resume', async () => {
      const search = deferred<Response>();
      const detail = deferred<Response>();
      const history = deferred<Awaited<ReturnType<typeof getAllPlayRecords>>>();
      mockedGetAllPlayRecords.mockReturnValue(history.promise);
      requests(search.promise, detail.promise);
      render(<PlayPage />);
      expect(mockedGetAllPlayRecords).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/search'),
        expect.anything()
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/detail'),
        expect.anything()
      );
      await act(async () => {
        detail.resolve(response(requested()));
      });
      expect(media()).toBeUndefined();
      await act(async () => {
        history.resolve({
          'detail-source+detail-id': {
            title: '详情影片',
            year: '2026',
            source_name: '详情源',
            cover: '',
            index: 2,
            total_episodes: 2,
            play_time: 96,
            total_time: 240,
            save_time: Date.now(),
            search_title: '详情影片',
          },
        });
      });
      expect(media()?.loadSource).toHaveBeenCalledWith(
        'https://example.com/two.m3u8'
      );
      act(() => {
        mockManifestParsedHandlers.at(-1)?.();
        mockArtPlayerEventHandlers.get('video:canplay')?.();
      });
      expect(mockArtPlayerInstance?.currentTime).toBe(94.5);
      expect(qualityRecords().length).toBeGreaterThan(0);
      expect(
        qualityRecords().every(
          (record) => record.policyVersion === 'startup-budget-v1'
        )
      ).toBe(true);
      const attempts = mockManifestParsedHandlers.length;
      if (mockArtPlayerInstance) mockArtPlayerInstance.currentTime = 110;
      await act(async () => {
        search.resolve(
          response({ results: [requested(), requested(), alternate()] })
        );
      });
      expect(screen.getByTestId('episode-selector-sources').textContent).toBe(
        '详情源,备用源'
      );
      expect(mockManifestParsedHandlers).toHaveLength(attempts);
      expect(mockArtPlayerInstance?.currentTime).toBe(110);
    });

    it.each([
      { first: 'search', fromHistory: true },
      { first: 'detail', fromHistory: true },
      { first: 'search', fromHistory: false },
      { first: 'detail', fromHistory: false },
    ])(
      'waits for the other response when $first is missing the resumed episode (history entry: $fromHistory)',
      async ({ first, fromHistory }) => {
        if (fromHistory) mockSearchParams.set('from', 'playrecord');
        mockedGetAllPlayRecords.mockResolvedValue({
          'detail-source+detail-id': {
            title: '详情影片',
            year: '2026',
            source_name: '详情源',
            cover: '',
            index: 2,
            total_episodes: 2,
            play_time: 96,
            total_time: 240,
            save_time: Date.now(),
            search_title: '详情影片',
          },
        });
        const incomplete = createSource({
          episodes: [requested().episodes[0]],
        });
        const pending = deferred<Response>();
        requests(
          first === 'search'
            ? Promise.resolve(response({ results: [incomplete] }))
            : pending.promise,
          first === 'detail'
            ? Promise.resolve(response(incomplete))
            : pending.promise
        );
        render(<PlayPage />);
        await act(async () => {
          for (let i = 0; i < 12; i += 1) await Promise.resolve();
        });
        expect(media()).toBeUndefined();
        await act(async () => {
          pending.resolve(
            response(
              first === 'search' ? requested() : { results: [requested()] }
            )
          );
        });
        expect(media()?.loadSource).toHaveBeenCalledWith(
          requested().episodes[1]
        );
        expect(
          screen.queryByRole('heading', { name: '历史播放源已失效' })
        ).toBeNull();
      }
    );

    it.each(['missing-episode', 'remembered-unavailable'])(
      'waits for same-episode history fallback for %s',
      async (reason) => {
        mockSearchParams.set('from', 'playrecord');
        mockedGetAllPlayRecords.mockResolvedValue({
          'detail-source+detail-id': {
            title: '详情影片',
            year: '2026',
            source_name: '详情源',
            cover: '',
            index: 2,
            total_episodes: 2,
            play_time: 96,
            total_time: 240,
            save_time: Date.now(),
            search_title: '详情影片',
          },
        });
        const target =
          reason === 'missing-episode'
            ? createSource({ episodes: [requested().episodes[0]] })
            : requested();
        if (reason === 'remembered-unavailable') {
          rememberSourcePlaybackQuality(
            'detail-source-detail-id',
            'example.com',
            { mode: 'unavailable' }
          );
        }
        const search = deferred<Response>();
        requests(search.promise, Promise.resolve(response(target)));
        render(<PlayPage />);
        await act(async () => {
          for (let i = 0; i < 12; i += 1) await Promise.resolve();
        });
        expect(media()).toBeUndefined();
        await act(async () => {
          search.resolve(response({ results: [alternate()] }));
        });
        expect(media()?.loadSource).toHaveBeenCalledWith(
          alternate().episodes[1]
        );
        act(() => {
          mockManifestParsedHandlers.at(-1)?.();
          mockArtPlayerEventHandlers.get('video:canplay')?.();
        });
        expect(mockArtPlayerInstance?.currentTime).toBe(94.5);
      }
    );

    it('ignores detail, history and search that resolve after leaving the page', async () => {
      const search = deferred<Response>();
      const detail = deferred<Response>();
      const history = deferred<Awaited<ReturnType<typeof getAllPlayRecords>>>();
      mockedGetAllPlayRecords.mockReturnValue(history.promise);
      requests(search.promise, detail.promise);
      const view = render(<PlayPage />);
      view.unmount();
      await act(async () => {
        detail.resolve(response(requested()));
        history.resolve({});
        search.resolve(response({ results: [requested(), alternate()] }));
      });
      expect(mockManifestParsedHandlers).toHaveLength(0);
      expect(media()).toBeUndefined();
    });

    it('uses a faster search match and ignores a late detail after the user changes source', async () => {
      const detail = deferred<Response>();
      requests(
        Promise.resolve(response({ results: [requested(), alternate()] })),
        detail.promise
      );
      render(<PlayPage />);
      await screen.findByTestId('episode-selector-sources');
      expect(media()?.loadSource).toHaveBeenCalledWith(requested().episodes[0]);
      await act(async () => {
        await mockSourceChangeHandler?.('alternate', '2', '详情影片');
      });
      const attempts = mockManifestParsedHandlers.length;
      await act(async () => {
        detail.resolve(response(requested()));
      });
      expect(screen.getByTestId('episode-selector-sources')).toHaveAttribute(
        'data-source',
        'alternate'
      );
      expect(mockManifestParsedHandlers).toHaveLength(attempts);
      expect(new URL(window.location.href).searchParams.get('source')).toBe(
        'alternate'
      );
    });

    it.each(['search', 'detail'])(
      'keeps waiting when %s fails before the other branch succeeds',
      async (failed) => {
        const pending = deferred<Response>();
        requests(
          failed === 'search'
            ? Promise.resolve(response({}, false))
            : pending.promise,
          failed === 'detail'
            ? Promise.resolve(response({}, false))
            : pending.promise
        );
        render(<PlayPage />);
        await act(async () => {
          await Promise.resolve();
        });
        expect(media()).toBeUndefined();
        await act(async () => {
          pending.resolve(
            response(
              failed === 'search' ? requested() : { results: [requested()] }
            )
          );
        });
        expect(media()?.loadSource).toHaveBeenCalledWith(
          requested().episodes[0]
        );
      }
    );

    it('retains the playing source when the background search fails', async () => {
      const search = deferred<Response>();
      requests(search.promise, Promise.resolve(response(requested())));
      render(<PlayPage />);
      await screen.findByTestId('episode-selector-sources');
      const attempts = mockManifestParsedHandlers.length;
      await act(async () => {
        search.resolve(response({}, false));
      });
      expect(screen.getByTestId('episode-selector-sources')).toHaveTextContent(
        '详情源'
      );
      expect(mockManifestParsedHandlers).toHaveLength(attempts);
    });

    it('keeps the selected episode when candidates arrive after an episode change', async () => {
      const search = deferred<Response>();
      requests(search.promise, Promise.resolve(response(requested())));
      render(<PlayPage />);
      await screen.findByTestId('episode-selector-sources');
      await act(async () => {
        mockEpisodeChangeHandler?.(2);
      });
      const attempts = mockManifestParsedHandlers.length;
      await act(async () => {
        search.resolve(response({ results: [requested(), alternate()] }));
      });
      expect(screen.getByTestId('episode-selector-sources')).toHaveAttribute(
        'data-episode',
        '2'
      );
      expect(media()?.loadSource).toHaveBeenLastCalledWith(
        requested().episodes[1]
      );
      expect(mockManifestParsedHandlers).toHaveLength(attempts);
    });

    it('preserves pending search across an internal URL rewrite and aborts it on unmount', async () => {
      const search = deferred<Response>();
      requests(
        search.promise,
        Promise.resolve(response(createSource({ title: '详情影片新版' })))
      );
      const view = render(<PlayPage />);
      await screen.findByTestId('episode-selector-sources');
      const searchCall = jest
        .mocked(global.fetch)
        .mock.calls.find(([url]) => url.toString().startsWith('/api/search'));
      const signal = searchCall?.[1]?.signal;
      mockSearchParams = new URLSearchParams(window.location.search);
      view.rerender(<PlayPage />);
      expect(signal?.aborted).toBe(false);
      await act(async () => {
        search.resolve(response({ results: [alternate()] }));
      });
      expect(screen.getByTestId('episode-selector-sources')).toHaveTextContent(
        '备用源'
      );
      view.unmount();
      expect(signal?.aborted).toBe(true);
    });

    it('ignores old search results after navigating to another title', async () => {
      const search = deferred<Response>();
      requests(search.promise, Promise.resolve(response(requested())));
      const view = render(<PlayPage />);
      await screen.findByTestId('episode-selector-sources');
      const oldSignal = jest
        .mocked(global.fetch)
        .mock.calls.find(([url]) =>
          url.toString().startsWith('/api/search')
        )?.[1]?.signal;
      mockSearchParams = new URLSearchParams('source=new&id=3&title=新片');
      requests(
        Promise.resolve(response({ results: [] })),
        Promise.resolve(
          response(
            createSource({
              source: 'new',
              id: '3',
              title: '新片',
              source_name: '新线路',
            })
          )
        )
      );
      view.rerender(<PlayPage />);
      await waitFor(() =>
        expect(
          screen.getByTestId('episode-selector-sources')
        ).toHaveTextContent('新线路')
      );
      expect(oldSignal?.aborted).toBe(true);
      await act(async () => {
        search.resolve(response({ results: [alternate()] }));
      });
      expect(
        screen.getByTestId('episode-selector-sources')
      ).not.toHaveTextContent('备用源');
    });

    it('defers exhaustion after the first timeout until late candidates can recover', async () => {
      const search = deferred<Response>();
      requests(search.promise, Promise.resolve(response(requested())));
      render(<PlayPage />);
      await screen.findByTestId('episode-selector-sources');
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
      expect(
        screen.queryByRole('heading', { name: '当前线路无法继续恢复' })
      ).toBeNull();
      expect(
        qualityRecords().some(
          (r) => r.rowKind === 'round' && r.status === 'terminal'
        )
      ).toBe(false);
      await act(async () => {
        search.resolve(response({ results: [alternate()] }));
      });
      expect(screen.getByTestId('episode-selector-sources')).toHaveAttribute(
        'data-source',
        'alternate'
      );
      expect(media()?.loadSource).toHaveBeenCalledWith(alternate().episodes[0]);
      expect(
        qualityRecords().some(
          (r) => r.rowKind === 'round' && r.outcome === 'failed'
        )
      ).toBe(false);
    });

    it('waits for full search for prefer=true and keeps its existing initial selection', async () => {
      mockSearchParams.set('prefer', 'true');
      const search = deferred<Response>();
      requests(search.promise, Promise.resolve(response(requested())));
      render(<PlayPage />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(media()).toBeUndefined();
      expect(
        jest
          .mocked(global.fetch)
          .mock.calls.some(([url]) => url.toString().startsWith('/api/detail'))
      ).toBe(false);
      await act(async () => {
        search.resolve(response({ results: [requested(), alternate()] }));
      });
      expect(media()?.loadSource).toHaveBeenCalledWith(requested().episodes[0]);
    });

    it.each([true, false])(
      'shows missing-episode copy when the saved route exists: %s',
      async (detailExists) => {
        mockSearchParams.set('from', 'playrecord');
        mockedGetAllPlayRecords.mockResolvedValue({
          'detail-source+detail-id': {
            title: '详情影片',
            year: '2026',
            source_name: '详情源',
            cover: '',
            index: 3,
            total_episodes: 3,
            play_time: 96,
            total_time: 240,
            save_time: Date.now(),
            search_title: '详情影片',
          },
        });
        requests(
          Promise.resolve(response({ results: [alternate()] })),
          Promise.resolve(
            response(detailExists ? requested() : {}, detailExists)
          )
        );
        render(<PlayPage />);
        await screen.findByRole('heading', { name: '暂未找到这一集' });
        expect(screen.getByText('目标集暂不可用')).toBeVisible();
        expect(screen.getByText('当前线路及候选暂未提供第 3 集')).toBeVisible();
        expect(screen.queryByText('历史记录已过期')).toBeNull();
        expect(screen.queryByText(/资源可能已经下架/)).toBeNull();
        expect(screen.getByRole('button', { name: '重新尝试' })).toBeEnabled();
        expect(screen.getByRole('button', { name: '搜索片名' })).toBeEnabled();
        expect(media()).toBeUndefined();
      }
    );

    it('retains expired-history copy when neither details nor replacement resources exist', async () => {
      mockSearchParams.set('from', 'playrecord');
      requests(
        Promise.resolve(response({ results: [] })),
        Promise.resolve(response({}, false))
      );
      render(<PlayPage />);
      await screen.findByRole('heading', { name: '旧播放记录暂时不可用' });
      expect(screen.getByText('历史记录已过期')).toBeVisible();
      expect(screen.queryByText('目标集暂不可用')).toBeNull();
      expect(media()).toBeUndefined();
    });

    it('does not silently choose another source for an invalid non-history direct entry', async () => {
      requests(
        Promise.resolve(response({ results: [alternate()] })),
        Promise.resolve(response({}, false))
      );
      render(<PlayPage />);
      await screen.findByRole('heading', { name: '未找到匹配结果' });
      expect(media()).toBeUndefined();
    });
  });

  it('syncs available sources from detail fallback after search misses the current source', async () => {
    render(<PlayPage />);
    await settlePlayPage();
  });

  it('keeps metadata enrichment in one quality session and mints one attempt per actual source switch', async () => {
    const originalFetch = global.fetch;
    const initial = createSource();
    const alternate = createSource({
      source: 'alternate',
      id: '2',
      source_name: '备用源',
      episodes: ['https://example.com/alternate.m3u8'],
    });
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input.toString().startsWith('/api/search')) {
          return {
            ok: true,
            json: async () => ({ results: [initial, alternate] }),
          } as Response;
        }
        return originalFetch(input, init);
      }
    );
    render(<PlayPage />);
    await screen.findByTestId('episode-selector-sources');
    await act(async () => {
      await Promise.resolve();
    });
    if (!mockSourceChangeHandler) throw new Error('source handler not created');
    await act(async () => {
      await mockSourceChangeHandler?.('alternate', '2', alternate.title);
      await Promise.resolve();
    });
    const records = jest
      .mocked(global.fetch)
      .mock.calls.flatMap(([url, init]) =>
        url === '/api/playback-quality' && typeof init?.body === 'string'
          ? playbackQualityPayloadSchema.parse(JSON.parse(init.body)).records
          : []
      );
    expect(new Set(records.map((record) => record.sessionId)).size).toBe(1);
    expect(
      new Set(
        records
          .filter((record) => record.rowKind === 'source')
          .map((record) => record.attemptId)
      )
    ).toEqual(new Set([1, 2]));
    expect(
      records.some(
        (record) =>
          record.status === 'terminal' && record.outcome === 'frame-ready'
      )
    ).toBe(false);
  });

  it('continues collecting when a failed startup is manually switched to another source', async () => {
    const originalFetch = global.fetch;
    const alternate = createSource({
      source: 'alternate',
      id: '2',
      source_name: '备用源',
      episodes: ['https://example.com/alternate.m3u8'],
    });
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input.toString().startsWith('/api/search'))
          return {
            ok: true,
            json: async () => ({ results: [createSource(), alternate] }),
          } as Response;
        return originalFetch(input, init);
      }
    );
    const reducer = jest.mocked(reducePlaybackSession);
    const actual = jest.requireActual<typeof import('@/lib/playback-session')>(
      '@/lib/playback-session'
    );
    reducer.mockImplementation((state, event) =>
      event.type === 'recovery.runtimeEvidence'
        ? {
            state,
            effects: [
              {
                type: 'showInPlayerFailure',
                reason: 'recovery-exhausted',
                actions: ['retry', 'switch-source', 'leave'],
              },
            ],
          }
        : actual.reducePlaybackSession(state, event)
    );
    try {
      render(<PlayPage />);
      await screen.findByTestId('episode-selector-sources');
      await act(async () => {
        await Promise.resolve();
        mockArtPlayerEventHandlers.get('video:canplay')?.();
      });
      await act(async () => {
        mockArtPlayerEventHandlers.get('error')?.(new Error('source failed'));
        await Promise.resolve();
      });
      await act(async () => {
        await mockSourceChangeHandler?.('alternate', '2', alternate.title);
        await Promise.resolve();
      });
      const records = jest
        .mocked(global.fetch)
        .mock.calls.flatMap(([url, init]) =>
          url === '/api/playback-quality' && typeof init?.body === 'string'
            ? playbackQualityPayloadSchema.parse(JSON.parse(init.body)).records
            : []
        );
      expect(records).toContainEqual(
        expect.objectContaining({
          rowKind: 'round',
          roundId: 1,
          outcome: 'failed',
        })
      );
      expect(records).toContainEqual(
        expect.objectContaining({
          rowKind: 'source',
          roundId: 2,
          rootRoundId: 1,
          sourceKey: 'alternate-2',
          status: 'pending',
        })
      );
    } finally {
      reducer.mockImplementation(actual.reducePlaybackSession);
    }
  });

  it('does not count a mid-play retry as another startup after the first frame', async () => {
    const reducer = jest.mocked(reducePlaybackSession);
    const actual = jest.requireActual<typeof import('@/lib/playback-session')>(
      '@/lib/playback-session'
    );
    reducer.mockImplementation((state, event) =>
      event.type === 'recovery.runtimeEvidence'
        ? {
            state,
            effects: [
              {
                type: 'showInPlayerFailure',
                reason: 'recovery-exhausted',
                actions: ['retry', 'switch-source', 'leave'],
              },
            ],
          }
        : actual.reducePlaybackSession(state, event)
    );
    const records = () =>
      jest
        .mocked(global.fetch)
        .mock.calls.flatMap(([url, init]) =>
          url === '/api/playback-quality' && typeof init?.body === 'string'
            ? playbackQualityPayloadSchema.parse(JSON.parse(init.body)).records
            : []
        );
    try {
      render(<PlayPage />);
      await settlePlayPage();
      await act(async () => {
        mockArtPlayerEventHandlers.get('video:canplay')?.();
      });
      const video = mockArtPlayerInstance?.video;
      if (!video) throw new Error('video not created');
      await act(async () => {
        video.addEventListener?.mock.calls
          .filter(([event]) => event === 'playing')
          .forEach(([, fn]) => fn());
        video.currentTime = 0.2;
        video.addEventListener?.mock.calls
          .filter(([event]) => event === 'timeupdate')
          .forEach(([, fn]) => fn());
        await Promise.resolve();
      });
      expect(records()).toContainEqual(
        expect.objectContaining({ rowKind: 'round', outcome: 'frame-ready' })
      );
      const pendingBefore = records().filter(
        (r) => r.status === 'pending'
      ).length;
      await act(async () => {
        mockArtPlayerEventHandlers.get('error')?.(new Error('mid-play failed'));
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole('button', { name: /重试/ }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(records().filter((r) => r.status === 'pending')).toHaveLength(
        pendingBefore
      );
    } finally {
      reducer.mockImplementation(actual.reducePlaybackSession);
    }
  });

  it('ends the preparation transition when the player reaches canplay', async () => {
    render(<PlayPage />);
    await settlePlayPage();

    act(() => {
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });

    expect(mockMarkPreparationFrameReady).toHaveBeenCalledTimes(1);
  });

  it('does not pin or restore player control focus after controls become idle', async () => {
    mockSearchParams.set('tv', '1');
    render(<PlayPage />);
    await settlePlayPage();

    const player = mockArtPlayerInstance;
    if (!player) throw new Error('player was not created');
    const playControl = player.template.$player.querySelector<HTMLElement>(
      '.art-control-playAndPause'
    );
    const fullscreenControl =
      player.template.$player.querySelector<HTMLElement>(
        '.art-control-fullscreenWeb'
      );
    const volumeControl = player.template.$player.querySelector<HTMLElement>(
      '.art-control-volume'
    );
    const nextEpisodeControl =
      player.template.$player.querySelector<HTMLElement>(
        '.art-control-nextEpisode'
      );
    const settingControl = player.template.$player.querySelector<HTMLElement>(
      '.art-control-setting'
    );
    if (!playControl) throw new Error('play control was not created');
    if (!fullscreenControl)
      throw new Error('fullscreen control was not created');
    if (!volumeControl) throw new Error('volume control was not created');
    if (!nextEpisodeControl)
      throw new Error('next episode control was not created');
    if (!settingControl) throw new Error('setting control was not created');
    playControl.scrollIntoView = jest.fn();
    volumeControl.scrollIntoView = jest.fn();
    nextEpisodeControl.scrollIntoView = jest.fn();
    settingControl.scrollIntoView = jest.fn();
    fullscreenControl.scrollIntoView = jest.fn();

    act(() => {
      mockArtPlayerEventHandlers.get('ready')?.();
    });
    expect(document.activeElement).toBe(document.body);
    expect(player.controls.isHover).toBe(false);

    act(() => {
      playControl.focus();
    });
    expect(player.controls.isHover).toBe(false);

    player.controls.show = false;
    player.fullscreen = true;
    act(() => {
      playControl.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
      jest.advanceTimersByTime(20);
    });
    expect(player.controls.show).toBe(true);
    expect(document.activeElement).toBe(playControl);

    const onPlayControlClick = jest.fn();
    const onVolumeControlClick = jest.fn();
    const onNextEpisodeControlClick = jest.fn();
    const onSettingControlClick = jest.fn();
    const onFullscreenControlClick = jest.fn();
    playControl
      .querySelector('.art-icon-play')
      ?.addEventListener('click', onPlayControlClick);
    volumeControl
      .querySelector('.art-icon-volume')
      ?.addEventListener('click', onVolumeControlClick);
    nextEpisodeControl.addEventListener('click', onNextEpisodeControlClick);
    settingControl.addEventListener('click', onSettingControlClick);
    fullscreenControl.addEventListener('click', onFullscreenControlClick);
    act(() => {
      player.template.$player.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });
    expect(onPlayControlClick).toHaveBeenCalledTimes(1);

    act(() => {
      fullscreenControl.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 0 })
      );
    });
    expect(onPlayControlClick).toHaveBeenCalledTimes(1);
    expect(onFullscreenControlClick).not.toHaveBeenCalled();

    act(() => {
      const pointerDown = new Event('pointerdown', { bubbles: true });
      Object.defineProperty(pointerDown, 'pointerType', { value: '' });
      fullscreenControl.dispatchEvent(pointerDown);
      player.template.$player.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });
    expect(onPlayControlClick).toHaveBeenCalledTimes(2);

    for (const [control, listener] of [
      [volumeControl, onVolumeControlClick],
      [nextEpisodeControl, onNextEpisodeControlClick],
      [settingControl, onSettingControlClick],
      [fullscreenControl, onFullscreenControlClick],
    ] as const) {
      act(() => {
        control.focus();
        const pointerDown = new Event('pointerdown', { bubbles: true });
        Object.defineProperty(pointerDown, 'pointerType', { value: '' });
        playControl.dispatchEvent(pointerDown);
        player.template.$player.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
      });
      expect(listener).toHaveBeenCalledTimes(1);
    }

    act(() => {
      playControl.focus();
      const pointerDown = new Event('pointerdown', { bubbles: true });
      Object.defineProperty(pointerDown, 'pointerType', { value: '' });
      fullscreenControl.dispatchEvent(pointerDown);
      fullscreenControl.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 0 })
      );
    });
    expect(onPlayControlClick).toHaveBeenCalledTimes(3);
    expect(onFullscreenControlClick).toHaveBeenCalledTimes(1);

    act(() => {
      playControl.blur();
      mockArtPlayerEventHandlers.get('video:timeupdate')?.();
    });
    expect(document.activeElement).toBe(document.body);
  });

  it('keeps fullscreen focus visible and activates the visible control on pointer-only confirmation', async () => {
    mockSearchParams.set('tv', '1');
    render(<PlayPage />);
    await settlePlayPage();

    const player = mockArtPlayerInstance;
    if (!player) throw new Error('player was not created');
    const element = player.template.$player;
    const host = element.parentElement;
    const volume = element.querySelector<HTMLElement>('.art-control-volume');
    const next = element.querySelector<HTMLElement>('.art-control-nextEpisode');
    if (!volume || !next) throw new Error('controls were not created');
    volume.scrollIntoView = jest.fn();
    next.scrollIntoView = jest.fn();
    const onMute = jest.fn();
    const onNext = jest.fn();
    volume.querySelector('.art-icon-volume')?.addEventListener('click', onMute);
    next.addEventListener('click', onNext);
    const css = readFileSync(
      join(process.cwd(), 'src/styles/globals.css'),
      'utf8'
    );
    const style = document.createElement('style');
    style.textContent = css.slice(
      css.indexOf("  [data-tv-mode='true']"),
      css.lastIndexOf('}')
    );
    document.head.appendChild(style);

    try {
      act(() => {
        mockArtPlayerEventHandlers.get('ready')?.();
        document.body.appendChild(element);
        volume.focus();
      });
      expect(element.dataset.tvMode).toBe('true');
      expect(getComputedStyle(volume).outline).toContain('4px');
      act(() => {
        const pointerDown = new Event('pointerdown', { bubbles: true });
        Object.defineProperty(pointerDown, 'pointerType', { value: '' });
        next.dispatchEvent(pointerDown);
        next.dispatchEvent(
          new MouseEvent('click', { bubbles: true, detail: 1 })
        );
      });
      expect(onMute).toHaveBeenCalledTimes(1);
      expect(onNext).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(volume);
      act(() => {
        next.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
        next.dispatchEvent(
          new MouseEvent('click', { bubbles: true, detail: 0 })
        );
      });
      expect(onMute).toHaveBeenCalledTimes(2);
      expect(onNext).not.toHaveBeenCalled();
      act(() => {
        element.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
        );
      });
      expect(document.activeElement).toBe(next);
      expect(getComputedStyle(next).outline).toContain('4px');
    } finally {
      style.remove();
      host?.appendChild(element);
    }
  });

  it('uses webpage fullscreen and lets the remote leave progress after seeking', async () => {
    mockSearchParams.set('tv', '1');
    render(<PlayPage />);
    await settlePlayPage();
    const player = mockArtPlayerInstance;
    if (!player) throw new Error('player was not created');
    const element = player.template.$player;
    const volume = element.querySelector<HTMLElement>('.art-control-volume');
    const progress = element.querySelector<HTMLElement>(
      '.art-control-progress'
    );
    const fullscreen = element.querySelector<HTMLElement>(
      '.art-control-fullscreen'
    );
    const fullscreenWeb = element.querySelector<HTMLElement>(
      '.art-control-fullscreenWeb'
    );
    const volumeIcon = volume?.querySelector<HTMLElement>('.art-icon-volume');
    if (!volume || !volumeIcon || !progress || !fullscreen || !fullscreenWeb)
      throw new Error('controls were not created');
    volume.scrollIntoView = jest.fn();
    progress.scrollIntoView = jest.fn();
    volumeIcon.scrollIntoView = jest.fn();
    fullscreenWeb.scrollIntoView = jest.fn();
    const onMute = jest.fn();
    volume.querySelector('.art-icon-volume')?.addEventListener('click', onMute);
    fullscreenWeb.addEventListener('click', () => {
      player.fullscreenWeb = true;
    });
    act(() => {
      mockArtPlayerEventHandlers.get('ready')?.();
    });
    expect(fullscreen.style.display).toBe('none');
    act(() => {
      fullscreenWeb.focus();
      fullscreenWeb.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });
    expect(player.fullscreenWeb).toBe(true);
    expect(player.fullscreen).toBe(false);
    act(() => {
      volumeIcon.tabIndex = 0;
      volumeIcon.focus();
    });
    expect(document.activeElement).toBe(volume);
    player.currentTime = 50;
    act(() => {
      volume.focus();
      volume.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
      );
    });
    expect(document.activeElement).toBe(progress);
    act(() => {
      progress.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
      );
    });
    expect(player.currentTime).toBe(40);
    act(() => {
      progress.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
    });
    expect(document.activeElement).toBe(volume);
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });
    expect(onMute).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'preserves real ArtPlayer idle hiding and confirmation with TV mode %s',
    async (tvMode) => {
      mockUseRealArtPlayer = true;
      if (tvMode) mockSearchParams.set('tv', '1');
      render(<PlayPage />);
      await settlePlayPage();
      const player = mockArtPlayerInstance;
      if (!player?.emit) throw new Error('real player was not created');
      const emit = player.emit.bind(player);
      const element = player.template.$player;
      const volume = element.querySelector<HTMLElement>('.art-control-volume');
      if (!volume) throw new Error('volume control was not created');
      element
        .querySelectorAll<HTMLElement>('.art-control, .art-icon')
        .forEach((control) => {
          control.scrollIntoView = jest.fn();
        });
      try {
        act(() => {
          emit('ready');
          player.fullscreenWeb = true;
          jest.advanceTimersByTime(20);
          volume.focus();
          volume.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
          const pointerDown = new Event('pointerdown', { bubbles: true });
          Object.defineProperty(pointerDown, 'pointerType', { value: '' });
          element.dispatchEvent(pointerDown);
          element.dispatchEvent(
            new MouseEvent('click', { bubbles: true, detail: 1 })
          );
        });
        expect(player.video.muted).toBe(tvMode);
        act(() => {
          jest.advanceTimersByTime(4000);
          emit('video:timeupdate');
        });
        expect(player.controls.show).toBe(!tvMode);
        if (!tvMode) return;
        expect(document.activeElement).toBe(volume);
        act(() => {
          volume.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
          );
          jest.advanceTimersByTime(20);
        });
        expect(player.controls.show).toBe(true);
        expect(document.activeElement).toBe(volume);
        act(() => {
          volume.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
          );
        });
        expect(player.video.muted).toBe(false);
        act(() => {
          element.classList.add('art-setting-show');
          jest.advanceTimersByTime(4000);
          emit('video:timeupdate');
        });
        expect(player.controls.show).toBe(true);
        act(() => {
          element.classList.remove('art-setting-show');
          emit('video:timeupdate');
        });
        expect(player.controls.show).toBe(false);
      } finally {
        act(() => {
          player.fullscreenWeb = false;
        });
      }
    }
  );

  it('navigates real settings with the remote, then returns through menu, fullscreen and page', async () => {
    mockUseRealArtPlayer = true;
    mockSearchParams.set('tv', '1');
    const view = render(<PlayPage />);
    await settlePlayPage();
    const player = mockArtPlayerInstance;
    if (!player?.emit) throw new Error('real player was not created');
    const element = player.template.$player;
    const setting = element.querySelector<HTMLElement>('.art-control-setting');
    if (!setting) throw new Error('setting control was not created');
    HTMLElement.prototype.scrollIntoView = jest.fn();
    const press = async (key: string, keyCode = 0) => {
      await act(async () => {
        (document.activeElement || element).dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            keyCode,
            bubbles: true,
            cancelable: true,
          })
        );
        await Promise.resolve();
        jest.advanceTimersByTime(20);
      });
    };
    act(() => {
      player.emit?.('ready');
      player.fullscreenWeb = true;
      jest.advanceTimersByTime(20);
      setting.focus();
    });
    await press('Enter');
    expect(element).toHaveClass('art-setting-show');
    expect(document.activeElement).toHaveClass('art-setting-item');
    act(() => {
      setting.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 0 })
      );
    });
    expect(document.activeElement).toHaveTextContent('播放速度');
    await press('Enter');
    expect(document.activeElement).toHaveClass('art-current');
    await press('ArrowDown');
    expect(document.activeElement).toHaveTextContent('1.3');
    await press('Enter');
    expect(
      (element.querySelector('video') as HTMLVideoElement).playbackRate
    ).toBe(1.25);
    expect(document.activeElement).toHaveTextContent('播放速度');
    await press('Enter');
    await press('BrowserBack');
    expect(element).toHaveClass('art-setting-show');
    expect(document.activeElement).toHaveTextContent('播放速度');
    await press('Escape');
    expect(element).not.toHaveClass('art-setting-show');
    expect(setting).toHaveFocus();
    expect(player.fullscreenWeb).toBe(true);
    expect(mockRouterBack).not.toHaveBeenCalled();
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = 0;
    document.body.appendChild(dialog);
    act(() => {
      dialog.focus();
    });
    await press('Escape');
    expect(player.fullscreenWeb).toBe(true);
    expect(mockRouterBack).not.toHaveBeenCalled();
    dialog.remove();
    act(() => {
      setting.focus();
    });
    await press('Unidentified', 4);
    expect(player.fullscreenWeb).toBe(false);
    expect(element.querySelector('.art-control-fullscreenWeb')).toHaveFocus();
    expect(mockRouterBack).not.toHaveBeenCalled();
    act(() => {
      setting.focus();
    });
    await press('Enter');
    act(() => {
      element.querySelector<HTMLElement>('.art-control-volume')?.focus();
    });
    expect(element).not.toHaveClass('art-setting-show');
    expect(setting).toHaveFocus();
    await press('Escape');
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    act(() => {
      player.fullscreenWeb = true;
    });
    view.unmount();
    expect(element.isConnected).toBe(false);
  });

  it('revives Apple MMS playback after the page returns from the background', async () => {
    mockHlsSupported = true;
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    });
    Object.defineProperty(window, 'ManagedMediaSource', {
      configurable: true,
      value: class MockManagedMediaSource {},
    });
    render(<PlayPage />);
    await settlePlayPage();

    const player = mockArtPlayerInstance;
    if (!player) throw new Error('player was not created');
    const hls = player.video.hls as { startLoad: jest.Mock };
    player.currentTime = 120;
    player.video.currentTime = 120;

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    act(() => {
      mockArtPlayerEventHandlers.get('video:pause')?.();
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(hls.startLoad).toHaveBeenCalledWith(119);
    expect(player.video.play).toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    act(() => {
      mockArtPlayerEventHandlers.get('video:pause')?.();
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(hls.startLoad).toHaveBeenCalledTimes(2);
  });

  it('does not show a failure panel when a single-source startup error is followed by canplay', async () => {
    mockAutoFireManifestParsed = false;
    render(<PlayPage />);
    await settlePlayPage();

    await act(async () => {
      mockArtPlayerEventHandlers.get('error')?.(new Event('error'));
      await Promise.resolve();
    });

    act(() => {
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });

    expect(
      screen.queryByRole('heading', { name: '当前线路无法继续恢复' })
    ).toBeNull();
  });

  it('shows the failure panel when a single-source startup actually times out', async () => {
    mockAutoFireManifestParsed = false;
    render(<PlayPage />);
    await settlePlayPage();

    await act(async () => {
      jest.advanceTimersByTime(25_000);
      await Promise.resolve();
    });

    expect(
      screen.getByRole('heading', { name: '当前线路无法继续恢复' })
    ).toBeTruthy();
  });

  it('keeps recovery actions visible when failure arrives before loading ends', async () => {
    mockAutoFireManifestParsed = false;
    const actual = jest.requireActual<typeof import('@/lib/playback-session')>(
      '@/lib/playback-session'
    );
    const reducer = jest.mocked(reducePlaybackSession);
    render(<PlayPage />);
    await settlePlayPage();
    expect(screen.getByTestId('player-loading')).toBeVisible();
    reducer.mockImplementation((state, event) => {
      const result = actual.reducePlaybackSession(state, event);
      result.effects.push({
        type: 'showInPlayerFailure',
        reason: 'recovery-exhausted',
        actions: ['retry', 'switch-source', 'leave'],
      });
      return result;
    });
    try {
      act(() => {
        mockArtPlayerEventHandlers.get('video:timeupdate')?.();
      });
      expect(screen.getByRole('button', { name: '重试' })).toBeVisible();
      expect(screen.queryByTestId('player-loading')).toBeNull();
    } finally {
      reducer.mockImplementation(actual.reducePlaybackSession);
    }
  });
});

describe('PlayPage failed history recovery controls', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockHlsSupported = true;
    mockAutoFireManifestParsed = false;
    mockDefaultPlayerDuration = 240;
    mockManifestParsedHandlers.length = 0;
    mockArtPlayerEventHandlers.clear();
    mockArtPlayerEventHandlerLists.clear();
    mockSearchParams = new URLSearchParams(
      'source=bfzy&id=149697&title=测试&year=2026&from=playrecord'
    );
    jest.mocked(getAllPlayRecords).mockResolvedValue({
      'bfzy+149697': {
        title: '测试',
        year: '2026',
        source_name: '暴风资源',
        cover: '',
        index: 16,
        total_episodes: 16,
        play_time: 120,
        total_time: 240,
        save_time: Date.now(),
        search_title: '测试',
      },
    });
    const sources = [
      createSource({
        source: 'bfzy',
        id: '149697',
        title: '测试',
        source_name: '暴风资源',
        episodes: Array.from(
          { length: 16 },
          (_, i) => `https://bad.example/${i}.m3u8`
        ),
      }),
      createSource({
        source: 'other',
        id: '1',
        title: '测试',
        source_name: '其他线路',
        episodes: Array.from(
          { length: 15 },
          (_, i) => `https://good.example/${i}.m3u8`
        ),
      }),
    ];
    global.fetch = jest.fn(
      async (input: RequestInfo | URL) =>
        ({
          ok: true,
          json: async () =>
            input.toString().startsWith('/api/search')
              ? { results: sources }
              : {},
        } as Response)
    );
  });

  afterEach(() => {
    mockHlsSupported = false;
    mockAutoFireManifestParsed = true;
    mockDefaultPlayerDuration = 120;
    window.localStorage.clear();
    window.sessionStorage.clear();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  async function showHistoryFailure() {
    render(<PlayPage />);
    await screen.findByTestId('episode-selector-sources');
    await act(async () => {
      jest.advanceTimersByTime(26_000);
      await Promise.resolve();
    });
    expect(
      screen.getByRole('heading', { name: '当前线路无法继续恢复' })
    ).toBeVisible();
  }

  it('starts history on an alternate for the same episode when the saved route is known to have failed', async () => {
    rememberSourcePlaybackQuality('bfzy-149697', 'bad.example', {
      mode: 'unavailable',
      lastError: 'manifestLoadError',
    });
    window.localStorage.setItem('enableOptimization', 'false');
    const fetchFixture = global.fetch;
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await fetchFixture(input, init);
        if (!input.toString().startsWith('/api/search')) return response;
        const data = await response.json();
        data.results[1].episodes.push('https://good.example/15.m3u8');
        return { ok: true, json: async () => data } as Response;
      }
    );
    render(<PlayPage />);
    await screen.findByTestId('episode-selector-sources');
    expect(new URL(window.location.href).searchParams.get('source')).toBe(
      'other'
    );
    act(() => {
      mockManifestParsedHandlers[mockManifestParsedHandlers.length - 1]?.();
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });
    expect(mockArtPlayerInstance?.currentTime).toBe(118.5);
    expect(screen.queryByRole('button', { name: '离开' })).toBeNull();
  });

  it('opens the source tab from manual recovery instead of only hiding the failure', async () => {
    await showHistoryFailure();
    fireEvent.click(screen.getByRole('button', { name: '手动换源' }));
    expect(screen.getByTestId('episode-selector-sources')).toHaveAttribute(
      'data-active-tab',
      'sources'
    );
    expect(screen.queryByRole('button', { name: '离开' })).toBeNull();
  });

  it('explains missing alternate episodes and opens an explicit episode choice', async () => {
    await showHistoryFailure();
    expect(
      screen.getByText(
        '其他线路暂未提供第 16 集。可重试当前线路，或选择其他集数后换线。'
      )
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '选择其他集数' }));
    expect(screen.getByTestId('episode-selector-sources')).toHaveAttribute(
      'data-active-tab',
      'episodes'
    );
  });

  it('reconnects the existing player on retry and preserves the pending history position', async () => {
    await showHistoryFailure();
    const attempts = mockManifestParsedHandlers.length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重试' }));
      await Promise.resolve();
    });
    expect(mockManifestParsedHandlers).toHaveLength(attempts + 1);
    expect(screen.getByTestId('player-loading')).toBeVisible();
    act(() => {
      mockManifestParsedHandlers[mockManifestParsedHandlers.length - 1]?.();
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });
    expect(mockArtPlayerInstance?.currentTime).toBe(118.5);
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
    mockDefaultPlayerDuration = 120;
    mockManifestParsedHandlers.length = 0;
    mockHlsErrorHandlers.length = 0;
    mockSearchParams = new URLSearchParams(
      'source=old&id=1&title=%E6%B5%8B%E8%AF%95'
    );
    mockSourceChangeHandler = undefined;
    mockArtPlayerInstance = undefined;
    mockArtPlayerEventHandlers.clear();
    mockArtPlayerEventHandlerLists.clear();
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
    mockHlsSupported = false;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  async function settleWithSources() {
    render(<PlayPage />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/search?q=%E6%B5%8B%E8%AF%95&v=2',
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
  }

  async function switchToFreshHlsSource() {
    await act(async () => {
      await mockSourceChangeHandler?.('new', '2', '测试', {
        autoRecovery: true,
        resumeTime: 115,
        reason: '自动恢复测试',
        autoPlayAfterReady: true,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });
  }

  it('shows the current connection attempt throughout a long automatic switch', async () => {
    await settleWithSources();
    mockAutoFireManifestParsed = false;
    await act(async () => {
      await mockSourceChangeHandler?.('new', '2', '测试', {
        autoRecovery: true,
        resumeTime: 35.3,
      });
    });
    expect(screen.getByText('正在尝试第 1 条备用线路')).toBeVisible();
    expect(screen.getByText('当前线路：新源')).toBeVisible();
    act(() => jest.advanceTimersByTime(9_000));
    expect(screen.getByText('正在尝试第 1 条备用线路')).toBeVisible();
    await act(async () => {
      await mockSourceChangeHandler?.('old', '1', '测试', {
        autoRecovery: true,
        resumeTime: 35.3,
      });
    });
    expect(screen.getByText('正在尝试第 2 条备用线路')).toBeVisible();
    expect(screen.getByText('当前线路：旧源')).toBeVisible();
    act(() => {
      mockManifestParsedHandlers[mockManifestParsedHandlers.length - 1]?.();
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });
    expect(screen.queryByTestId('player-loading')).toBeNull();
  });

  it.each(['hls', 'player'])(
    'discloses a %s failure while keeping user pause intact',
    async (runtime) => {
      mockHlsSupported = true;
      await settleWithSources();
      act(() => mockArtPlayerEventHandlers.get('video:canplay')?.());
      const player = mockArtPlayerInstance;
      if (!player) throw new Error('player was not created');
      player.video.paused = true;
      act(() => mockArtPlayerEventHandlers.get('video:pause')?.());
      player.video.play.mockClear();
      await act(async () => {
        if (runtime === 'hls') {
          mockHlsErrorHandlers[mockHlsErrorHandlers.length - 1]?.('error', {
            fatal: true,
            type: 'networkError',
            details: 'fragLoadError',
          });
        } else {
          mockArtPlayerEventHandlers.get('error')?.(new Event('error'));
        }
        await Promise.resolve();
      });
      expect(
        screen.getByRole('heading', { name: '暂停期间线路已中断' })
      ).toBeVisible();
      expect(player.video.play).not.toHaveBeenCalled();
      expect(new URL(window.location.href).searchParams.get('source')).not.toBe(
        'new'
      );
      act(() => mockArtPlayerEventHandlers.get('video:play')?.());
      expect(
        screen.queryByRole('heading', { name: '暂停期间线路已中断' })
      ).toBeNull();
    }
  );

  async function setupStarvationPlayback() {
    mockHlsSupported = true;
    await settleWithSources();
    act(() => mockArtPlayerEventHandlers.get('video:canplay')?.());
    const player = mockArtPlayerInstance;
    if (!player) throw new Error('player was not created');
    let forwardBufferSeconds = 0;
    Object.defineProperty(player.video, 'buffered', {
      get: () => ({
        length: 1,
        start: () => 0,
        end: () => player.video.currentTime + forwardBufferSeconds,
      }),
    });
    const startedAt = Date.now();
    const reduceMock = jest.mocked(reducePlaybackSession);
    reduceMock.mockClear();
    const timeupdate =
      mockArtPlayerEventHandlerLists.get('video:timeupdate')?.[0];
    expect(timeupdate).toBeDefined();
    return {
      player,
      sample(elapsed: number, currentTime: number, buffer: number) {
        jest.setSystemTime(startedAt + elapsed);
        player.currentTime = currentTime;
        player.video.currentTime = currentTime;
        forwardBufferSeconds = buffer;
        act(() => timeupdate?.());
      },
      getSwitches: () =>
        reduceMock.mock.results.flatMap((result) =>
          result.type === 'return'
            ? result.value.effects.filter(
                (effect) => effect.type === 'switchSource'
              )
            : []
        ),
    };
  }

  it.each([0.5, 1, 2])(
    'keeps the current source during smooth %sx playback with repeated buffer dips',
    async (playbackRate) => {
      const playback = await setupStarvationPlayback();
      playback.player.video.playbackRate = playbackRate;
      for (let elapsed = 0; elapsed <= 12_000; elapsed += 250) {
        playback.sample(
          elapsed,
          30 + (elapsed / 1000) * playbackRate,
          elapsed % 4000 < 1000 ? 1.5 : 4
        );
      }
      expect(playback.getSwitches()).toEqual([]);
    }
  );

  it('still switches sources after repeated real playback waits', async () => {
    const playback = await setupStarvationPlayback();
    for (let index = 0; index < 3; index += 1) {
      playback.sample(index * 4000, 30 + index, 0);
      playback.sample(index * 4000 + 800, 30.1 + index, 4);
    }
    expect(playback.getSwitches()).toEqual([
      expect.objectContaining({ sourceKey: 'new-2' }),
    ]);
    expect(new URL(window.location.href).searchParams.get('source')).toBe(
      'new'
    );
  });

  it('does not carry waits across a user pause without progress callbacks', async () => {
    const playback = await setupStarvationPlayback();
    for (let index = 0; index < 2; index += 1) {
      playback.sample(index * 4000, 30 + index, 0);
      playback.sample(index * 4000 + 800, 30.1 + index, 4);
    }
    playback.sample(8000, 32, 0);
    playback.player.video.paused = true;
    playback.player.video.play.mockClear();
    act(() => mockArtPlayerEventHandlers.get('video:pause')?.());
    expect(playback.player.video.play).not.toHaveBeenCalled();
    playback.player.video.paused = false;
    act(() => mockArtPlayerEventHandlers.get('video:play')?.());
    playback.sample(15_000, 32, 0);
    playback.sample(15_800, 32.1, 4);
    expect(playback.getSwitches()).toEqual([]);
  });

  it('does not carry waits across a user seek or move their chosen playhead', async () => {
    const playback = await setupStarvationPlayback();
    for (let index = 0; index < 2; index += 1) {
      playback.sample(index * 4000, 30 + index, 0);
      playback.sample(index * 4000 + 800, 30.1 + index, 4);
    }
    playback.sample(8000, 32, 0);
    const listeners = playback.player.video.addEventListener?.mock.calls;
    const seeking = listeners?.filter(([event]) => event === 'seeking') || [];
    const seeked = listeners?.filter(([event]) => event === 'seeked') || [];
    expect(seeking.length).toBeGreaterThan(0);
    expect(seeked.length).toBeGreaterThan(0);
    playback.player.currentTime = 10;
    playback.player.video.currentTime = 10;
    playback.player.video.seeking = true;
    act(() => seeking.forEach(([, listener]) => listener()));
    playback.player.video.seeking = false;
    act(() => seeked.forEach(([, listener]) => listener()));
    for (let elapsed = 0; elapsed <= 12_000; elapsed += 250) {
      playback.sample(9000 + elapsed, 10 + elapsed / 1000, 1.5);
    }
    expect(playback.getSwitches()).toEqual([]);
    expect(playback.player.video.currentTime).toBe(22);
    expect(jest.mocked(reducePlaybackSession).mock.calls).toContainEqual([
      expect.anything(),
      expect.objectContaining({
        type: 'user.seekStarted',
        confirmedUserGesture: true,
      }),
    ]);
  });

  it('forwards fatal HLS evidence during source-switch settle while suppressing soft errors', async () => {
    mockHlsSupported = true;
    await settleWithSources();
    await switchToFreshHlsSource();

    const reduceMock = jest.mocked(reducePlaybackSession);
    reduceMock.mockClear();
    const errorHandler = mockHlsErrorHandlers[mockHlsErrorHandlers.length - 1];
    expect(errorHandler).toBeDefined();

    act(() => {
      errorHandler?.('error', {
        fatal: false,
        type: 'mediaError',
        details: 'bufferStalledError',
      });
    });
    expect(
      reduceMock.mock.calls.some(
        ([, event]) => event.type === 'recovery.runtimeEvidence'
      )
    ).toBe(false);

    act(() => {
      errorHandler?.('error', {
        fatal: true,
        type: 'mediaError',
        details: 'bufferAppendError',
      });
    });
    expect(reduceMock.mock.calls.map(([, event]) => event)).toContainEqual(
      expect.objectContaining({
        type: 'recovery.runtimeEvidence',
        evidence: expect.objectContaining({
          hls: expect.objectContaining({ fatal: true }),
        }),
      })
    );
  });

  it('forwards healthy HLS progress to Playback Session', async () => {
    mockHlsSupported = true;
    await settleWithSources();
    await switchToFreshHlsSource();
    act(() => {
      jest.advanceTimersByTime(2100);
    });

    const errorHandler = mockHlsErrorHandlers[mockHlsErrorHandlers.length - 1];
    expect(errorHandler).toBeDefined();
    act(() => {
      errorHandler?.('error', {
        fatal: false,
        type: 'mediaError',
        details: 'bufferStalledError',
      });
    });

    const reduceMock = jest.mocked(reducePlaybackSession);
    reduceMock.mockClear();
    const player = mockArtPlayerInstance;
    if (!player) throw new Error('player was not created');
    player.currentTime = 116;
    player.video.currentTime = 116;
    const timeupdateHandler =
      mockArtPlayerEventHandlerLists.get('video:timeupdate')?.[0];
    expect(timeupdateHandler).toBeDefined();
    act(() => {
      timeupdateHandler?.();
    });

    expect(reduceMock.mock.calls.map(([, event]) => event)).toContainEqual(
      expect.objectContaining({ type: 'recovery.progressHealthy' })
    );
    expect(
      reduceMock.mock.calls.some(
        ([, event]) =>
          event.type === 'recovery.runtimeEvidence' &&
          'evidence' in event &&
          event.evidence.starved === true
      )
    ).toBe(false);
  });

  it('applies an explicit R3 resume without planning it again', async () => {
    mockDefaultPlayerDuration = 300;
    await settleWithSources();

    const player = mockArtPlayerInstance;
    if (!player) throw new Error('ArtPlayer mock was not initialized');
    player.currentTime = 126;
    player.video.currentTime = 126;
    const plannerMock = jest.mocked(getSourceSwitchResumePlan);
    plannerMock.mockClear();

    await act(async () => {
      await mockSourceChangeHandler?.('new', '2', '测试', {
        autoRecovery: true,
        resumeTime: 132,
        reason: 'R3 自动恢复',
        autoPlayAfterReady: true,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(plannerMock).not.toHaveBeenCalled();
    act(() => {
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });
    await waitFor(() => {
      expect(mockArtPlayerInstance?.currentTime).toBe(132);
    });
  });

  it('keeps the queued resume for the target source when the old source emits canplay', async () => {
    mockAutoFireManifestParsed = false;
    mockManifestParsedHandlers.length = 0;

    render(<PlayPage />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/search?q=%E6%B5%8B%E8%AF%95&v=2',
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
    const preparationReadyCallsBeforeStaleCanplay =
      mockMarkPreparationFrameReady.mock.calls.length;
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
    expect(mockMarkPreparationFrameReady).toHaveBeenCalledTimes(
      preparationReadyCallsBeforeStaleCanplay
    );
    await act(async () => {
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

    await act(async () => {
      const liveManifestHandler =
        mockManifestParsedHandlers[mockManifestParsedHandlers.length - 1];
      liveManifestHandler?.();
      jest.runAllTicks();
      await Promise.resolve();
    });
    expect(playerAfterSwitch.currentTime).toBe(0);

    act(() => {
      mockArtPlayerEventHandlers.get('video:canplay')?.();
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
        '/api/search?q=%E6%B5%8B%E8%AF%95&v=2',
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

    // Late target-manifest readiness completes the same attempt because the
    // matching canplay evidence was latched for this HLS instance.
    await act(async () => {
      const liveManifestHandler =
        mockManifestParsedHandlers[mockManifestParsedHandlers.length - 1];
      liveManifestHandler?.();
      jest.runAllTicks();
      await Promise.resolve();
    });

    expect(playerAfterSwitch.currentTime).toBe(115);
  });

  it('keeps queued resume when MANIFEST_PARSED fires before duration is known (prod 4619b870)', async () => {
    // New ArtPlayer instances report duration 0 until metadata arrives — matching
    // the prod finalize log: switch-source-resume-applied with duration: 0.
    mockDefaultPlayerDuration = 0;
    mockAutoFireManifestParsed = false;
    mockManifestParsedHandlers.length = 0;

    render(<PlayPage />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/search?q=%E6%B5%8B%E8%AF%95&v=2',
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
    player.currentTime = 1887.55;
    player.video.currentTime = 1887.55;

    let switchPromise: Promise<boolean> | undefined;
    await act(async () => {
      switchPromise = mockSourceChangeHandler?.('new', '2', '测试', {
        autoRecovery: true,
        resumeTime: 1897.16,
        reason: 'HLS 播放异常',
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
    playerAfterSwitch.duration = 0;
    playerAfterSwitch.video.duration = 0;

    await act(async () => {
      const liveManifestHandler =
        mockManifestParsedHandlers[mockManifestParsedHandlers.length - 1];
      liveManifestHandler?.();
      jest.runAllTicks();
      await Promise.resolve();
    });

    // Manifest parsing alone must not complete the attempt or consume resume.
    expect(playerAfterSwitch.currentTime).toBe(0);

    act(() => {
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });

    // Duration still unknown: do not seek (Safari would collapse it) and do not
    // consume the queued Recovery Resume Time.
    expect(playerAfterSwitch.duration).toBe(0);
    expect(playerAfterSwitch.currentTime).toBe(0);

    // Later canplay with real duration must still restore the queued resume.
    playerAfterSwitch.duration = 3026.52;
    playerAfterSwitch.video.duration = 3026.52;
    act(() => {
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });

    expect(playerAfterSwitch.currentTime).toBe(1897.16);
  });
});

describe('PlayPage preparation transition completion', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAutoFireManifestParsed = true;
    mockDefaultPlayerDuration = 120;
    mockManifestParsedHandlers.length = 0;
    mockSearchParams = new URLSearchParams(
      'source=old&id=1&title=%E6%B5%8B%E8%AF%95'
    );
    mockSourceChangeHandler = undefined;
    mockArtPlayerInstance = undefined;
    mockArtPlayerEventHandlers.clear();
    mockArtPlayerEventHandlerLists.clear();
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

  async function settleWithSources() {
    render(<PlayPage />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/search?q=%E6%B5%8B%E8%AF%95&v=2',
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
  }

  it('dismisses the preparation overlay once the switched source actually starts playing even if its canplay was swallowed as stale', async () => {
    // The first source never reaches canplay, so the preparation overlay is
    // still covering while an automatic/manual source switch is in flight.
    mockAutoFireManifestParsed = false;
    mockManifestParsedHandlers.length = 0;
    mockMarkPreparationFrameReady.mockClear();

    await settleWithSources();

    await act(async () => {
      await mockSourceChangeHandler?.('new', '2', '测试', {
        autoRecovery: true,
        resumeTime: 115,
        reason: '自动恢复测试',
        autoPlayAfterReady: true,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    const playerAfterSwitch = mockArtPlayerInstance;
    if (!playerAfterSwitch) {
      throw new Error('ArtPlayer mock missing after source switch');
    }

    // Load the target source's media playlist explicitly (mirrors production's
    // customType path) without auto-firing its manifest yet.
    mockAutoFireManifestParsed = false;
    await act(async () => {
      (playerAfterSwitch as { switch?: string }).switch =
        'https://example.com/new.m3u8';
      await Promise.resolve();
      await Promise.resolve();
    });

    // The target source's canplay arrives while its HLS manifest is still
    // unknown (or the target is a direct non-HLS source with no manifest at
    // all): the stale gate swallows it and markFrameReady is never reached.
    act(() => {
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });
    expect(mockMarkPreparationFrameReady).toHaveBeenCalledTimes(0);

    // The video is genuinely playing now — the overlay must not stay up while
    // playback runs behind it (user-reported stuck-poster symptom).
    act(() => {
      mockArtPlayerEventHandlers.get('video:playing')?.();
    });

    expect(mockMarkPreparationFrameReady).toHaveBeenCalledTimes(1);
  });

  it('dismisses the preparation overlay after matching canplay and manifest evidence', async () => {
    mockAutoFireManifestParsed = false;
    mockManifestParsedHandlers.length = 0;
    mockMarkPreparationFrameReady.mockClear();

    await settleWithSources();

    await act(async () => {
      await mockSourceChangeHandler?.('new', '2', '测试', {
        autoRecovery: true,
        resumeTime: 115,
        reason: '自动恢复测试',
        autoPlayAfterReady: true,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    const playerAfterSwitch = mockArtPlayerInstance;
    if (!playerAfterSwitch) {
      throw new Error('ArtPlayer mock missing after source switch');
    }

    // Early canplay is retained, but cannot close the transition by itself.
    act(() => {
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });
    expect(mockMarkPreparationFrameReady).toHaveBeenCalledTimes(0);

    // The matching manifest completes the attempt without another canplay.
    await act(async () => {
      const liveManifestHandler =
        mockManifestParsedHandlers[mockManifestParsedHandlers.length - 1];
      liveManifestHandler?.();
      jest.runAllTicks();
      await Promise.resolve();
    });

    expect(mockMarkPreparationFrameReady).toHaveBeenCalledTimes(1);
  });

  it('keeps the source timeout active when only the manifest is ready', async () => {
    mockAutoFireManifestParsed = false;
    mockManifestParsedHandlers.length = 0;
    mockMarkPreparationFrameReady.mockClear();

    await settleWithSources();
    const reduceMock = jest.mocked(reducePlaybackSession);
    reduceMock.mockClear();

    await act(async () => {
      const liveManifestHandler =
        mockManifestParsedHandlers[mockManifestParsedHandlers.length - 1];
      liveManifestHandler?.();
      jest.runAllTicks();
      await Promise.resolve();
    });

    expect(mockMarkPreparationFrameReady).toHaveBeenCalledTimes(0);
    expect(
      reduceMock.mock.calls.some(
        ([, event]) => event.type === 'sourceChange.completed'
      )
    ).toBe(false);

    act(() => {
      jest.advanceTimersByTime(25000);
    });

    expect(
      reduceMock.mock.calls.some(
        ([, event]) => event.type === 'timer.sourceChangeTimeout'
      )
    ).toBe(true);
  });
});

describe('PlayPage playback regression coverage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockSearchParams = new URLSearchParams(
      'source=detail-source&id=detail-id&title=详情影片'
    );
    mockAutoFireManifestParsed = true;
    mockHlsSupported = true;
    mockDefaultPlayerDuration = 1000;
    mockArtPlayerEventHandlers.clear();
    mockArtPlayerEventHandlerLists.clear();
    mockManifestParsedHandlers.length = 0;
    mockHlsErrorHandlers.length = 0;
    jest.mocked(getAllPlayRecords).mockResolvedValue({});
    global.fetch = jest.fn(
      async (input: RequestInfo | URL) =>
        ({
          ok: true,
          json: async () =>
            input.toString().startsWith('/api/detail')
              ? createSource()
              : input.toString().startsWith('/api/search')
              ? { results: [] }
              : {},
        } as Response)
    );
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockDefaultPlayerDuration = 120;
    mockHlsSupported = false;
  });
  async function start() {
    render(<PlayPage />);
    await settlePlayPage();
    const player = mockArtPlayerInstance;
    if (!player) throw new Error('missing player');
    Object.assign(player.video, {
      readyState: 4,
      ended: false,
      networkState: 2,
      seeking: false,
    });
    act(() => mockArtPlayerEventHandlers.get('video:canplay')?.());
    return player;
  }
  function nativeVideoEvent(name: string) {
    const calls =
      mockArtPlayerInstance?.video.addEventListener?.mock.calls ?? [];
    const callback = calls
      .filter(([event]) => event === name)
      .slice(-1)[0]?.[1];
    if (!callback) throw new Error(`missing ${name} listener`);
    callback();
  }
  describe('save completion ordering', () => {
    const saves = jest.mocked(
      jest.requireMock<typeof import('@/lib/db.client')>('@/lib/db.client')
        .savePlayRecordKeys
    );
    let pending: Array<() => void>;

    beforeEach(() => {
      pending = [];
      saves.mockReset();
      saves.mockImplementation(
        () => new Promise<void>((resolve) => pending.push(resolve))
      );
      const originalFetch = global.fetch;
      global.fetch = jest.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          if (input.toString().startsWith('/api/detail')) {
            return {
              ok: true,
              json: async () =>
                createSource({
                  episodes: [
                    'https://example.com/one.m3u8',
                    'https://example.com/two.m3u8',
                  ],
                }),
            } as Response;
          }
          return originalFetch(input, init);
        }
      );
    });

    afterEach(() => saves.mockReset());

    async function pauseAt(time: number) {
      const player = mockArtPlayerInstance;
      if (!player) throw new Error('missing player');
      player.currentTime = time;
      player.video.currentTime = time;
      await act(async () => {
        mockArtPlayerEventHandlers.get('pause')?.();
        await Promise.resolve();
      });
    }

    async function finish(indices: number[]) {
      await act(async () => {
        indices.forEach((index) => pending[index]());
        await Promise.resolve();
      });
    }

    it('does not republish a completed new-episode save after leaving saves finish late', async () => {
      await start();
      await pauseAt(300);
      expect(saves).toHaveBeenCalledTimes(1);
      await act(async () => {
        mockEpisodeChangeHandler?.(2);
        await Promise.resolve();
      });
      await settlePlayPage();
      act(() => mockArtPlayerEventHandlers.get('video:canplay')?.());
      expect(screen.getByTestId('episode-selector-sources')).toHaveAttribute(
        'data-episode',
        '2'
      );
      const leavingCount = saves.mock.calls.length;
      expect(leavingCount).toBeGreaterThanOrEqual(2);
      expect(
        saves.mock.calls
          .slice(0, leavingCount)
          .every(([, record]) => record.index === 1 && record.play_time === 300)
      ).toBe(true);
      await pauseAt(40);
      expect(saves.mock.calls.at(-1)?.[1]).toEqual(
        expect.objectContaining({ index: 2, play_time: 40 })
      );
      const newSave = pending.length - 1;
      await finish([newSave]);
      await finish(Array.from({ length: newSave }, (_, index) => index));
      const count = saves.mock.calls.length;
      await pauseAt(40);
      // Real page save policy must still dedupe the new episode's saved position.
      expect(saves).toHaveBeenCalledTimes(count);
    });

    it('rejects an old session completion after returning to the same episode', async () => {
      await start();
      await pauseAt(300);
      for (const episode of [2, 1]) {
        await act(async () => {
          mockEpisodeChangeHandler?.(episode);
          await Promise.resolve();
        });
        await settlePlayPage();
        act(() => mockArtPlayerEventHandlers.get('video:canplay')?.());
      }
      // Same source, episode and URL again; only the captured epoch/session
      // distinguishes this old completion. No newer save has completed yet.
      await finish([0]);
      await pauseAt(20);
      expect(saves.mock.calls.at(-1)?.[1]).toEqual(
        expect.objectContaining({ index: 1, play_time: 20 })
      );
    });

    it('keeps a later rewind intent when a pre-rewind save completes', async () => {
      const player = await start();
      await pauseAt(322);
      act(() =>
        mockArtPlayerEventHandlerLists
          .get('video:timeupdate')
          ?.forEach((handler) => handler())
      );
      const preRewindSaves = pending.length;
      act(() => {
        player.currentTime = 5;
        player.video.currentTime = 5;
        player.video.seeking = true;
        nativeVideoEvent('seeking');
        player.video.seeking = false;
        nativeVideoEvent('seeked');
      });
      await finish(Array.from({ length: preRewindSaves }, (_, index) => index));
      await pauseAt(11);
      expect(saves.mock.calls.at(-1)?.[1].play_time).toBe(11);
      expect(saves.mock.calls.at(-1)?.[2]?.userRewound).toBe(true);
      await finish([pending.length - 1]);
      await pauseAt(40);
      expect(saves.mock.calls.at(-1)?.[2]?.userRewound).toBe(false);
    });

    it('retains an older successful save when the newer request fails', async () => {
      await start();
      await pauseAt(300);
      const error = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      saves.mockRejectedValueOnce(new Error('controlled persistence failure'));
      try {
        await pauseAt(400);
        await finish([0]);
        await pauseAt(300);
        expect(saves).toHaveBeenCalledTimes(2);
        expect(error).toHaveBeenCalledWith(
          '保存播放进度失败:',
          expect.any(Error)
        );
      } finally {
        error.mockRestore();
      }
    });

    it.each([false, true])(
      'keeps the newest same-episode snapshot (reverse completion: %s)',
      async (reverse) => {
        await start();
        await pauseAt(300);
        await pauseAt(400);
        expect(saves).toHaveBeenCalledTimes(2);
        await finish(reverse ? [1, 0] : [0, 1]);
        await pauseAt(400);
        expect(saves).toHaveBeenCalledTimes(2);
      }
    );
  });

  it.each(['pause', 'beforeunload'])(
    'rewind 322 to 5 then save at 11 via %s should retain 11',
    async (reason) => {
      const player = await start();
      player.currentTime = 322;
      player.video.currentTime = 322;
      act(() =>
        mockArtPlayerEventHandlerLists
          .get('video:timeupdate')
          ?.forEach((handler) => handler())
      );
      await act(async () => {
        window.dispatchEvent(new Event('beforeunload'));
        await Promise.resolve();
      });
      const saves = jest.requireMock('@/lib/db.client').savePlayRecordKeys;
      expect(saves.mock.calls.slice(-1)[0][1].play_time).toBe(322);
      saves.mockClear();
      act(() => {
        player.currentTime = 5;
        player.video.currentTime = 5;
        player.video.seeking = true;
        nativeVideoEvent('seeking');
        player.video.seeking = false;
        nativeVideoEvent('seeked');
        player.currentTime = 11;
        player.video.currentTime = 11;
        mockArtPlayerEventHandlerLists
          .get('video:timeupdate')
          ?.forEach((handler) => handler());
        jest.advanceTimersByTime(12_000);
      });
      await act(async () => {
        if (reason === 'pause') {
          player.video.paused = true;
          mockArtPlayerEventHandlers.get('video:pause')?.();
          mockArtPlayerEventHandlers.get('pause')?.();
        } else window.dispatchEvent(new Event('beforeunload'));
        await Promise.resolve();
        await Promise.resolve();
      });
      const saved = saves.mock.calls.slice(-1)[0];
      expect(saved).toBeDefined();
      expect(saved[2].userRewound).toBe(true);
      const submitted = saved[1].play_time;
      saves.mockClear();
      player.currentTime = 40;
      player.video.currentTime = 40;
      await act(async () => {
        jest.advanceTimersByTime(12_000);
        window.dispatchEvent(new Event('beforeunload'));
        await Promise.resolve();
      });
      const next = saves.mock.calls.slice(-1)[0];
      expect(next[2].userRewound).toBe(false);
      const policy = jest.requireActual('@/lib/play-record-save-policy');
      const merged = policy.mergePlayRecordProgress({
        existingPlayTime: submitted,
        existingEpisodeIndex: 0,
        incomingPlayTime: next[1].play_time,
        incomingEpisodeIndex: 0,
        userRewound: next[2].userRewound,
      });
      expect(merged).toEqual({ playTime: 40, keptFurtherProgress: false });
      expect(submitted).toBe(11);
    }
  );
  it.each([true, false])(
    'paused seek plus fatal error should disclose while video.seeking=%s',
    async (seeking) => {
      const player = await start();
      player.currentTime = 322;
      player.video.currentTime = 322;
      act(() =>
        mockArtPlayerEventHandlerLists
          .get('video:timeupdate')
          ?.forEach((handler) => handler())
      );
      act(() => {
        player.video.paused = true;
        mockArtPlayerEventHandlers.get('video:pause')?.();
        player.currentTime = 5;
        player.video.currentTime = 5;
        player.video.seeking = true;
        nativeVideoEvent('seeking');
        player.video.seeking = seeking;
        mockHlsErrorHandlers[mockHlsErrorHandlers.length - 1]?.('error', {
          fatal: true,
          type: 'networkError',
          details: 'fragLoadError',
        });
        jest.advanceTimersByTime(145_000);
      });
      expect(player.video.play).not.toHaveBeenCalled();
      expect(
        jest
          .mocked(reducePlaybackSession)
          .mock.results.flatMap((result) =>
            result.type === 'return'
              ? result.value.effects.filter(
                  (effect) => effect.type === 'switchSource'
                )
              : []
          )
      ).toEqual([]);
      const events = jest
        .mocked(reducePlaybackSession)
        .mock.calls.map(([, event]) => event);
      expect(
        events.some(
          (event) =>
            event.type === 'user.seekStarted' &&
            event.confirmedUserGesture === true
        )
      ).toBe(true);
      expect(
        screen.queryByRole('heading', { name: '暂停期间线路已中断' })
      ).toBeTruthy();
    }
  );
  it('candidate exhaustion should not cover a video that can still play 43 buffered seconds', async () => {
    const player = await start();
    player.currentTime = 100;
    player.video.currentTime = 100;
    Object.assign(player.video, {
      buffered: { length: 1, start: () => 0, end: () => 143 },
    });
    act(() => {
      mockHlsErrorHandlers[mockHlsErrorHandlers.length - 1]?.('error', {
        fatal: true,
        type: 'networkError',
        details: 'fragLoadError',
      });
    });
    expect(player.video.paused).toBe(false);
    expect(player.video.pause).not.toHaveBeenCalled();
    expect(player.pause).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { name: '当前线路无法继续恢复' })
    ).toBeNull();
    expect(
      screen.getByText('备用线路已用完，继续播放已缓冲内容')
    ).toBeVisible();
    act(() => {
      player.currentTime = 142;
      player.video.currentTime = 142;
      mockArtPlayerEventHandlerLists
        .get('video:timeupdate')
        ?.forEach((handler) => handler());
      mockArtPlayerEventHandlers.get('video:playing')?.();
    });
    expect(
      screen.queryByRole('heading', { name: '当前线路无法继续恢复' })
    ).toBeNull();
    act(() => {
      player.currentTime = 143;
      player.video.currentTime = 143;
      mockArtPlayerEventHandlers.get('video:waiting')?.();
    });
    expect(
      screen.getByRole('heading', { name: '当前线路无法继续恢复' })
    ).toBeVisible();
  });
  it('fatal startup error shows failure before the startup watchdog', async () => {
    mockAutoFireManifestParsed = false;
    render(<PlayPage />);
    await settlePlayPage();
    act(() =>
      mockHlsErrorHandlers[mockHlsErrorHandlers.length - 1]?.('error', {
        fatal: true,
        type: 'networkError',
        details: 'manifestLoadError',
      })
    );
    expect(
      screen.getByRole('heading', { name: '当前线路无法继续恢复' })
    ).toBeVisible();
  });
  it('switches to a playable alternate after 10 seconds of silent startup failure', async () => {
    mockAutoFireManifestParsed = false;
    const alternate = createSource({
      source: 'alternate',
      id: '2',
      source_name: '备用源',
      episodes: ['https://good.example/episode.m3u8'],
    });
    rememberSourcePlaybackQuality('alternate-2', 'good.example', {
      mode: 'direct',
    });
    const fetchFixture = global.fetch;
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input.toString().startsWith('/api/search')) {
          return {
            ok: true,
            json: async () => ({ results: [createSource(), alternate] }),
          } as Response;
        }
        return fetchFixture(input, init);
      }
    );
    render(<PlayPage />);
    await screen.findByTestId('episode-selector-sources');
    act(() => jest.advanceTimersByTime(9_999));
    expect(new URL(window.location.href).searchParams.get('source')).toBe(
      'detail-source'
    );
    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(new URL(window.location.href).searchParams.get('source')).toBe(
      'alternate'
    );
    expect(screen.getByText('正在尝试第 1 条备用线路')).toBeVisible();
  });
  it('silent startup failure stops waiting after 10000ms', async () => {
    mockAutoFireManifestParsed = false;
    render(<PlayPage />);
    await settlePlayPage();
    act(() => jest.advanceTimersByTime(9_999));
    expect(
      screen.queryByRole('heading', { name: '当前线路无法继续恢复' })
    ).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(
      screen.getByRole('heading', { name: '当前线路无法继续恢复' })
    ).toBeVisible();
  });
});
