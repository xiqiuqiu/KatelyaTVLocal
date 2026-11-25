import {
  createProgressiveSourceProbeFailureStatus,
  selectProgressiveSourceProbeCandidates,
  shouldStartProgressiveSourceProbe,
} from '@/lib/progressive-source-probe';
import { SearchResult, SourceStatus } from '@/lib/types';

function createSource(
  source: string,
  id: string,
  episodes: string[] = ['https://example.com/1.m3u8']
): SearchResult {
  return {
    id,
    source,
    title: `${source}-${id}`,
    year: '2026',
    poster: '',
    episodes,
    source_name: source,
  };
}

describe('progressive source probe scheduling', () => {
  it('does not start while playback is unstable or controlled by the user', () => {
    expect(
      shouldStartProgressiveSourceProbe({
        now: 20_000,
        stablePlaybackStartedAt: 10_000,
        stablePlaybackDelayMs: 8_000,
        isPaused: false,
        isEnded: false,
        isSeeking: false,
        isVideoLoading: false,
        isRecoveryActive: false,
        inFlight: false,
        foregroundReady: true,
      })
    ).toBe(true);

    expect(
      shouldStartProgressiveSourceProbe({
        now: 12_000,
        stablePlaybackStartedAt: 10_000,
        stablePlaybackDelayMs: 8_000,
        isPaused: false,
        isEnded: false,
        isSeeking: false,
        isVideoLoading: false,
        isRecoveryActive: false,
        inFlight: false,
        foregroundReady: true,
      })
    ).toBe(false);

    expect(
      shouldStartProgressiveSourceProbe({
        now: 20_000,
        stablePlaybackStartedAt: 10_000,
        stablePlaybackDelayMs: 8_000,
        isPaused: true,
        isEnded: false,
        isSeeking: false,
        isVideoLoading: false,
        isRecoveryActive: false,
        inFlight: false,
        foregroundReady: true,
      })
    ).toBe(false);

    expect(
      shouldStartProgressiveSourceProbe({
        now: 20_000,
        stablePlaybackStartedAt: 10_000,
        stablePlaybackDelayMs: 8_000,
        isPaused: false,
        isEnded: false,
        isSeeking: true,
        isVideoLoading: false,
        isRecoveryActive: false,
        inFlight: false,
        foregroundReady: true,
      })
    ).toBe(false);
  });

  it('defers backup work while the foreground buffer is too low', () => {
    expect(
      shouldStartProgressiveSourceProbe({
        now: 30_000,
        stablePlaybackStartedAt: 10_000,
        stablePlaybackDelayMs: 10_000,
        isPaused: false,
        isEnded: false,
        isSeeking: false,
        isVideoLoading: false,
        isRecoveryActive: false,
        inFlight: false,
        foregroundReady: false,
      })
    ).toBe(false);
  });

  it('selects one unprobed direct candidate after the current source using score order', () => {
    const current = createSource('current', '1');
    const fast = createSource('fast', '2');
    const slow = createSource('slow', '3');
    const failed = createSource('failed', '4');
    const statuses = new Map<string, SourceStatus>([
      ['fast-2', { kind: 'direct', reason: 'ranked fast', rankScore: 90 }],
      ['slow-3', { kind: 'direct', reason: 'ranked slow', rankScore: 20 }],
      ['failed-4', { kind: 'unavailable', reason: 'recent failure' }],
    ]);
    const scores = new Map([
      ['fast-2', { score: 110 }],
      ['slow-3', { score: 82 }],
      ['failed-4', { score: -20 }],
    ]);

    expect(
      selectProgressiveSourceProbeCandidates({
        sources: [current, slow, failed, fast],
        currentSourceKey: 'current-1',
        attemptedSourceKeys: new Set(['slow-3']),
        statuses,
        scores,
        currentEpisodeIndex: 0,
        limit: 1,
        getSourceKey: (source) => `${source.source}-${source.id}`,
      }).map((source) => `${source.source}-${source.id}`)
    ).toEqual(['fast-2']);
  });

  it('prepares an alternate media host for this episode before a higher-scoring same-host backup', () => {
    const current = createSource('current', '1', [
      'https://old.example.com/1',
      'https://a.example.com/2',
    ]);
    const same = createSource('same', '2', [
      'https://other.example.com/1',
      'https://a.example.com/2',
    ]);
    const alternate = createSource('alternate', '3', [
      'https://a.example.com/1',
      'https://b.example.com/2',
    ]);
    const input = {
      sources: [current, same, alternate],
      currentSourceKey: 'current-1',
      attemptedSourceKeys: new Set<string>(),
      statuses: new Map<string, SourceStatus>([['same-2', { kind: 'direct' }]]),
      scores: new Map([
        ['same-2', { score: 98 }],
        ['alternate-3', { score: 74 }],
      ]),
      currentEpisodeIndex: 1,
      limit: 1,
    };
    expect(selectProgressiveSourceProbeCandidates(input)).toEqual([alternate]);
    expect(
      selectProgressiveSourceProbeCandidates({
        ...input,
        attemptedSourceKeys: new Set(['alternate-3']),
      })
    ).toEqual([same]);
  });

  it('marks background probe failures as soft unavailable, not verified', () => {
    const status = createProgressiveSourceProbeFailureStatus({
      domain: 'media.example.com',
      reason: 'metadata probe failed',
    });

    expect(status.kind).toBe('unavailable');
    expect(status.playbackMode).toBe('direct');
    expect(status.domain).toBe('media.example.com');
    expect(status.reason).toBe(
      '后台测速未通过（metadata probe failed），可手动尝试'
    );
    expect(status.localConfidence).toBe('low');
  });
});
