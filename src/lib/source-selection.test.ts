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
