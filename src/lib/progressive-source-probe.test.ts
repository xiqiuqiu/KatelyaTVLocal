import {
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
});
