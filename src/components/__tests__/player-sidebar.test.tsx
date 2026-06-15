import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { fetchSourcePreferencesInBatches } from '@/lib/source-preference-client';
import type { SearchResult, SourceStatus } from '@/lib/types';
import { createSourceStatus, probeSourcePlayback } from '@/lib/utils';

import EpisodeSelector from '@/components/EpisodeSelector';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/lib/source-preference-client', () => ({
  fetchSourcePreferencesInBatches: jest.fn(),
}));

jest.mock('@/lib/utils', () => {
  const actual = jest.requireActual('@/lib/utils');

  return {
    ...actual,
    getVideoResolutionFromM3u8: jest.fn(),
    probeSourcePlayback: jest.fn().mockResolvedValue({
      kind: 'unavailable',
      reason: '测试中不探测真实播放源',
      domain: null,
    }),
  };
});

describe('EpisodeSelector playback sidebar controls', () => {
  const mockedFetchSourcePreferencesInBatches =
    fetchSourcePreferencesInBatches as jest.MockedFunction<
      typeof fetchSourcePreferencesInBatches
    >;
  const mockedProbeSourcePlayback = probeSourcePlayback as jest.MockedFunction<
    typeof probeSourcePlayback
  >;

  beforeEach(() => {
    mockedFetchSourcePreferencesInBatches.mockResolvedValue({
      orderedSourceKeys: [],
      results: [],
      generatedAt: 1710000000000,
      rankingSource: 'live',
      confidence: 'low',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows stable tabs and keeps episode buttons findable by accessible name', async () => {
    const sourceStatuses = new Map<string, SourceStatus>([
      [
        'source-a-a',
        createSourceStatus('unavailable', {
          reason: '服务端探测失败: 403',
        }),
      ],
    ]);

    const availableSources: SearchResult[] = [
      {
        id: 'a',
        source: 'source-a',
        title: '示例剧集',
        year: '2026',
        poster: '',
        episodes: ['1.m3u8', '2.m3u8', '3.m3u8'],
        source_name: 'A源',
      },
    ];
    const handleSourceChange = jest.fn();

    render(
      <EpisodeSelector
        totalEpisodes={24}
        value={3}
        availableSources={availableSources}
        precomputedSourceStatuses={sourceStatuses}
        onSourceChange={handleSourceChange}
      />
    );

    expect(screen.getByRole('tab', { name: '选集' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '线路' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第3集' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '线路' }));

    await waitFor(() => {
      expect(mockedFetchSourcePreferencesInBatches).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText('A源')).toBeInTheDocument();
    expect(screen.getByText('该线路当前不可用')).toBeInTheDocument();
    expect(screen.queryByText('服务端探测失败: 403')).not.toBeInTheDocument();
    const unavailableSourceButton = screen.getByRole('button', {
      name: '切换线路 A源',
    });
    expect(unavailableSourceButton).toBeDisabled();

    fireEvent.click(unavailableSourceButton);

    expect(handleSourceChange).not.toHaveBeenCalled();
  });

  it('server-probes all source rows when the source tab is opened', async () => {
    const availableSources: SearchResult[] = Array.from(
      { length: 45 },
      (_, index) => ({
        id: `id-${index}`,
        source: `source-${index}`,
        title: `绀轰緥 ${index}`,
        year: '2026',
        poster: '',
        episodes: [`https://example.com/${index}.m3u8`],
        source_name: `S${index}`,
      })
    );

    render(
      <EpisodeSelector
        totalEpisodes={1}
        value={1}
        currentSource='source-0'
        currentId='id-0'
        availableSources={availableSources}
      />
    );

    await waitFor(() => {
      expect(mockedFetchSourcePreferencesInBatches).toHaveBeenCalledTimes(1);
    });

    expect(mockedFetchSourcePreferencesInBatches).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          sourceKey: 'source-44-id-44',
          episodeUrl: 'https://example.com/44.m3u8',
        },
      ]),
      { allowLiveProbeFallback: true }
    );
    expect(mockedFetchSourcePreferencesInBatches.mock.calls[0][0]).toHaveLength(
      45
    );
  });

  it('falls back to per-source probing when batch probing fails', async () => {
    mockedFetchSourcePreferencesInBatches.mockRejectedValueOnce(
      new Error('unauthorized')
    );
    mockedProbeSourcePlayback.mockResolvedValue({
      kind: 'proxy',
      reason: 'fallback probe',
      domain: 'example.com',
    });
    const availableSources: SearchResult[] = Array.from(
      { length: 5 },
      (_, index) => ({
        id: `id-${index}`,
        source: `source-${index}`,
        title: `缁€杞扮伀 ${index}`,
        year: '2026',
        poster: '',
        episodes: [`https://example.com/${index}.m3u8`],
        source_name: `S${index}`,
      })
    );

    render(
      <EpisodeSelector
        totalEpisodes={1}
        value={1}
        currentSource='source-0'
        currentId='id-0'
        availableSources={availableSources}
      />
    );

    await waitFor(() => {
      expect(mockedProbeSourcePlayback).toHaveBeenCalledWith(
        'https://example.com/4.m3u8'
      );
    });
    expect(mockedProbeSourcePlayback.mock.calls.length).toBeGreaterThanOrEqual(
      5
    );
  });

  it('does not fallback-probe sources that already have a final status', async () => {
    mockedFetchSourcePreferencesInBatches.mockRejectedValueOnce(
      new Error('unauthorized')
    );
    mockedProbeSourcePlayback.mockResolvedValue({
      kind: 'proxy',
      reason: 'fallback probe',
      domain: 'example.com',
    });
    const sourceStatuses = new Map<string, SourceStatus>([
      [
        'source-0-id-0',
        createSourceStatus('direct', {
          reason: 'already checked',
          playbackMode: 'direct',
        }),
      ],
    ]);
    const availableSources: SearchResult[] = Array.from(
      { length: 2 },
      (_, index) => ({
        id: `id-${index}`,
        source: `source-${index}`,
        title: `fallback ${index}`,
        year: '2026',
        poster: '',
        episodes: [`https://example.com/${index}.m3u8`],
        source_name: `S${index}`,
      })
    );

    render(
      <EpisodeSelector
        totalEpisodes={1}
        value={1}
        currentSource='source-0'
        currentId='id-0'
        availableSources={availableSources}
        precomputedSourceStatuses={sourceStatuses}
      />
    );

    await waitFor(() => {
      expect(mockedProbeSourcePlayback).toHaveBeenCalledWith(
        'https://example.com/1.m3u8'
      );
    });

    expect(mockedProbeSourcePlayback).not.toHaveBeenCalledWith(
      'https://example.com/0.m3u8'
    );
  });

  it('fallback-probes source rows missing from a partial batch response', async () => {
    mockedFetchSourcePreferencesInBatches.mockResolvedValueOnce({
      orderedSourceKeys: ['source-0-id-0'],
      results: [
        {
          sourceKey: 'source-0-id-0',
          kind: 'direct',
          reason: 'ranked',
          rankingSource: 'd1',
        },
      ],
      generatedAt: 1710000000000,
      rankingSource: 'd1',
      confidence: 'medium',
    });
    mockedProbeSourcePlayback.mockResolvedValue({
      kind: 'proxy',
      reason: 'fallback probe',
      domain: 'example.com',
    });
    const availableSources: SearchResult[] = Array.from(
      { length: 2 },
      (_, index) => ({
        id: `id-${index}`,
        source: `source-${index}`,
        title: `partial ${index}`,
        year: '2026',
        poster: '',
        episodes: [`https://example.com/${index}.m3u8`],
        source_name: `S${index}`,
      })
    );

    render(
      <EpisodeSelector
        totalEpisodes={1}
        value={1}
        currentSource='source-0'
        currentId='id-0'
        availableSources={availableSources}
      />
    );

    await waitFor(() => {
      expect(mockedProbeSourcePlayback).toHaveBeenCalledWith(
        'https://example.com/1.m3u8'
      );
    });
  });

  it('keeps the current source first while preserving ranked alternatives', async () => {
    const availableSources: SearchResult[] = [
      {
        id: 'current',
        source: 'source-a',
        title: 'current source',
        year: '2026',
        poster: '',
        episodes: ['https://example.com/a.m3u8'],
        source_name: '当前源',
      },
      {
        id: 'better',
        source: 'source-b',
        title: 'better source',
        year: '2026',
        poster: '',
        episodes: ['https://example.com/b.m3u8'],
        source_name: '推荐源',
      },
    ];
    const scores = new Map([
      [
        'source-a-current',
        {
          sourceKey: 'source-a-current',
          score: 60,
          reason: 'current',
          source: availableSources[0],
          originalIndex: 0,
        },
      ],
      [
        'source-b-better',
        {
          sourceKey: 'source-b-better',
          score: 95,
          reason: 'better',
          source: availableSources[1],
          originalIndex: 1,
        },
      ],
    ]);

    render(
      <EpisodeSelector
        totalEpisodes={1}
        value={1}
        currentSource='source-a'
        currentId='current'
        availableSources={availableSources}
        sourceSelectionScores={scores}
      />
    );

    const buttons = await screen.findAllByRole('button', {
      name: /线路/,
    });
    expect(buttons[0]).toHaveAccessibleName('当前线路 当前源');
    expect(buttons[1]).toHaveAccessibleName('切换线路 推荐源');
  });

  it('shows backend probe speed from source preference results', async () => {
    mockedFetchSourcePreferencesInBatches.mockResolvedValueOnce({
      orderedSourceKeys: ['source-b-b'],
      results: [
        {
          sourceKey: 'source-b-b',
          kind: 'direct',
          reason: '后端首段探测通过',
          rankingSource: 'd1',
          qualityLabel: null,
          speedLabel: null,
          pingTimeMs: null,
          latencyMs: 280,
          speedKbps: 2450,
        },
      ],
      generatedAt: 1710000000000,
      rankingSource: 'd1',
      confidence: 'medium',
    });
    const availableSources: SearchResult[] = [
      {
        id: 'a',
        source: 'source-a',
        title: 'current source',
        year: '2026',
        poster: '',
        episodes: ['https://example.com/a.m3u8'],
        source_name: '当前源',
      },
      {
        id: 'b',
        source: 'source-b',
        title: 'backend ranked source',
        year: '2026',
        poster: '',
        episodes: ['https://example.com/b.m3u8'],
        source_name: '后端测速源',
      },
    ];

    render(
      <EpisodeSelector
        totalEpisodes={1}
        value={1}
        currentSource='source-a'
        currentId='a'
        availableSources={availableSources}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('2.4 MB/s · 280ms')).toBeInTheDocument();
    });
  });

  it('allows probing source rows to be clicked for manual rescue switching', async () => {
    const availableSources: SearchResult[] = [
      {
        id: 'a',
        source: 'source-a',
        title: 'current source',
        year: '2026',
        poster: '',
        episodes: ['https://example.com/a.m3u8'],
        source_name: '当前源',
      },
      {
        id: 'b',
        source: 'source-b',
        title: 'probing source',
        year: '2026',
        poster: '',
        episodes: ['https://example.com/b.m3u8'],
        source_name: '检测中源',
      },
    ];
    const sourceStatuses = new Map<string, SourceStatus>([
      [
        'source-b-b',
        createSourceStatus('probing', {
          reason: '后台测速中',
        }),
      ],
    ]);
    const handleSourceChange = jest.fn();

    render(
      <EpisodeSelector
        totalEpisodes={1}
        value={1}
        currentSource='source-a'
        currentId='a'
        availableSources={availableSources}
        precomputedSourceStatuses={sourceStatuses}
        onSourceChange={handleSourceChange}
      />
    );

    const probingButton = await screen.findByRole('button', {
      name: '切换线路 检测中源',
    });

    expect(probingButton).not.toBeDisabled();
    expect(screen.getByText('检测中')).toBeInTheDocument();
    expect(screen.getByText('可切换')).toBeInTheDocument();

    fireEvent.click(probingButton);

    expect(handleSourceChange).toHaveBeenCalledWith(
      'source-b',
      'b',
      'probing source'
    );
  });
});
