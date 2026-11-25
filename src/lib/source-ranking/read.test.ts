import { readLatestSourceRanks } from '@/lib/source-ranking/read';
import { SOURCE_CORS_BLOCKED_REASON } from '@/lib/types';

describe('source ranking read', () => {
  it('omits legacy probe rows and keeps a CORS block even before a snapshot exists', async () => {
    const now = 1710000400000;
    const all = jest
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            sourceKey: 'legacy-with-rank',
            directRate: 100,
            proxyRate: 0,
            unavailableRate: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          { sourceKey: 'legacy-with-rank', kind: 'proxy', measuredAt: now },
          { sourceKey: 'legacy-feedback-only', kind: 'proxy', measuredAt: now },
          {
            sourceKey: 'blocked',
            kind: 'unavailable',
            reason: SOURCE_CORS_BLOCKED_REASON,
            measuredAt: now,
          },
        ],
      })
      .mockResolvedValueOnce({
        results: ['legacy-with-rank', 'legacy-feedback-only', 'blocked'].map(
          (sourceKey) => ({ sourceKey, startupSuccess: 1, recordedAt: now - 1 })
        ),
      });
    const prepare = jest.fn().mockReturnValue({ bind: () => ({ all }) });

    await expect(
      readLatestSourceRanks(
        { DB: { prepare } },
        ['legacy-with-rank', 'legacy-feedback-only', 'blocked'],
        '24h',
        now
      )
    ).resolves.toEqual([
      expect.objectContaining({
        sourceKey: 'blocked',
        kind: 'unavailable',
        reason: SOURCE_CORS_BLOCKED_REASON,
      }),
    ]);
  });

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
            kind: 'direct',
            reason: '已确认直连',
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
      3,
      expect.stringMatching(
        /playback_mode = 'direct'\s+AND switched_to_proxy = 0/
      )
    );
    expect(prepare).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('updated_at >= ?')
    );
    expect(prepare).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        'source_rank_snapshots.updated_at BETWEEN run.started_at AND run.finished_at'
      )
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
        kind: 'direct',
        reason: '已确认直连',
        domain: 'probe.alpha.example',
        probeTimeMs: 340,
        qualityLabel: '4K',
        speedLabel: '299.1 KB/s',
        speedSource: 'backend',
        speedUpdatedAt: 1710000200000,
        speedPending: false,
        pingTimeMs: 88,
        latencyMs: 280,
        speedKbps: 2450,
        updatedAt: 1710000300000,
        rankingSource: 'd1',
        rankScore: 99.5,
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
        speedLabel: '187.5 KB/s',
        pingTimeMs: 360,
        latencyMs: 360,
        speedKbps: 1536,
      }),
    ]);
  });

  it('bounds repeated feedback influence on a source rank', async () => {
    const repeatedFailures = Array.from({ length: 100 }, (_, index) => ({
      sourceKey: 'alpha',
      playbackDomain: 'feedback.example',
      startupSuccess: 0,
      startupTimeMs: 9000,
      browserQuality: null,
      browserPingMs: null,
      browserSpeedLabel: null,
      sessionError: 'startup failed',
      recordedAt: 1710000300000 - index,
    }));
    const repeatedSuccesses = Array.from({ length: 100 }, (_, index) => ({
      sourceKey: 'beta',
      playbackDomain: 'feedback.example',
      startupSuccess: 1,
      startupTimeMs: 1000,
      browserQuality: null,
      browserPingMs: null,
      browserSpeedLabel: null,
      sessionError: null,
      recordedAt: 1710000300000 - index,
    }));
    const all = jest
      .fn()
      .mockResolvedValueOnce({
        results: ['alpha', 'beta'].map((sourceKey) => ({
          sourceKey,
          playbackDomain: 'rank.example',
          finalScore: 80,
          successRate: 90,
          directRate: 90,
          proxyRate: 0,
          unavailableRate: 0,
          updatedAt: 1710000000000,
        })),
      })
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce({
        results: [...repeatedFailures, ...repeatedSuccesses],
      });
    const bind = jest.fn().mockReturnValue({ all });
    const prepare = jest.fn().mockReturnValue({ bind });

    const results = await readLatestSourceRanks(
      { DB: { prepare } },
      ['alpha', 'beta'],
      '24h',
      1710000400000
    );

    expect(
      results.find((result) => result.sourceKey === 'alpha')?.rankScore
    ).toBe(40);
    expect(
      results.find((result) => result.sourceKey === 'beta')?.rankScore
    ).toBe(100);
  });
});
