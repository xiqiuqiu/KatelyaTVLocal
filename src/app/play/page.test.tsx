import { act, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
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
      fullscreen: boolean;
      fullscreenWeb: boolean;
      emit?: (event: string) => void;
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
        muted?: boolean;
        play: jest.Mock;
        hls?: unknown;
      };
    }
  | undefined;
const mockArtPlayerEventHandlers = new Map<
  string,
  (...args: unknown[]) => void
>();
let mockAutoFireManifestParsed = true;
let mockHlsSupported = false;
let mockDefaultPlayerDuration = 120;
let mockUseRealArtPlayer = false;
const mockManifestParsedHandlers: Array<() => void> = [];
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

  it('syncs available sources from detail fallback after search misses the current source', async () => {
    render(<PlayPage />);
    await settlePlayPage();
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

  it('keeps queued resume when MANIFEST_PARSED fires before duration is known (prod 4619b870)', async () => {
    // New ArtPlayer instances report duration 0 until metadata arrives — matching
    // the prod finalize log: switch-source-resume-applied with duration: 0.
    mockDefaultPlayerDuration = 0;
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

    mockAutoFireManifestParsed = true;
    await act(async () => {
      (playerAfterSwitch as { switch?: string }).switch =
        'https://example.com/new.m3u8';
      await Promise.resolve();
      await Promise.resolve();
    });

    // MANIFEST_PARSED arms targetReady; canplay finalizes synchronously (the
    // queued microtask is not required for this signal).
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

  it('dismisses the preparation overlay when the switched source manifest finalizes after an early swallowed canplay', async () => {
    // Early canplay before targetReady is deliberately ignored (stale gate),
    // but the MANIFEST_PARSED fallback must still close the transition instead
    // of leaving the poster overlay stuck over a playing video.
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

    // Load the target source's media playlist without auto-firing its manifest.
    mockAutoFireManifestParsed = false;
    await act(async () => {
      (playerAfterSwitch as { switch?: string }).switch =
        'https://example.com/new.m3u8';
      await Promise.resolve();
      await Promise.resolve();
    });

    // Early canplay is swallowed by the stale gate before targetReady.
    act(() => {
      mockArtPlayerEventHandlers.get('video:canplay')?.();
    });
    expect(mockMarkPreparationFrameReady).toHaveBeenCalledTimes(0);

    // Late MANIFEST_PARSED arms targetReady and finalizes media readiness; this
    // fallback must also call markFrameReady even if the browser never re-emits
    // canplay. Only the live handler (the one bound to the current hls) can
    // fire in production — the mock keeps stale handlers from destroyed
    // players, so fire the latest one and flush the faked microtask queue.
    await act(async () => {
      const liveManifestHandler =
        mockManifestParsedHandlers[mockManifestParsedHandlers.length - 1];
      liveManifestHandler?.();
      jest.runAllTicks();
      await Promise.resolve();
    });

    expect(mockMarkPreparationFrameReady).toHaveBeenCalledTimes(1);
  });
});
