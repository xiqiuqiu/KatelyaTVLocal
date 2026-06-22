import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import { fetchSourcePreferencesInBatches } from '@/lib/source-preference-client';
import type { SearchResult, SourceStatus } from '@/lib/types';
import {
  createSourceStatus,
  getVideoResolutionFromM3u8,
  probeSourcePlayback,
} from '@/lib/utils';

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
  const mockedGetVideoResolutionFromM3u8 =
    getVideoResolutionFromM3u8 as jest.MockedFunction<
      typeof getVideoResolutionFromM3u8
    >;

  beforeEach(() => {
    mockedProbeSourcePlayback.mockReset();
    mockedProbeSourcePlayback.mockResolvedValue({
      kind: 'unavailable',
      reason: '测试中不探测真实播放源',
      domain: null,
    });
    mockedGetVideoResolutionFromM3u8.mockReset();
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

    expect(mockedFetchSourcePreferencesInBatches.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: 'source-44-id-44',
          episodeUrl: 'https://example.com/44.m3u8',
          sourceName: 'S44',
        }),
      ])
    );
    expect(mockedFetchSourcePreferencesInBatches.mock.calls[0][1]).toEqual({
      allowLiveProbeFallback: true,
    });
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
      expect(screen.getByText('后端 2.4 MB/s · 280ms')).toBeInTheDocument();
    });
  });

  it('unlocks an unavailable source when backend preference reports playable metrics', async () => {
    mockedFetchSourcePreferencesInBatches.mockResolvedValueOnce({
      orderedSourceKeys: ['source-b-b'],
      results: [
        {
          sourceKey: 'source-b-b',
          kind: 'direct',
          reason: '后端首段探测通过',
          rankingSource: 'd1',
          qualityLabel: '1080p',
          speedKbps: 2450,
          latencyMs: 280,
        },
      ],
      generatedAt: 1710000000000,
      rankingSource: 'd1',
      confidence: 'medium',
    });
    const handleSourceChange = jest.fn();
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
        title: 'backend rescued source',
        year: '2026',
        poster: '',
        episodes: ['https://example.com/b.m3u8'],
        source_name: '后端救援源',
      },
    ];
    const sourceStatuses = new Map<string, SourceStatus>([
      [
        'source-b-b',
        createSourceStatus('unavailable', {
          reason: '该源近期在本机不可用',
          fromMemory: true,
        }),
      ],
    ]);

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

    const rescuedButton = await screen.findByRole('button', {
      name: '切换线路 后端救援源',
    });

    await waitFor(() => {
      expect(rescuedButton).not.toBeDisabled();
    });
    expect(within(rescuedButton).getByText('1080p')).toBeInTheDocument();
    expect(within(rescuedButton).getByText('可切换')).toBeInTheDocument();

    fireEvent.click(rescuedButton);

    expect(handleSourceChange).toHaveBeenCalledWith(
      'source-b',
      'b',
      'backend rescued source'
    );
  });

  it('keeps an unavailable source disabled when backend confirms it is unavailable', async () => {
    mockedFetchSourcePreferencesInBatches.mockResolvedValueOnce({
      orderedSourceKeys: ['source-b-b'],
      results: [
        {
          sourceKey: 'source-b-b',
          kind: 'unavailable',
          reason: '上游响应失败: 403',
          rankingSource: 'd1',
        },
      ],
      generatedAt: 1710000000000,
      rankingSource: 'd1',
      confidence: 'medium',
    });
    const handleSourceChange = jest.fn();
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
        title: 'backend unavailable source',
        year: '2026',
        poster: '',
        episodes: ['https://example.com/b.m3u8'],
        source_name: '后端不可用源',
      },
    ];
    const sourceStatuses = new Map<string, SourceStatus>([
      [
        'source-b-b',
        createSourceStatus('unavailable', {
          reason: '该源近期在本机不可用',
          fromMemory: true,
        }),
      ],
    ]);

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

    const unavailableButton = await screen.findByRole('button', {
      name: '切换线路 后端不可用源',
    });

    await waitFor(() => {
      expect(unavailableButton).toBeDisabled();
    });

    fireEvent.click(unavailableButton);

    expect(handleSourceChange).not.toHaveBeenCalled();
  });

  it('keeps a source without an episode URL disabled even when memory says it was playable', async () => {
    const handleSourceChange = jest.fn();
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
        title: 'missing episode source',
        year: '2026',
        poster: '',
        episodes: [],
        source_name: '空剧集源',
      },
    ];
    const sourceStatuses = new Map<string, SourceStatus>([
      [
        'source-b-b',
        createSourceStatus('direct', {
          reason: '本机近期播放流畅',
          playbackMode: 'direct',
          fromMemory: true,
        }),
      ],
    ]);

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

    const missingEpisodeButton = await screen.findByRole('button', {
      name: '切换线路 空剧集源',
    });

    await waitFor(() => {
      expect(missingEpisodeButton).toBeDisabled();
    });

    fireEvent.click(missingEpisodeButton);

    expect(handleSourceChange).not.toHaveBeenCalled();
  });

  it('requests a second visible-first backend metric refresh without blocking clicks', async () => {
    mockedFetchSourcePreferencesInBatches
      .mockResolvedValueOnce({
        orderedSourceKeys: ['source-b-b'],
        results: [
          {
            sourceKey: 'source-b-b',
            kind: 'direct',
            reason: '后端可播放',
            rankingSource: 'd1',
            speedKbps: null,
            speedLabel: null,
            probeTimeMs: 420,
          },
        ],
        generatedAt: 1710000000000,
        rankingSource: 'd1',
        confidence: 'medium',
      })
      .mockResolvedValueOnce({
        orderedSourceKeys: ['source-b-b'],
        results: [
          {
            sourceKey: 'source-b-b',
            kind: 'direct',
            reason: '首片测速完成',
            rankingSource: 'd1',
            speedKbps: 3072,
            speedLabel: '3.0 MB/s',
            speedSource: 'backend',
            latencyMs: 180,
            pingTimeMs: 180,
          },
        ],
        generatedAt: 1710000001000,
        rankingSource: 'd1',
        confidence: 'medium',
      });
    const handleSourceChange = jest.fn();
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
        title: 'visible source',
        year: '2026',
        poster: '',
        episodes: ['https://example.com/b.m3u8'],
        source_name: '可见源',
      },
    ];

    render(
      <EpisodeSelector
        totalEpisodes={1}
        value={1}
        currentSource='source-a'
        currentId='a'
        availableSources={availableSources}
        onSourceChange={handleSourceChange}
      />
    );

    await waitFor(() => {
      expect(
        mockedFetchSourcePreferencesInBatches.mock.calls.length
      ).toBeGreaterThanOrEqual(2);
    });

    expect(mockedFetchSourcePreferencesInBatches.mock.calls[1][0]).toEqual(
      expect.arrayContaining([
        {
          sourceKey: 'source-a-a',
          episodeUrl: 'https://example.com/a.m3u8',
          sourceName: '当前源',
          titleSample: 'current source',
        },
        {
          sourceKey: 'source-b-b',
          episodeUrl: 'https://example.com/b.m3u8',
          sourceName: '可见源',
          titleSample: 'visible source',
        },
      ])
    );
    expect(mockedFetchSourcePreferencesInBatches.mock.calls[1][0]).toHaveLength(
      2
    );
    expect(mockedFetchSourcePreferencesInBatches.mock.calls[1][1]).toEqual({
      allowLiveProbeFallback: false,
      includeFreshProbeMetrics: true,
    });
    expect(screen.getByText('后端 3.0 MB/s · 180ms')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '切换线路 可见源' }));

    expect(handleSourceChange).toHaveBeenCalledWith(
      'source-b',
      'b',
      'visible source'
    );
  });

  it('restores source status when a fresh backend metric refresh omits a visible source', async () => {
    mockedFetchSourcePreferencesInBatches
      .mockResolvedValueOnce({
        orderedSourceKeys: ['source-a-a', 'source-b-b'],
        results: [
          {
            sourceKey: 'source-a-a',
            kind: 'direct',
            reason: '首轮可播放',
            rankingSource: 'd1',
            speedKbps: null,
            speedLabel: null,
            speedSource: 'none',
          },
          {
            sourceKey: 'source-b-b',
            kind: 'direct',
            reason: '首轮可播放',
            rankingSource: 'd1',
            speedKbps: null,
            speedLabel: null,
            speedSource: 'none',
          },
        ],
        generatedAt: 1710000000000,
        rankingSource: 'd1',
        confidence: 'medium',
      })
      .mockResolvedValueOnce({
        orderedSourceKeys: ['source-a-a'],
        results: [
          {
            sourceKey: 'source-a-a',
            kind: 'direct',
            reason: '当前源测速完成',
            rankingSource: 'd1',
            speedKbps: 2048,
            speedLabel: '2.0 MB/s',
            speedSource: 'backend',
            latencyMs: 120,
            pingTimeMs: 120,
          },
        ],
        generatedAt: 1710000001000,
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
        title: 'visible source',
        year: '2026',
        poster: '',
        episodes: ['https://example.com/b.m3u8'],
        source_name: '缺失测速源',
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
      expect(
        mockedFetchSourcePreferencesInBatches.mock.calls.length
      ).toBeGreaterThanOrEqual(2);
    });

    const missingSourceButton = screen.getByRole('button', {
      name: '切换线路 缺失测速源',
    });

    await waitFor(() => {
      expect(missingSourceButton).not.toHaveAttribute(
        'title',
        expect.stringContaining('后端测速中')
      );
    });
    expect(
      within(missingSourceButton).queryByText('检测中')
    ).not.toBeInTheDocument();
  });

  it('allows the same fresh backend metric request to retry after a partial response', async () => {
    mockedFetchSourcePreferencesInBatches
      .mockResolvedValueOnce({
        orderedSourceKeys: ['source-a-a', 'source-b-b'],
        results: [
          {
            sourceKey: 'source-a-a',
            kind: 'direct',
            reason: '首轮可播放',
            rankingSource: 'd1',
            speedKbps: null,
            speedLabel: null,
            speedSource: 'none',
          },
          {
            sourceKey: 'source-b-b',
            kind: 'direct',
            reason: '首轮可播放',
            rankingSource: 'd1',
            speedKbps: null,
            speedLabel: null,
            speedSource: 'none',
          },
        ],
        generatedAt: 1710000000000,
        rankingSource: 'd1',
        confidence: 'medium',
      })
      .mockResolvedValueOnce({
        orderedSourceKeys: ['source-a-a'],
        results: [
          {
            sourceKey: 'source-a-a',
            kind: 'direct',
            reason: '当前源测速完成',
            rankingSource: 'd1',
            speedKbps: 2048,
            speedLabel: '2.0 MB/s',
            speedSource: 'backend',
            latencyMs: 120,
            pingTimeMs: 120,
          },
        ],
        generatedAt: 1710000001000,
        rankingSource: 'd1',
        confidence: 'medium',
      })
      .mockResolvedValueOnce({
        orderedSourceKeys: ['source-b-b'],
        results: [
          {
            sourceKey: 'source-b-b',
            kind: 'direct',
            reason: '缺失源重试完成',
            rankingSource: 'd1',
            speedKbps: 1024,
            speedLabel: '1.0 MB/s',
            speedSource: 'backend',
            latencyMs: 260,
            pingTimeMs: 260,
          },
        ],
        generatedAt: 1710000002000,
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
        title: 'visible source',
        year: '2026',
        poster: '',
        episodes: ['https://example.com/b.m3u8'],
        source_name: '重试测速源',
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
      expect(mockedFetchSourcePreferencesInBatches).toHaveBeenCalledTimes(3);
    });
    expect(mockedFetchSourcePreferencesInBatches.mock.calls[2][0]).toEqual([
      {
        sourceKey: 'source-b-b',
        episodeUrl: 'https://example.com/b.m3u8',
        sourceName: '重试测速源',
        titleSample: 'visible source',
      },
    ]);
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
    expect(within(probingButton).getByText('检测中')).toBeInTheDocument();
    expect(within(probingButton).getByText('可切换')).toBeInTheDocument();

    fireEvent.click(probingButton);

    expect(handleSourceChange).toHaveBeenCalledWith(
      'source-b',
      'b',
      'probing source'
    );
  });

  it('lets unknown source rows run manual browser probing before switching', async () => {
    mockedProbeSourcePlayback.mockImplementation(async (url) => {
      if (url === 'https://manual-probe.test.invalid/b.m3u8') {
        return {
          kind: 'direct',
          reason: '服务端检测通过',
          domain: 'manual-probe.test.invalid',
        };
      }

      return {
        kind: 'unavailable',
        reason: '测试中不探测真实播放源',
        domain: null,
      };
    });
    mockedGetVideoResolutionFromM3u8.mockResolvedValueOnce({
      quality: '1080p',
      loadSpeed: '2.0 MB/s',
      pingTime: 120,
    });
    const availableSources: SearchResult[] = [
      {
        id: 'current-a',
        source: 'manual-current',
        title: 'current source',
        year: '2026',
        poster: '',
        episodes: ['https://manual-current.test.invalid/a.m3u8'],
        source_name: '当前源',
      },
      {
        id: 'probe-b',
        source: 'manual-probe',
        title: 'unknown source',
        year: '2026',
        poster: '',
        episodes: ['https://manual-probe.test.invalid/b.m3u8'],
        source_name: '待检测源',
      },
    ];
    const handleSourceChange = jest.fn();

    render(
      <EpisodeSelector
        totalEpisodes={2}
        value={1}
        currentSource='manual-current'
        currentId='current-a'
        availableSources={availableSources}
        onSourceChange={handleSourceChange}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '线路' }));
    const unknownButton = screen.getByRole('button', {
      name: '切换线路 待检测源',
    });

    expect(unknownButton).not.toBeDisabled();
    expect(within(unknownButton).getByText('待检测')).toBeInTheDocument();

    mockedProbeSourcePlayback.mockClear();
    mockedGetVideoResolutionFromM3u8.mockClear();
    fireEvent.click(unknownButton);

    await waitFor(() => {
      expect(mockedProbeSourcePlayback).toHaveBeenCalledWith(
        'https://manual-probe.test.invalid/b.m3u8'
      );
      expect(mockedGetVideoResolutionFromM3u8).toHaveBeenCalledWith(
        'https://manual-probe.test.invalid/b.m3u8'
      );
    });
    expect(handleSourceChange).toHaveBeenCalledWith(
      'manual-probe',
      'probe-b',
      'unknown source'
    );
  });
});
