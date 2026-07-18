import type { HlsAdSkipWindow } from '@/lib/hls-ad-skip';
import {
  AD_WINDOW_CONFIRM_SILENT_THRESHOLD,
  AD_WINDOW_UNDO_DEMOTE_THRESHOLD,
} from '@/lib/hls-ad-skip';

import {
  applyAdSkipWindowConfirmation,
  generateAdSkipConfigKey,
  mergeAdSkipWindowsForLoad,
  mergeEpisodeAdSkipConfigs,
  toPersistedAdSkipWindow,
  type EpisodeAdSkipConfig,
  type PersistedAdSkipWindow,
} from '@/lib/ad-skip-window';

describe('generateAdSkipConfigKey', () => {
  it('keys by source, id, and episodeIndex on the logical timeline identity', () => {
    expect(generateAdSkipConfigKey('ruyi', '38961', 0)).toBe(
      'ruyi+38961+0'
    );
  });
});

describe('mergeAdSkipWindowsForLoad', () => {
  it('merges persisted windows with analyzer seeds without using host or segment URL', () => {
    const persisted: PersistedAdSkipWindow[] = [
      {
        source: 'ruyi',
        id: '38961',
        episodeIndex: 0,
        startTimeSeconds: 10,
        endTimeSeconds: 20,
        trustScore: 1,
        confirmCount: 1,
        undoCount: 0,
        updated_time: 1000,
        ruleId: 'user-mark',
        origin: 'persisted',
      },
    ];
    const analyzer: HlsAdSkipWindow[] = [
      {
        startTimeSeconds: 100,
        endTimeSeconds: 110,
        ruleId: 'cue-out',
        confidence: 'high',
        action: 'filter',
      },
      // Same range as persisted — persisted wins / no duplicate.
      {
        startTimeSeconds: 10,
        endTimeSeconds: 20,
        ruleId: 'auto',
        confidence: 'high',
        action: 'filter',
      },
    ];

    expect(mergeAdSkipWindowsForLoad({ persisted, analyzer })).toEqual([
      {
        startTimeSeconds: 10,
        endTimeSeconds: 20,
        ruleId: 'user-mark',
        confidence: 'high',
        action: 'filter',
        origin: 'persisted',
        confirmCount: 1,
        undoCount: 0,
        trustScore: 1,
        trustTier: 'recoverable',
      },
      {
        startTimeSeconds: 100,
        endTimeSeconds: 110,
        ruleId: 'cue-out',
        confidence: 'high',
        action: 'filter',
        origin: 'analyzer',
        trustTier: 'recoverable',
      },
    ]);
  });

  it('resolves observe / silent tiers from persisted confirmation counts on load', () => {
    const demoted: PersistedAdSkipWindow[] = [
      toPersistedAdSkipWindow({
        source: 'ruyi',
        id: '38961',
        episodeIndex: 0,
        startTimeSeconds: 10,
        endTimeSeconds: 20,
        confirmCount: 1,
        undoCount: AD_WINDOW_UNDO_DEMOTE_THRESHOLD,
        trustScore: 0,
        updated_time: 1000,
      }),
    ];
    const promoted: PersistedAdSkipWindow[] = [
      toPersistedAdSkipWindow({
        source: 'ruyi',
        id: '38961',
        episodeIndex: 0,
        startTimeSeconds: 100,
        endTimeSeconds: 110,
        confirmCount: AD_WINDOW_CONFIRM_SILENT_THRESHOLD,
        undoCount: 0,
        trustScore: AD_WINDOW_CONFIRM_SILENT_THRESHOLD,
        updated_time: 1000,
      }),
    ];

    expect(mergeAdSkipWindowsForLoad({ persisted: demoted, analyzer: [] })[0].trustTier).toBe(
      'observe'
    );
    expect(mergeAdSkipWindowsForLoad({ persisted: promoted, analyzer: [] })[0].trustTier).toBe(
      'silent'
    );
  });
});

describe('applyAdSkipWindowConfirmation', () => {
  const baseWindow = {
    startTimeSeconds: 10,
    endTimeSeconds: 20,
    ruleId: 'user-mark' as const,
  };

  it('upserts a mark confirmation with placeholder trust fields', () => {
    const config = applyAdSkipWindowConfirmation({
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      existing: null,
      window: baseWindow,
      kind: 'confirm',
      nowMs: 5000,
    });

    expect(config).toEqual({
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      updated_time: 5000,
      windows: [
        {
          source: 'ruyi',
          id: '38961',
          episodeIndex: 0,
          startTimeSeconds: 10,
          endTimeSeconds: 20,
          trustScore: 1,
          confirmCount: 1,
          undoCount: 0,
          updated_time: 5000,
          ruleId: 'user-mark',
          origin: 'persisted',
        },
      ],
    } satisfies EpisodeAdSkipConfig);
  });

  it('increments confirmCount when the same window is confirmed again', () => {
    const existing: EpisodeAdSkipConfig = {
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      updated_time: 1000,
      windows: [
        toPersistedAdSkipWindow({
          source: 'ruyi',
          id: '38961',
          episodeIndex: 0,
          startTimeSeconds: 10,
          endTimeSeconds: 20,
          ruleId: 'user-mark',
          trustScore: 1,
          confirmCount: 1,
          undoCount: 0,
          updated_time: 1000,
        }),
      ],
    };

    const next = applyAdSkipWindowConfirmation({
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      existing,
      window: baseWindow,
      kind: 'confirm',
      nowMs: 6000,
    });

    expect(next!.windows[0]).toMatchObject({
      confirmCount: 2,
      trustScore: 2,
      undoCount: 0,
      updated_time: 6000,
    });
  });

  it('increments undoCount on an existing window without removing it', () => {
    const existing: EpisodeAdSkipConfig = {
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      updated_time: 1000,
      windows: [
        toPersistedAdSkipWindow({
          source: 'ruyi',
          id: '38961',
          episodeIndex: 0,
          startTimeSeconds: 10,
          endTimeSeconds: 20,
          ruleId: 'cue-out',
          trustScore: 1,
          confirmCount: 1,
          undoCount: 0,
          updated_time: 1000,
        }),
      ],
    };

    const next = applyAdSkipWindowConfirmation({
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      existing,
      window: {
        startTimeSeconds: 10,
        endTimeSeconds: 20,
        ruleId: 'cue-out',
      },
      kind: 'undo',
      nowMs: 7000,
    });

    expect(next!.windows).toHaveLength(1);
    expect(next!.windows[0]).toMatchObject({
      confirmCount: 1,
      undoCount: 1,
      trustScore: 0,
      updated_time: 7000,
    });
  });

  it('does not create a new persisted window for undo of an unknown analyzer window', () => {
    const next = applyAdSkipWindowConfirmation({
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      existing: null,
      window: {
        startTimeSeconds: 10,
        endTimeSeconds: 20,
        ruleId: 'cue-out',
      },
      kind: 'undo',
      nowMs: 7000,
    });

    expect(next).toBeNull();
  });
});

describe('mergeEpisodeAdSkipConfigs', () => {
  it('unions different timeline windows so concurrent writers do not drop siblings', () => {
    const existing: EpisodeAdSkipConfig = {
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      updated_time: 1000,
      windows: [
        toPersistedAdSkipWindow({
          source: 'ruyi',
          id: '38961',
          episodeIndex: 0,
          startTimeSeconds: 10,
          endTimeSeconds: 20,
          ruleId: 'user-mark',
          updated_time: 1000,
        }),
      ],
    };
    const incoming: EpisodeAdSkipConfig = {
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      updated_time: 2000,
      windows: [
        toPersistedAdSkipWindow({
          source: 'ruyi',
          id: '38961',
          episodeIndex: 0,
          startTimeSeconds: 100,
          endTimeSeconds: 110,
          ruleId: 'cue-out',
          updated_time: 2000,
        }),
      ],
    };

    const merged = mergeEpisodeAdSkipConfigs(existing, incoming);
    expect(merged.windows).toHaveLength(2);
    expect(merged.windows.map((w) => w.startTimeSeconds).sort()).toEqual([
      10, 100,
    ]);
  });

  it('keeps the higher confirm/undo counts for the same timeline range', () => {
    const existing: EpisodeAdSkipConfig = {
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      updated_time: 1000,
      windows: [
        toPersistedAdSkipWindow({
          source: 'ruyi',
          id: '38961',
          episodeIndex: 0,
          startTimeSeconds: 10,
          endTimeSeconds: 20,
          confirmCount: 3,
          undoCount: 1,
          updated_time: 1000,
        }),
      ],
    };
    const incoming: EpisodeAdSkipConfig = {
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      updated_time: 2000,
      windows: [
        toPersistedAdSkipWindow({
          source: 'ruyi',
          id: '38961',
          episodeIndex: 0,
          startTimeSeconds: 10,
          endTimeSeconds: 20,
          confirmCount: 2,
          undoCount: 0,
          updated_time: 2000,
        }),
      ],
    };

    expect(mergeEpisodeAdSkipConfigs(existing, incoming).windows[0]).toMatchObject({
      confirmCount: 3,
      undoCount: 1,
      updated_time: 2000,
    });
  });
});
