import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { fetchSourcePreferencesInBatches } from '@/lib/source-preference-client';
import type { SearchResult, SourceStatus } from '@/lib/types';
import { createSourceStatus } from '@/lib/utils';

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
          reason: '测试中不探测真实播放源',
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
      ])
    );
    expect(mockedFetchSourcePreferencesInBatches.mock.calls[0][0]).toHaveLength(
      45
    );
  });
});
