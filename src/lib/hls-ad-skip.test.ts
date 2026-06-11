import type { M3U8AdCandidate } from './hls-ad-filter';
import {
  getHlsAdSkipDecision,
  toHlsAdSkipWindows,
} from './hls-ad-skip';

describe('getHlsAdSkipDecision', () => {
  const windows = [
    {
      startTimeSeconds: 10,
      endTimeSeconds: 20,
      ruleId: 'rule-1',
      confidence: 'high' as const,
      action: 'filter' as const,
    },
  ];

  it('skips to the end of a high confidence ad window with padding', () => {
    const decision = getHlsAdSkipDecision({
      currentTimeSeconds: 12,
      windows,
      nowMs: 10000,
      paddingSeconds: 0.5,
    });

    expect(decision.shouldSkip).toBe(true);
    expect(decision.targetTimeSeconds).toBe(20.5);
    expect(decision.windowKey).toBe('rule-1:10.000-20.000');
  });

  it('does not repeatedly skip the same window after a successful seek', () => {
    const decision = getHlsAdSkipDecision({
      currentTimeSeconds: 13,
      windows,
      lastSkippedWindowKey: 'rule-1:10.000-20.000',
      nowMs: 10000,
    });

    expect(decision.shouldSkip).toBe(false);
    expect(decision.reason).toBe('already-skipped');
  });

  it('does not force a skip immediately after a manual seek', () => {
    const decision = getHlsAdSkipDecision({
      currentTimeSeconds: 12,
      windows,
      lastUserSeekAtMs: 9000,
      nowMs: 10000,
    });

    expect(decision.shouldSkip).toBe(false);
    expect(decision.reason).toBe('manual-seek-grace');
  });

  it('ignores playback outside ad windows', () => {
    const decision = getHlsAdSkipDecision({
      currentTimeSeconds: 21,
      windows,
      nowMs: 10000,
    });

    expect(decision.shouldSkip).toBe(false);
    expect(decision.reason).toBe('no-window');
  });
});

describe('toHlsAdSkipWindows', () => {
  it('keeps only high confidence filter candidates', () => {
    const candidates: M3U8AdCandidate[] = [
      {
        startTimeSeconds: 10,
        endTimeSeconds: 20,
        durationSeconds: 10,
        segmentIndexes: [1, 2],
        segmentCount: 2,
        reasons: ['cue-marker'],
        confidence: 'high',
        action: 'filter',
        hosts: ['media.example.com'],
        sampleUrls: ['ad-1.ts'],
      },
      {
        startTimeSeconds: 30,
        endTimeSeconds: 35,
        durationSeconds: 5,
        segmentIndexes: [3],
        segmentCount: 1,
        reasons: ['short-discontinuity'],
        confidence: 'low',
        action: 'observe',
        hosts: ['media.example.com'],
        sampleUrls: ['short.ts'],
      },
    ];

    expect(toHlsAdSkipWindows(candidates)).toEqual([
      expect.objectContaining({
        startTimeSeconds: 10,
        endTimeSeconds: 20,
      }),
    ]);
  });
});
