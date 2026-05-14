import { fireEvent, render, screen } from '@testing-library/react';

import type { SearchResult, SourceStatus } from '@/lib/types';
import { createSourceStatus } from '@/lib/utils';

import EpisodeSelector from '@/components/EpisodeSelector';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
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
  it('shows stable tabs and keeps episode buttons findable by accessible name', () => {
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

    expect(screen.getByText('A源')).toBeInTheDocument();
    const unavailableSourceButton = screen.getByRole('button', {
      name: '切换线路 A源',
    });
    expect(unavailableSourceButton).toBeDisabled();

    fireEvent.click(unavailableSourceButton);

    expect(handleSourceChange).not.toHaveBeenCalled();
  });
});
