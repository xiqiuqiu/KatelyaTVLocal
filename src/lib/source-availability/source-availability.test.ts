import type { SearchResult, SourceStatus, SourceVideoInfo } from '@/lib/types';

import {
  clearAttemptedLedgersOnEpisodeChange,
  clearAttemptedLedgersOnTitleChange,
} from './attempted-ledgers';
import {
  buildSourceAvailabilityList,
  resolveSourceStatusEvidence,
  selectInitialSourceCandidate,
  selectRecoveryCandidate,
} from './index';

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

function createSelectionScore(
  source: SearchResult,
  score: number,
  originalIndex: number
) {
  const sourceKey = `${source.source}-${source.id}`;
  return {
    sourceKey,
    score,
    reason: '测试排序',
    source,
    originalIndex,
  };
}

describe('buildSourceAvailabilityList', () => {
  it('keeps the current source first and blocks manual switching to it', () => {
    const current = createSource('current', '1');
    const other = createSource('other', '2');

    const list = buildSourceAvailabilityList({
      sources: [other, current],
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
    });

    expect(list.map((item) => item.sourceKey)).toEqual([
      'current-1',
      'other-2',
    ]);
    expect(list[0]).toMatchObject({
      isCurrent: true,
      manualSwitch: {
        mode: 'blocked',
        reason: '当前正在播放此线路',
      },
      autoRecovery: {
        eligible: false,
        reason: '当前正在播放此线路',
      },
    });
  });

  it('blocks a source that lacks the current episode URL', () => {
    const list = buildSourceAvailabilityList({
      sources: [createSource('short', '1', ['episode-1.m3u8'])],
      currentEpisodeIndex: 2,
    });

    expect(list[0]).toMatchObject({
      episode: {
        exists: false,
        url: null,
        reason: '当前集不可用',
      },
      manualSwitch: {
        mode: 'blocked',
        reason: '当前集不可用',
      },
      autoRecovery: {
        eligible: false,
        reason: '当前集不可用',
      },
    });
  });

  it('does not treat proxy-required sources as directly switchable in the first slice', () => {
    const statuses = new Map<string, SourceStatus>([
      [
        'proxy-1',
        {
          kind: 'proxy',
          reason: '上游可用，但浏览器跨域受限',
          playbackMode: 'proxy',
        },
      ],
    ]);

    const list = buildSourceAvailabilityList({
      sources: [createSource('proxy', '1')],
      currentEpisodeIndex: 0,
      statuses,
    });

    expect(list[0]).toMatchObject({
      availabilityKind: 'proxy-required',
      manualSwitch: {
        mode: 'blocked',
        reason: '当前播放路径未启用代理播放',
      },
      autoRecovery: {
        eligible: false,
        reason: '当前播放路径未启用代理播放',
      },
    });
  });

  it('rescues an unavailable source when backend metrics show it is playable', () => {
    const statuses = new Map<string, SourceStatus>([
      [
        'rescued-1',
        {
          kind: 'unavailable',
          reason: '该源近期在本机不可用',
          fromMemory: true,
        },
      ],
    ]);
    const measured = new Map<string, SourceVideoInfo>([
      [
        'rescued-1',
        {
          quality: '1080p',
          loadSpeed: '后端 2.4 MB/s · 280ms',
          pingTime: 280,
          speedSource: 'backend',
          speedPending: false,
        },
      ],
    ]);

    const list = buildSourceAvailabilityList({
      sources: [createSource('rescued', '1')],
      currentEpisodeIndex: 0,
      statuses,
      measured,
    });

    expect(list[0]).toMatchObject({
      availabilityKind: 'playable',
      evidenceKind: 'backend-playable',
      manualSwitch: {
        mode: 'switch-now',
        reason: '后端测速可用，可尝试播放',
      },
      autoRecovery: {
        eligible: true,
        reason: '后端测速可用，可尝试播放',
      },
    });
  });

  it('rescues an unavailable source when browser metrics show it is playable', () => {
    const statuses = new Map<string, SourceStatus>([
      [
        'browser-1',
        {
          kind: 'unavailable',
          reason: '该源近期在本机不可用',
          fromMemory: true,
        },
      ],
    ]);
    const measured = new Map<string, SourceVideoInfo>([
      [
        'browser-1',
        {
          quality: '1080p',
          loadSpeed: '2.1 MB/s',
          pingTime: 180,
          speedSource: 'browser',
          speedPending: false,
          hasError: false,
        },
      ],
    ]);

    const list = buildSourceAvailabilityList({
      sources: [createSource('browser', '1')],
      currentEpisodeIndex: 0,
      statuses,
      measured,
    });

    // Symptom lock: cards can show speed yet still render 不可用 when only
    // browser metrics exist. Browser playable evidence must rescue too.
    expect(list[0]?.availabilityKind).toBe('playable');
    expect(list[0]?.manualSwitch.mode).toBe('switch-now');
    expect(list[0]?.effectiveStatus?.kind).not.toBe('unavailable');
  });
});

describe('selectRecoveryCandidate', () => {
  it('selects the first automatic recovery eligible source', () => {
    const [current, unknown, direct] = [
      createSource('current', '1'),
      createSource('unknown', '2'),
      createSource('direct', '3'),
    ];
    const statuses = new Map<string, SourceStatus>([
      ['unknown-2', { kind: 'idle' }],
      ['direct-3', { kind: 'direct', reason: '浏览器可直接播放' }],
    ]);

    const candidate = selectRecoveryCandidate({
      sources: [current, unknown, direct],
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
      statuses,
    });

    expect(candidate?.sourceKey).toBe('direct-3');
    expect(candidate?.source).toBe(direct);
  });

  it('never selects unknown sources for automatic recovery by default', () => {
    const statuses = new Map<string, SourceStatus>([
      ['unknown-2', { kind: 'idle' }],
      ['probing-3', { kind: 'probing', reason: '检测中' }],
    ]);

    const candidate = selectRecoveryCandidate({
      sources: [
        createSource('current', '1'),
        createSource('unknown', '2'),
        createSource('probing', '3'),
      ],
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
      statuses,
    });

    expect(candidate).toBeNull();
  });

  it('startup fallback may select an idle source when no verified alt exists', () => {
    const statuses = new Map<string, SourceStatus>([
      ['unknown-2', { kind: 'idle' }],
      ['probing-3', { kind: 'probing', reason: '检测中' }],
    ]);

    const candidate = selectRecoveryCandidate({
      sources: [
        createSource('current', '1'),
        createSource('unknown', '2'),
        createSource('probing', '3'),
      ],
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
      statuses,
      allowUnverifiedFallback: true,
    });

    expect(candidate?.sourceKey).toBe('unknown-2');
  });

  it('startup fallback still prefers a verified direct source over idle', () => {
    const statuses = new Map<string, SourceStatus>([
      ['unknown-2', { kind: 'idle' }],
      ['direct-3', { kind: 'direct', reason: '浏览器可直接播放' }],
    ]);

    const candidate = selectRecoveryCandidate({
      sources: [
        createSource('current', '1'),
        createSource('unknown', '2'),
        createSource('direct', '3'),
      ],
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
      statuses,
      allowUnverifiedFallback: true,
    });

    expect(candidate?.sourceKey).toBe('direct-3');
  });

  it('skips current and already-attempted auto-recovery sources', () => {
    const statuses = new Map<string, SourceStatus>([
      ['direct-2', { kind: 'direct', reason: '浏览器可直接播放' }],
      ['direct-3', { kind: 'direct', reason: '浏览器可直接播放' }],
    ]);

    const candidate = selectRecoveryCandidate({
      sources: [
        createSource('current', '1'),
        createSource('direct', '2'),
        createSource('direct', '3'),
      ],
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
      statuses,
      attemptedSourceKeys: new Set(['direct-2']),
    });

    expect(candidate?.sourceKey).toBe('direct-3');
  });

  it('prefers the higher selection score among auto-eligible sources', () => {
    const statuses = new Map<string, SourceStatus>([
      ['slow-2', { kind: 'direct', reason: '慢' }],
      ['fast-3', { kind: 'direct', reason: '快' }],
    ]);
    const sourceSelectionScores = new Map([
      [
        'slow-2',
        {
          sourceKey: 'slow-2',
          score: 10,
          reason: '慢',
          source: createSource('slow', '2'),
          originalIndex: 1,
        },
      ],
      [
        'fast-3',
        {
          sourceKey: 'fast-3',
          score: 90,
          reason: '快',
          source: createSource('fast', '3'),
          originalIndex: 2,
        },
      ],
    ]);

    const candidate = selectRecoveryCandidate({
      sources: [
        createSource('current', '1'),
        createSource('slow', '2'),
        createSource('fast', '3'),
      ],
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
      statuses,
      sourceSelectionScores,
    });

    expect(candidate?.sourceKey).toBe('fast-3');
  });
});

describe('shared eligibility model for manual vs auto', () => {
  it('keeps unknown tryable manually while excluding it from auto recovery', () => {
    const list = buildSourceAvailabilityList({
      sources: [createSource('unknown', '1')],
      currentEpisodeIndex: 0,
      statuses: new Map([['unknown-1', { kind: 'idle' }]]),
    });

    expect(list[0]).toMatchObject({
      availabilityKind: 'unknown',
      manualSwitch: { mode: 'probe-first' },
      autoRecovery: { eligible: false },
    });
  });

  it('keeps probing switch-now for manual while excluding it from auto recovery', () => {
    const list = buildSourceAvailabilityList({
      sources: [createSource('probing', '1')],
      currentEpisodeIndex: 0,
      statuses: new Map([
        ['probing-1', { kind: 'probing', reason: '检测中，可尝试播放' }],
      ]),
    });

    expect(list[0]).toMatchObject({
      availabilityKind: 'probing',
      manualSwitch: { mode: 'switch-now' },
      autoRecovery: { eligible: false },
    });
  });

  it('makes every auto-eligible source manually switch-now', () => {
    const statuses = new Map<string, SourceStatus>([
      ['direct-1', { kind: 'direct', reason: '浏览器可直接播放' }],
      ['playable-2', { kind: 'playable', reason: '可尝试播放' }],
    ]);

    const list = buildSourceAvailabilityList({
      sources: [createSource('direct', '1'), createSource('playable', '2')],
      currentEpisodeIndex: 0,
      statuses,
    });

    for (const item of list) {
      if (item.autoRecovery.eligible) {
        expect(item.manualSwitch.mode).toBe('switch-now');
      }
    }
  });
});

describe('initial source selection', () => {
  it('skips a higher-scored proxy-only source for a direct source', () => {
    const proxy = createSource('proxy', '1');
    const direct = createSource('direct', '2');
    const candidate = selectInitialSourceCandidate({
      sources: [proxy, direct],
      currentEpisodeIndex: 0,
      statuses: new Map<string, SourceStatus>([
        ['proxy-1', { kind: 'proxy', playbackMode: 'proxy' }],
        ['direct-2', { kind: 'direct', playbackMode: 'direct' }],
      ]),
      sourceSelectionScores: new Map([
        ['proxy-1', createSelectionScore(proxy, 100, 0)],
        ['direct-2', createSelectionScore(direct, 50, 1)],
      ]),
    });

    expect(candidate?.sourceKey).toBe('direct-2');
  });

  it('preserves score order among direct and playable sources', () => {
    const direct = createSource('direct', '1');
    const playable = createSource('playable', '2');
    const candidate = selectInitialSourceCandidate({
      sources: [direct, playable],
      currentEpisodeIndex: 0,
      statuses: new Map<string, SourceStatus>([
        ['direct-1', { kind: 'direct' }],
        ['playable-2', { kind: 'playable' }],
      ]),
      sourceSelectionScores: new Map([
        ['direct-1', createSelectionScore(direct, 50, 0)],
        ['playable-2', createSelectionScore(playable, 80, 1)],
      ]),
    });

    expect(candidate?.sourceKey).toBe('playable-2');
  });

  it('returns no automatic candidate when every source requires proxy', () => {
    expect(
      selectInitialSourceCandidate({
        sources: [createSource('proxy', '1')],
        currentEpisodeIndex: 0,
        statuses: new Map<string, SourceStatus>([
          ['proxy-1', { kind: 'proxy', playbackMode: 'proxy' }],
        ]),
      })
    ).toBeNull();
  });
});

describe('failed background probes', () => {
  const probeFailed: SourceStatus = {
    kind: 'unavailable',
    reason: '后台测速未通过（CORS），可手动尝试',
    fromMemory: true,
    localConfidence: 'low',
  };
  const sources = [
    createSource('current', '1'),
    createSource('failed', '2'),
    createSource('untested', '3'),
  ];

  it('are not verified recovery candidates', () => {
    expect(
      selectRecoveryCandidate({
        sources,
        currentSourceKey: 'current-1',
        currentEpisodeIndex: 0,
        statuses: new Map([['failed-2', probeFailed]]),
      })
    ).toBeNull();
  });

  it('rank behind untested lines in blind fallback', () => {
    const statuses = new Map([['failed-2', probeFailed]]);
    const first = selectRecoveryCandidate({
      sources,
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
      statuses,
      allowUnverifiedFallback: true,
    });
    expect(first?.sourceKey).toBe('untested-3');

    const second = selectRecoveryCandidate({
      sources,
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
      statuses,
      attemptedSourceKeys: new Set(['untested-3']),
      allowUnverifiedFallback: true,
    });
    expect(second?.sourceKey).toBe('failed-2');
  });

  it('can still be tried manually after a probe', () => {
    const item = buildSourceAvailabilityList({
      sources,
      currentSourceKey: 'current-1',
      currentEpisodeIndex: 0,
      statuses: new Map([['failed-2', probeFailed]]),
    }).find((entry) => entry.sourceKey === 'failed-2');
    expect(item?.manualSwitch.mode).toBe('probe-first');
  });

  it('keeps a confident unavailable record out of blind fallback', () => {
    expect(
      selectRecoveryCandidate({
        sources: sources.slice(0, 2),
        currentSourceKey: 'current-1',
        currentEpisodeIndex: 0,
        statuses: new Map<string, SourceStatus>([
          ['failed-2', { kind: 'unavailable', fromMemory: true }],
        ]),
        allowUnverifiedFallback: true,
      })
    ).toBeNull();
  });
});

describe('source status evidence freshness', () => {
  const rememberedUnavailable: SourceStatus = {
    kind: 'unavailable',
    reason: '旧记忆不可用',
    fromMemory: true,
  };
  const rememberedDirect: SourceStatus = {
    kind: 'direct',
    reason: '旧记忆可用',
    fromMemory: true,
  };

  it('keeps current playable evidence over remembered unavailable', () => {
    const current: SourceStatus = { kind: 'direct', reason: '本次探测可用' };

    expect(resolveSourceStatusEvidence(current, rememberedUnavailable)).toBe(
      current
    );
  });

  it('keeps current unavailable evidence over remembered playable', () => {
    const current: SourceStatus = {
      kind: 'unavailable',
      reason: '本次探测失败',
    };

    expect(resolveSourceStatusEvidence(current, rememberedDirect)).toBe(
      current
    );
  });

  it('uses remembered unavailable when current evidence is absent', () => {
    expect(resolveSourceStatusEvidence(undefined, rememberedUnavailable)).toBe(
      rememberedUnavailable
    );
  });
});

describe('auto-recovery vs probe-scheduling attempted ledgers', () => {
  it('clears only auto-recovery attempted when the episode changes', () => {
    const next = clearAttemptedLedgersOnEpisodeChange({
      autoRecoveryAttempted: new Set(['a-1', 'b-2']),
      probeSchedulingAttempted: new Set(['probe-3', 'probe-4']),
    });

    expect(Array.from(next.autoRecoveryAttempted)).toEqual([]);
    expect(Array.from(next.probeSchedulingAttempted)).toEqual([
      'probe-3',
      'probe-4',
    ]);
  });

  it('clears both ledgers when the title changes', () => {
    const next = clearAttemptedLedgersOnTitleChange();

    expect(Array.from(next.autoRecoveryAttempted)).toEqual([]);
    expect(Array.from(next.probeSchedulingAttempted)).toEqual([]);
  });
});
