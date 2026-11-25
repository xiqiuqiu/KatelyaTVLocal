/** @jest-environment node */

import { Headers as EdgeHeaders } from 'next/dist/compiled/@edge-runtime/primitives';
import { ReadableStream } from 'node:stream/web';

import {
  isPlatformProbeFailure,
  persistOfflineProbeResult,
  probePlaybackForRanking,
} from '@/lib/source-ranking/probe';

describe('source ranking offline probe', () => {
  const originalFetch = global.fetch;
  const originalHeaders = global.Headers;

  const entryUrl = 'https://media.example.com/index.m3u8';
  const variantUrl = 'https://media.example.com/low/index.m3u8';
  const origin = 'https://app.example.com';
  const mediaPlaylist = '#EXTM3U\n#EXTINF:4,\nseg-1.ts';
  const cors = { 'Access-Control-Allow-Origin': '*' };

  function mockResponse(
    payload: string | Uint8Array | ReadableStream<Uint8Array> | null,
    { status = 200, headers }: ResponseInit = {}
  ) {
    const body =
      payload instanceof Uint8Array
        ? new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(payload);
              controller.close();
            },
          })
        : payload instanceof ReadableStream
        ? payload
        : null;

    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(headers),
      body,
      async text() {
        return typeof payload === 'string' ? payload : '';
      },
    };
  }

  function playlist(body: string) {
    return mockResponse(body, {
      headers: { ...cors, 'Content-Type': 'application/vnd.apple.mpegurl' },
    });
  }

  beforeEach(() => {
    global.Headers = EdgeHeaders;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.Headers = originalHeaders;
  });

  it.each([false, true])(
    'validates and measures the same first segment without refetching playlists (master: %s)',
    async (master) => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;
      if (master) {
        fetchMock.mockResolvedValueOnce(
          playlist(
            [
              '#EXTM3U',
              '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720',
              'low/index.m3u8',
              '#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080',
              'high/index.m3u8',
            ].join('\n')
          )
        );
      }
      fetchMock
        .mockResolvedValueOnce(playlist(mediaPlaylist))
        .mockResolvedValueOnce(
          mockResponse(new Uint8Array(12 * 1024), {
            status: 206,
            headers: cors,
          })
        );

      const result = await probePlaybackForRanking(entryUrl, origin);
      const segmentUrl = new URL('seg-1.ts', master ? variantUrl : entryUrl)
        .href;
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(
        master ? [entryUrl, variantUrl, segmentUrl] : [entryUrl, segmentUrl]
      );
      const request = fetchMock.mock.calls.at(-1)?.[1];
      expect(request?.redirect).toBe('manual');
      expect(request?.headers.get('Range')).toBe('bytes=0-262143');
      expect(result).toMatchObject({
        kind: 'direct',
        domain: 'media.example.com',
        upstreamStatus: 200,
        resolutionLabel: master ? '720p' : null,
      });
      expect(result.firstSegmentLatencyMs).toBeGreaterThan(0);
      expect(result.firstSegmentSpeedKbps).toBeGreaterThan(0);
    }
  );

  it('keeps playability when a reachable segment has no bytes to measure', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(playlist(mediaPlaylist))
      .mockResolvedValueOnce(
        mockResponse(null, { status: 206, headers: cors })
      );
    await expect(
      probePlaybackForRanking(entryUrl, origin)
    ).resolves.toMatchObject({
      kind: 'direct',
      firstSegmentLatencyMs: null,
      firstSegmentSpeedKbps: null,
    });
  });

  it('bounds the sample and cancels excess bytes if a CDN ignores Range', async () => {
    const cancel = jest.fn();
    const segment = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(512 * 1024));
      },
      cancel,
    });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(playlist(mediaPlaylist))
      .mockResolvedValueOnce(mockResponse(segment, { headers: cors }));
    const result = await probePlaybackForRanking(entryUrl, origin);
    expect(result.kind).toBe('direct');
    expect(result.firstSegmentSpeedKbps).toBe(
      Number(
        ((256 * 1024 * 8) / (result.firstSegmentLatencyMs ?? 0)).toFixed(2)
      )
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps a playable segment when only the small availability range is accepted', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(playlist(mediaPlaylist))
      .mockResolvedValueOnce(mockResponse(null, { status: 416 }))
      .mockResolvedValueOnce(
        mockResponse(new Uint8Array(2), { status: 206, headers: cors })
      );
    global.fetch = fetchMock;
    await expect(
      probePlaybackForRanking(entryUrl, origin)
    ).resolves.toMatchObject({
      kind: 'direct',
      firstSegmentSpeedKbps: null,
    });
    expect(fetchMock.mock.calls[2][1].headers.get('Range')).toBe('bytes=0-1');
  });

  it('blocks private redirects on the measured segment', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(playlist(mediaPlaylist))
      .mockResolvedValueOnce(
        mockResponse(null, {
          status: 302,
          headers: { Location: 'http://127.0.0.1/seg-1.ts' },
        })
      );
    await expect(
      probePlaybackForRanking(entryUrl, origin)
    ).resolves.toMatchObject({
      kind: 'unavailable',
      reason: expect.stringContaining('Blocked redirect target'),
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('persists offline probe rows with nullable fields for d1 aggregation', async () => {
    const run = jest.fn().mockResolvedValue({ success: true });
    const bind = jest.fn().mockReturnValue({ run });
    const prepare = jest.fn().mockReturnValue({ bind });

    await persistOfflineProbeResult(
      { DB: { prepare } },
      'run-1',
      {
        sourceKey: 'alpha',
        sourceName: 'Alpha Source',
        titleSample: '示例标题',
        episodeUrl: 'https://media.example.com/video.m3u8',
      },
      {
        kind: 'direct',
        reason: '媒体地址可直接访问',
        domain: 'media.example.com',
        upstreamStatus: 403,
        probeTimeMs: 780,
        resolutionLabel: null,
        firstSegmentLatencyMs: null,
        firstSegmentSpeedKbps: null,
      },
      1710000000000
    );

    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO source_probe_results')
    );
    expect(bind).toHaveBeenCalledWith(
      expect.any(String),
      'run-1',
      'alpha',
      'Alpha Source',
      '示例标题',
      'https://media.example.com/video.m3u8',
      'media.example.com',
      'direct',
      '媒体地址可直接访问',
      403,
      780,
      null,
      null,
      null,
      1710000000000
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not persist a workers subrequest failure as an unavailable source', async () => {
    const prepare = jest.fn();

    await persistOfflineProbeResult(
      { DB: { prepare } },
      'run-1',
      {
        sourceKey: 'ruyi-88096',
        sourceName: '如意',
        titleSample: '蒸蒸日上',
        episodeUrl: 'https://media.example.com/video.m3u8',
      },
      {
        kind: 'unavailable',
        reason: 'Too many subrequests',
      }
    );

    expect(
      isPlatformProbeFailure({
        kind: 'unavailable',
        reason: 'Too many subrequests',
      })
    ).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('maps unavailable upstream probe results into offline ranking shape', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(mockResponse(null, { status: 502 }));
    await expect(
      probePlaybackForRanking(entryUrl, origin)
    ).resolves.toMatchObject({
      kind: 'unavailable',
      reason: '上游响应失败: 502',
      domain: 'media.example.com',
      upstreamStatus: 502,
      resolutionLabel: null,
      firstSegmentLatencyMs: null,
      firstSegmentSpeedKbps: null,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
