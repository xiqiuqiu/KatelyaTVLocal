import { probeSourcePlaybackUpstream } from '@/lib/source-preference';
import {
  persistOfflineProbeResult,
  probePlaybackForRanking,
} from '@/lib/source-ranking/probe';

jest.mock('@/lib/source-preference', () => ({
  probeSourcePlaybackUpstream: jest.fn(),
}));

describe('source ranking offline probe', () => {
  const mockedProbeSourcePlaybackUpstream =
    probeSourcePlaybackUpstream as jest.MockedFunction<
      typeof probeSourcePlaybackUpstream
    >;
  const originalFetch = global.fetch;

  function mockTextResponse(text: string) {
    return {
      ok: true,
      text: async () => text,
    } as Response;
  }

  function mockBinaryResponse(bytes: number) {
    return {
      ok: true,
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    } as Response;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    mockedProbeSourcePlaybackUpstream.mockReset();
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('maps upstream direct probe results and hls metrics into offline ranking shape', async () => {
    mockedProbeSourcePlaybackUpstream.mockResolvedValue({
      kind: 'direct',
      reason: '媒体地址可直接跨域访问',
      domain: 'media.example.com',
      upstreamStatus: 200,
      probeTimeMs: 321,
    });
    jest.spyOn(Date, 'now')
      .mockReturnValueOnce(1710000000000)
      .mockReturnValueOnce(1710000000100)
      .mockReturnValueOnce(1710000000350);
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValueOnce(
      mockTextResponse(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080
high/index.m3u8`
      )
    ).mockResolvedValueOnce(
      mockTextResponse(
        `#EXTM3U
#EXTINF:4,
seg-1.ts`
      )
    ).mockResolvedValueOnce(
      mockBinaryResponse(256 * 1024)
    );

    const result = await probePlaybackForRanking(
      'https://media.example.com/video.m3u8',
      'https://app.example.com'
    );

    expect(result).toEqual({
      kind: 'direct',
      reason: '媒体地址可直接跨域访问',
      domain: 'media.example.com',
      upstreamStatus: 200,
      probeTimeMs: 321,
      resolutionLabel: '1080p',
      firstSegmentLatencyMs: expect.any(Number),
      firstSegmentSpeedKbps: expect.any(Number),
    });
    expect(result.firstSegmentLatencyMs).toBeGreaterThan(0);
    expect(result.firstSegmentSpeedKbps).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps playability result when hls metric probing fails', async () => {
    mockedProbeSourcePlaybackUpstream.mockResolvedValue({
      kind: 'proxy',
      reason: '需要代理',
      domain: 'media.example.com',
      upstreamStatus: 403,
      probeTimeMs: 654,
    });
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    await expect(
      probePlaybackForRanking(
        'https://media.example.com/video.m3u8',
        'https://app.example.com'
      )
    ).resolves.toEqual({
      kind: 'proxy',
      reason: '需要代理',
      domain: 'media.example.com',
      upstreamStatus: 403,
      probeTimeMs: 654,
      resolutionLabel: null,
      firstSegmentLatencyMs: null,
      firstSegmentSpeedKbps: null,
    });
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
        kind: 'proxy',
        reason: '需要代理',
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
      'proxy',
      '需要代理',
      403,
      780,
      null,
      null,
      null,
      1710000000000
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('maps unavailable upstream probe results into offline ranking shape', async () => {
    mockedProbeSourcePlaybackUpstream.mockResolvedValue({
      kind: 'unavailable',
      reason: '上游响应失败: 502',
      domain: 'media.example.com',
      upstreamStatus: 502,
      probeTimeMs: 915,
    });

    await expect(
      probePlaybackForRanking(
        'https://media.example.com/video.m3u8',
        'https://app.example.com'
      )
    ).resolves.toEqual({
      kind: 'unavailable',
      reason: '上游响应失败: 502',
      domain: 'media.example.com',
      upstreamStatus: 502,
      probeTimeMs: 915,
      resolutionLabel: null,
      firstSegmentLatencyMs: null,
      firstSegmentSpeedKbps: null,
    });
  });
});
