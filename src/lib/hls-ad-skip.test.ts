import type { M3U8AdCandidate } from './hls-ad-filter';
import {
  AD_WINDOW_CONFIRM_SILENT_THRESHOLD,
  AD_WINDOW_UNDO_DEMOTE_THRESHOLD,
  getHlsAdSkipDecision,
  resolveAdWindowTrustTier,
  toHlsAdSkipWindows,
  toUserMarkAdSkipWindow,
} from './hls-ad-skip';

describe('resolveAdWindowTrustTier', () => {
  it('defaults cold-start seeds (no confirmation history) to recoverable', () => {
    expect(resolveAdWindowTrustTier({})).toBe('recoverable');
    expect(
      resolveAdWindowTrustTier({ confirmCount: 0, undoCount: 0 })
    ).toBe('recoverable');
  });

  it('demotes to observe when undo count reaches the repeated-undo threshold', () => {
    expect(
      resolveAdWindowTrustTier({
        confirmCount: 5,
        undoCount: AD_WINDOW_UNDO_DEMOTE_THRESHOLD,
        trustScore: 5,
      })
    ).toBe('observe');
  });

  it('promotes to silent when confirm count reaches the repeated-confirm threshold', () => {
    expect(
      resolveAdWindowTrustTier({
        confirmCount: AD_WINDOW_CONFIRM_SILENT_THRESHOLD,
        undoCount: 0,
        trustScore: AD_WINDOW_CONFIRM_SILENT_THRESHOLD,
      })
    ).toBe('silent');
  });

  it('keeps mid-trust windows recoverable below both thresholds', () => {
    expect(
      resolveAdWindowTrustTier({
        confirmCount: AD_WINDOW_CONFIRM_SILENT_THRESHOLD - 1,
        undoCount: AD_WINDOW_UNDO_DEMOTE_THRESHOLD - 1,
        trustScore: 1,
      })
    ).toBe('recoverable');
  });

  it('lets undo demotion win over confirm promotion (zero false-positive)', () => {
    expect(
      resolveAdWindowTrustTier({
        confirmCount: AD_WINDOW_CONFIRM_SILENT_THRESHOLD + 2,
        undoCount: AD_WINDOW_UNDO_DEMOTE_THRESHOLD,
        trustScore: 10,
      })
    ).toBe('observe');
  });

  it('does not promote on trustScore alone without repeated confirms', () => {
    expect(
      resolveAdWindowTrustTier({
        confirmCount: 1,
        undoCount: 0,
        trustScore: AD_WINDOW_CONFIRM_SILENT_THRESHOLD,
      })
    ).toBe('recoverable');
  });
});

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

  it('does not auto-skip observe-tier windows', () => {
    const decision = getHlsAdSkipDecision({
      currentTimeSeconds: 12,
      windows: [{ ...windows[0], trustTier: 'observe' }],
      nowMs: 10000,
    });

    expect(decision.shouldSkip).toBe(false);
    expect(decision.reason).toBe('observe-tier');
    expect(decision.windowKey).toBe('rule-1:10.000-20.000');
  });

  it('auto-skips silent-tier windows the same as recoverable', () => {
    const decision = getHlsAdSkipDecision({
      currentTimeSeconds: 12,
      windows: [{ ...windows[0], trustTier: 'silent' }],
      nowMs: 10000,
    });

    expect(decision.shouldSkip).toBe(true);
    expect(decision.reason).toBe('ad-window');
  });
});

describe('toUserMarkAdSkipWindow', () => {
  it('builds a session-local high-confidence user mark window', () => {
    expect(toUserMarkAdSkipWindow({ startTimeSeconds: 10, endTimeSeconds: 14 })).toEqual({
      startTimeSeconds: 10,
      endTimeSeconds: 14,
      ruleId: 'user-mark',
      confidence: 'high',
      action: 'filter',
      origin: 'user-mark',
      trustTier: 'recoverable',
      confirmCount: 1,
      undoCount: 0,
      trustScore: 1,
    });
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
        trustTier: 'recoverable',
        origin: 'analyzer',
      }),
    ]);
  });
});
