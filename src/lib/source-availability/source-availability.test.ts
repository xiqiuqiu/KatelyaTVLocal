import { buildSourceAvailabilityList, selectRecoveryCandidate } from './index';
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
});
