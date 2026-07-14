import {
  buildSourceAvailabilityList,
  selectRecoveryCandidate,
} from './index';
import {
  clearAttemptedLedgersOnEpisodeChange,
  clearAttemptedLedgersOnTitleChange,
} from './attempted-ledgers';
import type { SearchResult, SourceStatus, SourceVideoInfo } from '@/lib/types';

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

  it('never selects unknown sources for automatic recovery', () => {
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
