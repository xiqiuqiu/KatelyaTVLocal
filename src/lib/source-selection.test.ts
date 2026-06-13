import {
  buildSourceSelectionScores,
  calculateMeasuredSourceScore,
  sortSourcesBySelectionScore,
} from '@/lib/source-selection';
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

describe('calculateMeasuredSourceScore', () => {
  it('keeps the existing quality, speed, and ping weighting', () => {
    expect(
      calculateMeasuredSourceScore(
        {
          quality: '1080p',
          loadSpeed: '2.0 MB/s',
          pingTime: 80,
        },
        2048,
        80,
        480
      )
    ).toBe(90);
  });
});

describe('buildSourceSelectionScores', () => {
  it('combines D1 rank status and measured quality for first-play selection', () => {
    const sources = [createSource('slow', '1'), createSource('fast', '2')];
    const statuses = new Map<string, SourceStatus>([
      [
        'slow-1',
        {
          kind: 'direct',
          reason: 'ranked but slow',
          rankScore: 95,
        },
      ],
      [
        'fast-2',
        {
          kind: 'direct',
          reason: 'ranked and measured',
          rankScore: 70,
        },
      ],
    ]);
    const measured = new Map([
      [
        'fast-2',
        {
          quality: '4K',
          loadSpeed: '4.0 MB/s',
          pingTime: 40,
        },
      ],
    ]);

    const scores = buildSourceSelectionScores({
      sources,
      statuses,
      measured,
      currentEpisodeIndex: 0,
    });

    expect(scores.get('fast-2')?.score).toBeGreaterThan(
      scores.get('slow-1')?.score || 0
    );
    expect(sortSourcesBySelectionScore(sources, scores)[0]).toBe(sources[1]);
  });

  it('prioritizes local successful playback memory over global D1 rank for first-play selection', () => {
    const sources = [createSource('global', '1'), createSource('local', '2')];
    const statuses = new Map<string, SourceStatus>([
      [
        'global-1',
        {
          kind: 'direct',
          reason: 'global rank only',
          rankScore: 95,
        },
      ],
      [
        'local-2',
        {
          kind: 'direct',
          reason: 'local success',
          fromMemory: true,
        },
      ],
    ]);

    const scores = buildSourceSelectionScores({
      sources,
      statuses,
      currentEpisodeIndex: 0,
    });

    expect(scores.get('local-2')?.score).toBeGreaterThan(
      scores.get('global-1')?.score || 0
    );
    expect(sortSourcesBySelectionScore(sources, scores)[0]).toBe(sources[1]);
  });

  it('keeps missing-score sources in original order after scored sources', () => {
    const sources = [
      createSource('a', '1'),
      createSource('b', '2'),
      createSource('c', '3'),
    ];
    const scores = buildSourceSelectionScores({
      sources: [sources[1]],
      currentEpisodeIndex: 0,
    });

    expect(sortSourcesBySelectionScore(sources, scores)).toEqual([
      sources[1],
      sources[0],
      sources[2],
    ]);
  });

  it('pins the current source before higher-scored sources when requested', () => {
    const sources = [
      createSource('current', '1'),
      createSource('fast', '2'),
      createSource('steady', '3'),
    ];
    const scores = buildSourceSelectionScores({
      sources,
      statuses: new Map<string, SourceStatus>([
        ['current-1', { kind: 'playable', reason: 'current but lower score' }],
        ['fast-2', { kind: 'direct', reason: 'fast source', rankScore: 90 }],
        [
          'steady-3',
          { kind: 'direct', reason: 'steady source', rankScore: 50 },
        ],
      ]),
      currentEpisodeIndex: 0,
    });

    const sorted = sortSourcesBySelectionScore(
      sources,
      scores,
      undefined,
      'current-1'
    );

    expect(sorted).toEqual([sources[0], sources[1], sources[2]]);
  });

  it('keeps scored ordering for non-current sources after pinning current source', () => {
    const sources = [
      createSource('current', '1'),
      createSource('middle', '2'),
      createSource('best', '3'),
    ];
    const scores = buildSourceSelectionScores({
      sources,
      statuses: new Map<string, SourceStatus>([
        ['current-1', { kind: 'playable', reason: 'current' }],
        ['middle-2', { kind: 'direct', reason: 'middle', rankScore: 30 }],
        ['best-3', { kind: 'direct', reason: 'best', rankScore: 80 }],
      ]),
      currentEpisodeIndex: 0,
    });

    const sorted = sortSourcesBySelectionScore(
      sources,
      scores,
      undefined,
      'current-1'
    );

    expect(sorted).toEqual([sources[0], sources[2], sources[1]]);
  });

  it('falls back to normal scored ordering when the current source key is missing', () => {
    const sources = [
      createSource('current', '1'),
      createSource('fast', '2'),
      createSource('steady', '3'),
    ];
    const scores = buildSourceSelectionScores({
      sources,
      statuses: new Map<string, SourceStatus>([
        ['current-1', { kind: 'playable', reason: 'current but lower score' }],
        ['fast-2', { kind: 'direct', reason: 'fast source', rankScore: 90 }],
        [
          'steady-3',
          { kind: 'direct', reason: 'steady source', rankScore: 50 },
        ],
      ]),
      currentEpisodeIndex: 0,
    });

    expect(
      sortSourcesBySelectionScore(sources, scores, undefined, 'missing-9')
    ).toEqual([sources[1], sources[2], sources[0]]);
  });

  it('penalizes sources that do not contain the current episode', () => {
    const [short, complete] = [
      createSource('short', '1', ['a']),
      createSource('complete', '2', ['a', 'b', 'c']),
    ];

    const scores = buildSourceSelectionScores({
      sources: [short, complete],
      currentEpisodeIndex: 2,
    });

    expect(scores.get('complete-2')?.score).toBeGreaterThan(
      scores.get('short-1')?.score || 0
    );
  });
});
