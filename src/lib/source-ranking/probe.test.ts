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

  afterEach(() => {
    jest.restoreAllMocks();
    mockedProbeSourcePlaybackUpstream.mockReset();
  });

  it('maps upstream direct probe results into offline ranking shape', async () => {
    mockedProbeSourcePlaybackUpstream.mockResolvedValue({
      kind: 'direct',
      reason: '媒体地址可直接跨域访问',
      domain: 'media.example.com',
      upstreamStatus: 200,
      probeTimeMs: 321,
    });

    await expect(
      probePlaybackForRanking(
        'https://media.example.com/video.m3u8',
        'https://app.example.com'
      )
    ).resolves.toEqual({
      kind: 'direct',
      reason: '媒体地址可直接跨域访问',
      domain: 'media.example.com',
      upstreamStatus: 200,
      probeTimeMs: 321,
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
