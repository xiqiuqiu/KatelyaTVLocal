import type { HlsConfig } from 'hls.js';

import {
  getSourceStatusDescription,
  getVideoResolutionFromM3u8,
  markBrowserSpeedUnmeasured,
  SourceSpeedProbeTimeoutError,
} from './utils';

const mockHandlers = new Map<string, (event: string, data: unknown) => void>();
const mockDestroy = jest.fn();
let mockFetchSetup: HlsConfig['fetchSetup'];
let mockVideo: HTMLVideoElement;

jest.mock('hls.js', () => ({
  __esModule: true,
  default: class {
    static Events: Record<string, string> = {
      ERROR: 'error',
      MANIFEST_LOADED: 'manifestLoaded',
      FRAG_LOADED: 'fragLoaded',
    };
    levels = [{ averageBitrate: 4_000_000 }];
    destroy = mockDestroy;

    constructor(config: HlsConfig) {
      mockFetchSetup = config.fetchSetup;
    }

    on(event: string, handler: (event: string, data: unknown) => void) {
      mockHandlers.set(event, handler);
    }

    loadSource() {
      return undefined;
    }

    attachMedia(video: HTMLVideoElement) {
      mockVideo = video;
      Object.defineProperty(video, 'videoWidth', { value: 1920 });
    }
  },
}));

const stream = 'https://fixture.example/episode.m3u8';
const originalRequest = globalThis.Request;
const request = jest.fn((url: string) => ({ url }));

function loadFragment(index: number, bytes = 100_000, elapsed = 100) {
  const url = new URL(`clip${index}.ts`, stream).href;
  mockFetchSetup?.({ url, responseType: 'arraybuffer' }, {});
  mockHandlers.get('fragLoaded')?.('fragLoaded', {
    frag: {
      url,
      level: 0,
      sn: index,
      type: 'main',
      stats: { loaded: bytes, loading: { start: 0, end: elapsed } },
    },
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockHandlers.clear();
  mockDestroy.mockClear();
  request.mockClear();
  Object.defineProperty(globalThis, 'Request', {
    configurable: true,
    value: request,
  });
});

afterEach(() => {
  jest.useRealTimers();
  Object.defineProperty(globalThis, 'Request', {
    configurable: true,
    writable: true,
    value: originalRequest,
  });
});

it('measures two complete network samples using dedicated no-cache requests', async () => {
  const measurement = getVideoResolutionFromM3u8(stream, { background: true });
  loadFragment(0, 100_000, 4);
  mockVideo.dispatchEvent(new Event('loadedmetadata'));
  expect(mockDestroy).not.toHaveBeenCalled();

  loadFragment(1);
  expect(mockDestroy).not.toHaveBeenCalled();
  loadFragment(2);

  expect(request).toHaveBeenCalledWith('https://fixture.example/clip0.ts', {
    cache: 'no-store',
    priority: 'low',
  });
  await expect(measurement).resolves.toMatchObject({
    quality: '1080p',
    loadSpeed: '976.6 KB/s',
    speedSource: 'browser',
    playbackBitrateBps: 4_000_000,
  });
  expect(mockDestroy).toHaveBeenCalledTimes(1);
});

it('returns playable metadata without a speed when there is only one valid sample', async () => {
  const measurement = getVideoResolutionFromM3u8(stream, { timeoutMs: 1800 });
  loadFragment(0);
  mockVideo.dispatchEvent(new Event('loadedmetadata'));
  jest.advanceTimersByTime(1800);

  await expect(measurement).resolves.toMatchObject({
    quality: '1080p',
    loadSpeed: '速度未测得',
    speedSource: 'none',
    browserSpeedUnmeasured: true,
  });
});

it('reports the timeout separately and can show it alongside known backend speed', async () => {
  const measurement = getVideoResolutionFromM3u8(stream, { timeoutMs: 1800 });
  const result = expect(measurement).rejects.toBeInstanceOf(
    SourceSpeedProbeTimeoutError
  );
  jest.advanceTimersByTime(1800);
  await result;

  const info = markBrowserSpeedUnmeasured({
    quality: '1080p',
    loadSpeed: '291.2 KB/s',
    pingTime: 180,
    speedSource: 'backend',
  });
  expect(getSourceStatusDescription({ kind: 'direct' }, info)).toBe(
    '后端 291.2 KB/s · 本机速度未测得 · 180ms'
  );
});
