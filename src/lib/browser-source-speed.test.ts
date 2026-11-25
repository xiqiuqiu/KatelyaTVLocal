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
      FRAG_LOADING: 'fragLoading',
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

function startFragment(index: number) {
  const url = new URL(`clip${index}.ts`, stream).href;
  const frag = {
    url,
    level: 0,
    sn: index,
    type: 'main',
    stats: { loaded: 0, loading: { start: 0, end: 0 } },
  };
  mockHandlers.get('fragLoading')?.('fragLoading', { frag });
  mockFetchSetup?.({ url, responseType: 'arraybuffer' }, {});
  return frag;
}

function loadFragment(index: number, bytes = 100_000, elapsed = 100) {
  const frag = startFragment(index);
  frag.stats.loaded = bytes;
  frag.stats.loading.end = elapsed;
  mockHandlers.get('fragLoaded')?.('fragLoaded', { frag });
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

it('stops a background measurement when the foreground playback needs the connection', async () => {
  const controller = new AbortController();
  const measurement = getVideoResolutionFromM3u8(stream, {
    background: true,
    signal: controller.signal,
  });
  startFragment(0);
  const rejected = expect(measurement).rejects.toMatchObject({
    name: 'AbortError',
  });
  controller.abort();
  // Even a late HLS callback must not establish a successful sample.
  mockVideo.dispatchEvent(new Event('loadedmetadata'));
  jest.advanceTimersByTime(8000);
  await rejected;
  expect(mockDestroy).toHaveBeenCalledTimes(1);
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

describe('conditional background deadline', () => {
  function startMeasurement(canContinue: () => boolean) {
    return getVideoResolutionFromM3u8(stream, {
      timeoutMs: 1800,
      background: true,
      extension: { maxTimeoutMs: 2600, canContinue },
    });
  }

  it('keeps the soft deadline while a fragment has no body bytes', async () => {
    const canContinue = jest.fn(() => true);
    const measurement = startMeasurement(canContinue);
    const result = expect(measurement).rejects.toBeInstanceOf(
      SourceSpeedProbeTimeoutError
    );
    startFragment(0);
    jest.advanceTimersByTime(1800);
    await result;
    expect(canContinue).not.toHaveBeenCalled();
  });

  it('accepts two valid segments after the soft deadline if bytes and buffer are present', async () => {
    const measurement = startMeasurement(() => true);
    const frag = startFragment(0);
    frag.stats.loaded = 80_000;
    jest.advanceTimersByTime(1800);
    expect(mockDestroy).not.toHaveBeenCalled();

    frag.stats.loaded = 100_000;
    frag.stats.loading.end = 2000;
    mockHandlers.get('fragLoaded')?.('fragLoaded', { frag });
    mockVideo.dispatchEvent(new Event('loadedmetadata'));
    jest.advanceTimersByTime(500);
    loadFragment(1);
    await expect(measurement).resolves.toMatchObject({
      speedSource: 'browser',
    });
  });

  it.each([
    [false, 1800, 0],
    [true, 1900, 100],
    [true, 2600, 800],
  ])(
    'stops with insufficient samples when buffer starts %s and deadline is %i ms',
    async (bufferInitiallyHealthy, expectedStop, advanceAfterSoft) => {
      let healthy = bufferInitiallyHealthy;
      const measurement = startMeasurement(() => healthy);
      loadFragment(0);
      mockVideo.dispatchEvent(new Event('loadedmetadata'));
      jest.advanceTimersByTime(1799);
      jest.advanceTimersByTime(1);
      if (expectedStop > 1800) {
        expect(mockDestroy).not.toHaveBeenCalled();
        if (expectedStop === 1900) healthy = false;
        jest.advanceTimersByTime(advanceAfterSoft - 1);
        expect(mockDestroy).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
      }
      await expect(measurement).resolves.toMatchObject({ speedSource: 'none' });
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    }
  );
});
