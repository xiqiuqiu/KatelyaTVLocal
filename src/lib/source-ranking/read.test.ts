import { readLatestSourceRanks } from '@/lib/source-ranking/read';

describe('source ranking read', () => {
  it('reads requested 7-day snapshot rows and merges latest probe plus feedback details', async () => {
    const all = jest
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            sourceKey: 'alpha',
            playbackDomain: 'rank.alpha.example',
            finalScore: 91.5,
            successRate: 96,
            directRate: 70,
            proxyRate: 20,
            unavailableRate: 4,
            updatedAt: 1710000000000,
          },
          {
            sourceKey: 'beta',
            playbackDomain: 'rank.beta.example',
            finalScore: 80.2,
            successRate: 72,
            directRate: 20,
            proxyRate: 45,
            unavailableRate: 10,
            updatedAt: 1710000100000,
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            sourceKey: 'alpha',
            domain: 'probe.alpha.example',
            kind: 'proxy',
            reason: '最近探测建议代理',
            probeTimeMs: 340,
            resolutionLabel: '1080p',
            firstSegmentLatencyMs: 280,
            firstSegmentSpeedKbps: 2450,
            measuredAt: 1710000200000,
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            sourceKey: 'alpha',
            playbackDomain: 'feedback.alpha.example',
            startupSuccess: 1,
            startupTimeMs: 1200,
            switchedToProxy: 0,
            browserQuality: '4K',
            browserPingMs: 88,
            browserSpeedLabel: '2.4 MB/s',
            sessionError: null,
            recordedAt: 1710000300000,
          },
          {
            sourceKey: 'beta',
            playbackDomain: 'feedback.beta.example',
            startupSuccess: 0,
            startupTimeMs: 6200,
            switchedToProxy: 1,
            browserQuality: null,
            browserPingMs: null,
            browserSpeedLabel: null,
            sessionError: 'startup failed',
            recordedAt: 1710000350000,
          },
        ],
      });
    const bind = jest.fn().mockReturnValue({ all });
    const prepare = jest.fn().mockReturnValue({ bind });

    const results = await readLatestSourceRanks(
      { DB: { prepare } },
      ['alpha', 'beta', 'missing'],
      '24h',
      1710000400000
    );

    expect(prepare).toHaveBeenCalledTimes(3);
    expect(prepare).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('updated_at >= ?')
    );
    expect(bind).toHaveBeenNthCalledWith(
      1,
      '24h',
      1709395600000,
      'alpha',
      'beta',
      'missing'
    );
    expect(bind).toHaveBeenNthCalledWith(
      2,
      'alpha',
      'beta',
      'missing',
      1709395600000
    );
    expect(bind).toHaveBeenNthCalledWith(
      3,
      'alpha',
      'beta',
      'missing',
      1709395600000
    );
    expect(results).toEqual([
      {
        sourceKey: 'alpha',
        kind: 'proxy',
        reason: '最近探测建议代理',
        domain: 'probe.alpha.example',
        probeTimeMs: 340,
        qualityLabel: '4K',
        speedLabel: '2.4 MB/s',
        pingTimeMs: 88,
        latencyMs: 280,
        speedKbps: 2450,
        updatedAt: 1710000300000,
        rankingSource: 'd1',
        rankScore: 99.5,
      },
      {
        sourceKey: 'beta',
        kind: 'proxy',
        reason: '近期成功率 72%，更适合代理',
        domain: 'rank.beta.example',
        qualityLabel: null,
        speedLabel: null,
        pingTimeMs: null,
        latencyMs: null,
        speedKbps: null,
        updatedAt: 1710000350000,
        rankingSource: 'd1',
        rankScore: 56.2,
      },
    ]);
  });
});
