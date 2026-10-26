import type { PlaybackQualityRecord } from './playback-quality';
import { playbackQualityPayloadSchema } from './playback-quality';
import {
  consumePlaybackPageEntryTime,
  createPlaybackQualityReporter,
  observePlaybackFirstFrame,
} from './playback-quality.client';

const settle = async () => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

function fixture() {
  let time = 0;
  const sent: PlaybackQualityRecord[] = [];
  const fetcher = jest.fn(async (_url, init) => {
    const payload = playbackQualityPayloadSchema.parse(JSON.parse(init.body));
    sent.push(...payload.records);
    return { ok: true, status: 200 } as Response;
  });
  const reporter = createPlaybackQualityReporter({
    now: () => time,
    fetcher,
  });
  const start = (sessionId = 'watch-1') =>
    reporter.start({
      sessionId,
      contentKey: '测试::2026',
      episodeIndex: 0,
      platform: 'desktop-hlsjs',
      pageStartedAt: time,
      clickedAt: time,
    });
  const source = (attemptId = 1) =>
    reporter.beginSource({
      attemptId,
      sourceKey: `source-${attemptId}`,
      episodeIndex: 0,
      contentKey: '测试::2026',
      reason: attemptId === 1 ? 'initial' : 'auto',
    });
  return {
    reporter,
    sent,
    fetcher,
    start,
    source,
    at: (value: number) => {
      time = value;
    },
  };
}

describe('startup quality observations', () => {
  it('consumes the document navigation origin once across SPA play-page remounts', () => {
    const navigation = {
      name: 'https://app.example/play?source=one',
      startTime: 0,
    };
    expect(
      consumePlaybackPageEntryTime(
        navigation,
        100,
        'https://app.example/play?source=one',
        null
      )
    ).toBe(0);
    expect(
      consumePlaybackPageEntryTime(
        navigation,
        60_000,
        'https://app.example/play?source=two',
        null
      )
    ).toBe(60_000);
  });
  it('includes preparation time, skips duplicate attempts, and accepts one matching frame', async () => {
    const f = fixture();
    f.start();
    f.at(2000);
    f.source();
    f.source();
    f.at(3200);
    f.reporter.frame(9, 'rvfc');
    expect(f.reporter.isPending()).toBe(true);
    f.reporter.frame(1, 'rvfc');
    f.reporter.frame(1, 'rvfc');
    await settle();
    const terminal = f.sent.filter((record) => record.status === 'terminal');
    expect(terminal).toHaveLength(2);
    expect(terminal).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKind: 'round',
          elapsedMs: 3200,
          activeWaitMs: 3200,
          pageToFrameMs: 3200,
        }),
        expect.objectContaining({
          rowKind: 'source',
          attemptId: 1,
          sourceToFrameMs: 1200,
        }),
      ])
    );
    expect(
      new Set(
        f.sent.filter((r) => r.rowKind === 'source').map((r) => r.attemptId)
      )
    ).toEqual(new Set([1]));
  });

  it('keeps automatic failover in the first round and records slow baseline success honestly', async () => {
    const f = fixture();
    f.start();
    f.source();
    f.at(10_000);
    f.reporter.sourceFailed('source-timeout');
    f.source(2);
    f.at(35_000);
    f.reporter.frame(2, 'playhead');
    await settle();
    expect(f.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKind: 'source',
          attemptId: 1,
          outcome: 'source-timeout',
        }),
        expect.objectContaining({
          rowKind: 'round',
          roundId: 1,
          rootRoundId: 1,
          activeWaitMs: 35_000,
          outcome: 'frame-ready',
        }),
      ])
    );
    expect(f.sent.some((r) => r.outcome === 'budget-exhausted')).toBe(false);
  });

  it('excludes pauses, hidden time and autoplay restrictions without ending the round', async () => {
    const f = fixture();
    f.start();
    f.source();
    f.at(500);
    f.reporter.setPaused(true);
    f.at(10_000);
    f.reporter.setHidden(true);
    f.at(20_000);
    f.reporter.setHidden(false);
    f.reporter.setPaused(false);
    f.at(20_100);
    f.reporter.autoplayBlocked();
    f.at(30_000);
    f.reporter.frame(1, 'rvfc');
    expect(f.reporter.isPending()).toBe(true);
    f.reporter.setPaused(false);
    f.at(30_400);
    f.reporter.frame(1, 'rvfc');
    await settle();
    expect(f.sent).toContainEqual(
      expect.objectContaining({
        rowKind: 'round',
        outcome: 'frame-ready',
        elapsedMs: 30_400,
        activeWaitMs: 1000,
        hadHidden: true,
        autoplayBlocked: true,
      })
    );
    expect(f.sent.some((r) => r.outcome === 'abandoned')).toBe(false);
  });

  it('preserves a failed first round when the user retries, and starts a fresh root for episodes', async () => {
    const f = fixture();
    f.start();
    f.source();
    f.at(1000);
    f.reporter.finish('failed');
    f.at(2000);
    f.reporter.startRound('continue', 0);
    f.source(2);
    f.at(3000);
    f.reporter.frame(2, 'rvfc');
    f.reporter.startRound('episode', 1, true);
    await settle();
    expect(f.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowKind: 'round',
          roundId: 1,
          outcome: 'failed',
        }),
        expect.objectContaining({
          rowKind: 'round',
          roundId: 2,
          rootRoundId: 1,
          outcome: 'frame-ready',
        }),
        expect.objectContaining({
          rowKind: 'round',
          roundId: 3,
          rootRoundId: 3,
          episodeIndex: 1,
          status: 'pending',
        }),
      ])
    );
  });

  it('stops sending after missing storage and never makes playback wait for telemetry', async () => {
    const fetcher = jest.fn(
      async () => ({ status: 202, ok: true } as Response)
    );
    const reporter = createPlaybackQualityReporter({ now: () => 0, fetcher });
    reporter.start({
      sessionId: 'watch',
      contentKey: null,
      episodeIndex: 0,
      platform: 'desktop-hlsjs',
      pageStartedAt: 0,
    });
    await settle();
    reporter.finish('abandoned');
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps episode origin and hidden history across a failed start and manual retry', async () => {
    const f = fixture();
    f.start();
    f.source();
    f.at(1000);
    f.reporter.frame(1, 'rvfc');
    expect(f.reporter.canRetry()).toBe(false);
    f.at(600_000);
    f.reporter.startRound('episode', 1, true);
    const begin = (attemptId: number) =>
      f.reporter.beginSource({
        attemptId,
        sourceKey: 'episode-source',
        episodeIndex: 1,
        contentKey: '测试::2026',
        reason: 'manual',
      });
    begin(2);
    f.at(600_100);
    f.reporter.setHidden(true);
    f.at(600_500);
    f.reporter.setHidden(false);
    f.reporter.finish('failed');
    expect(f.reporter.canRetry()).toBe(true);
    f.at(600_600);
    f.reporter.startRound('manual-source', 1);
    begin(3);
    f.at(601_000);
    f.reporter.frame(3, 'rvfc');
    await settle();
    expect(f.sent).toContainEqual(
      expect.objectContaining({
        rowKind: 'round',
        roundId: 3,
        rootRoundId: 2,
        entryKind: 'episode',
        outcome: 'frame-ready',
        pageToFrameMs: 1000,
        clickToFrameMs: null,
        hadHidden: true,
      })
    );
  });

  it('bounds hidden checkpoints and sends an abandonment snapshot with keepalive', async () => {
    const f = fixture();
    f.start();
    await settle();
    for (let index = 1; index < 10; index += 1) {
      f.at(index * 100);
      f.reporter.setHidden(true);
      f.reporter.setHidden(false);
      await settle();
    }
    f.reporter.finish('abandoned');
    await settle();
    const rounds = f.sent.filter((r) => r.rowKind === 'round');
    expect(rounds).toHaveLength(6);
    expect(rounds[5]).toMatchObject({
      outcome: 'abandoned',
      status: 'terminal',
    });
    expect(f.fetcher.mock.calls.some(([, init]) => init.keepalive)).toBe(true);
  });
});

describe('first playback frame observer', () => {
  function media(hasCallback = true) {
    const video = document.createElement('video');
    let callback: VideoFrameRequestCallback | null = null;
    Object.defineProperty(video, 'paused', {
      configurable: true,
      value: false,
    });
    Object.defineProperty(video, 'seeking', {
      configurable: true,
      value: false,
    });
    if (hasCallback) {
      video.requestVideoFrameCallback = jest.fn((fn) => {
        callback = fn;
        return 7;
      });
      video.cancelVideoFrameCallback = jest.fn();
    } else {
      Object.defineProperty(video, 'requestVideoFrameCallback', {
        value: undefined,
      });
    }
    return {
      video,
      frame: () => callback?.(0, {} as VideoFrameCallbackMetadata),
    };
  }

  it('waits for playing, resume readiness and a current-generation frame; canplay alone is insufficient', () => {
    const m = media();
    let ready = false;
    const onFrame = jest.fn();
    const cleanup = observePlaybackFirstFrame(m.video, {
      isCurrent: () => true,
      isReady: () => ready,
      onFrame,
      onPaused: jest.fn(),
    });
    m.video.dispatchEvent(new Event('canplay'));
    expect(onFrame).not.toHaveBeenCalled();
    m.video.dispatchEvent(new Event('playing'));
    m.frame();
    expect(onFrame).not.toHaveBeenCalled();
    ready = true;
    m.frame();
    m.frame();
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith('rvfc');
    cleanup();
  });

  it('ignores frames from a replaced media generation and cancels outstanding callbacks', () => {
    const m = media();
    let current = true;
    const onFrame = jest.fn();
    const cleanup = observePlaybackFirstFrame(m.video, {
      isCurrent: () => current,
      isReady: () => true,
      onFrame,
      onPaused: jest.fn(),
    });
    m.video.dispatchEvent(new Event('playing'));
    current = false;
    m.frame();
    expect(onFrame).not.toHaveBeenCalled();
    cleanup();
  });

  it('falls back to actual playhead progress and rejects a seek jump', () => {
    const m = media(false);
    const onFrame = jest.fn();
    observePlaybackFirstFrame(m.video, {
      isCurrent: () => true,
      isReady: () => true,
      onFrame,
      onPaused: jest.fn(),
    });
    m.video.dispatchEvent(new Event('playing'));
    m.video.dispatchEvent(new Event('seeking'));
    m.video.currentTime = 300;
    m.video.dispatchEvent(new Event('timeupdate'));
    expect(onFrame).not.toHaveBeenCalled();
    m.video.dispatchEvent(new Event('seeked'));
    m.video.currentTime = 300.2;
    m.video.dispatchEvent(new Event('timeupdate'));
    expect(onFrame).toHaveBeenCalledWith('playhead');
  });

  it('accepts sparse timeupdate progress from an old TV browser', () => {
    const m = media(false);
    const onFrame = jest.fn();
    observePlaybackFirstFrame(m.video, {
      isCurrent: () => true,
      isReady: () => true,
      onFrame,
      onPaused: jest.fn(),
    });
    m.video.dispatchEvent(new Event('playing'));
    m.video.currentTime = 4;
    m.video.dispatchEvent(new Event('timeupdate'));
    expect(onFrame).toHaveBeenCalledWith('playhead');
  });
});
