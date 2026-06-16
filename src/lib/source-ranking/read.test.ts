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
        speedSource: 'browser',
        speedUpdatedAt: 1710000300000,
        speedPending: false,
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
        probeTimeMs: undefined,
        qualityLabel: null,
        speedLabel: null,
        speedSource: 'none',
        speedUpdatedAt: undefined,
        speedPending: true,
        pingTimeMs: null,
        latencyMs: null,
        speedKbps: null,
        updatedAt: 1710000350000,
        rankingSource: 'd1',
        rankScore: 56.2,
      },
    ]);
  });

  it('returns recent playback feedback even when no snapshot exists for a source', async () => {
    const all = jest
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            sourceKey: 'snap',
            playbackDomain: 'rank.snap.example',
            finalScore: 70,
            successRate: 90,
            directRate: 90,
            proxyRate: 0,
            unavailableRate: 0,
            updatedAt: 1710000000000,
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [],
      })
      .mockResolvedValueOnce({
        results: [
          {
            sourceKey: 'feedback-fast',
            playbackDomain: 'fast.example',
            startupSuccess: 1,
            startupTimeMs: 1800,
            switchedToProxy: 0,
            browserQuality: null,
            browserPingMs: null,
            browserSpeedLabel: null,
            sessionError: null,
            recordedAt: 1710000300000,
          },
          {
            sourceKey: 'feedback-bad',
            playbackDomain: 'bad.example',
            startupSuccess: 0,
            startupTimeMs: 9000,
            switchedToProxy: 0,
            browserQuality: null,
            browserPingMs: null,
            browserSpeedLabel: null,
            sessionError: 'ios-native-stall',
            recordedAt: 1710000200000,
          },
        ],
      });
    const bind = jest.fn().mockReturnValue({ all });
    const prepare = jest.fn().mockReturnValue({ bind });

    const results = await readLatestSourceRanks(
      { DB: { prepare } },
      ['snap', 'feedback-fast', 'feedback-bad'],
      '24h',
      1710000400000
    );

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: 'feedback-fast',
          kind: 'direct',
          reason: '近期本机播放成功，优先直连',
          domain: 'fast.example',
          pingTimeMs: null,
          speedLabel: null,
          rankingSource: 'd1',
        }),
        expect.objectContaining({
          sourceKey: 'feedback-bad',
          kind: 'unavailable',
          reason: 'ios-native-stall',
          domain: 'bad.example',
          rankingSource: 'd1',
        }),
      ])
    );
    const fastRankScore = results.find(
      (result) => result.sourceKey === 'feedback-fast'
    )?.rankScore;
    const badRankScore = results.find(
      (result) => result.sourceKey === 'feedback-bad'
    )?.rankScore;
    expect(fastRankScore).toBeGreaterThan(
      badRankScore ?? Number.POSITIVE_INFINITY
    );
  });

  it('falls back to backend probe speed and latency when browser feedback has no speed metrics', async () => {
    const all = jest
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            sourceKey: 'probe-only',
            playbackDomain: 'rank.example',
            finalScore: 84,
            successRate: 92,
            directRate: 92,
            proxyRate: 0,
            unavailableRate: 0,
            updatedAt: 1710000000000,
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            sourceKey: 'probe-only',
            domain: 'probe.example',
            kind: 'direct',
            reason: '后端首段探测通过',
            probeTimeMs: 510,
            resolutionLabel: '1080p',
            firstSegmentLatencyMs: 360,
            firstSegmentSpeedKbps: 1536,
            measuredAt: 1710000200000,
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            sourceKey: 'probe-only',
            playbackDomain: 'feedback.example',
            startupSuccess: 1,
            startupTimeMs: 3200,
            switchedToProxy: 0,
            browserQuality: null,
            browserPingMs: null,
            browserSpeedLabel: null,
            sessionError: null,
            recordedAt: 1710000300000,
          },
        ],
      });
    const bind = jest.fn().mockReturnValue({ all });
    const prepare = jest.fn().mockReturnValue({ bind });

    const results = await readLatestSourceRanks(
      { DB: { prepare } },
      ['probe-only'],
      '24h',
      1710000400000
    );

    expect(results).toEqual([
      expect.objectContaining({
        sourceKey: 'probe-only',
        qualityLabel: '1080p',
        speedLabel: '1.5 MB/s',
        pingTimeMs: 360,
        latencyMs: 360,
        speedKbps: 1536,
      }),
    ]);
  });
});
