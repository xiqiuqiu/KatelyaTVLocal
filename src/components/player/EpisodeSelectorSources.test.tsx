import { fireEvent, render, screen } from '@testing-library/react';

import { buildSourceAvailabilityList } from '@/lib/source-availability';
import type { SearchResult } from '@/lib/types';

import EpisodeSelectorSources from './EpisodeSelectorSources';

const sources: SearchResult[] = ['backup', 'current'].map((source) => ({
  source,
  id: '1',
  source_name: source === 'current' ? '当前源' : '备用源',
  title: '测试影片',
  year: '2026',
  poster: '',
  episodes: [`https://example.com/${source}.m3u8`],
}));

const sourceAvailabilityList = buildSourceAvailabilityList({
  sources,
  currentSourceKey: 'current-1',
  currentEpisodeIndex: 0,
  statuses: new Map(
    sources.map((source) => [`${source.source}-1`, { kind: 'direct' }])
  ),
});

describe('EpisodeSelectorSources progressive discovery', () => {
  it.each([
    { loading: true, error: null, message: '正在获取更多线路...' },
    {
      loading: false,
      error: '搜索失败',
      message: '更多线路获取失败，仍可使用已有线路。',
    },
  ])(
    'keeps known sources usable while discovery is $message',
    ({ loading, error, message }) => {
      const onSourceClick = jest.fn();
      render(
        <EpisodeSelectorSources
          sourceSearchLoading={loading}
          sourceSearchError={error}
          availableSourcesCount={sources.length}
          sourceAvailabilityList={sourceAvailabilityList}
          videoTitle='测试影片'
          onSourceClick={onSourceClick}
          onSearchMismatchClick={jest.fn()}
        />
      );

      expect(screen.getByRole('status')).toHaveTextContent(message);
      const current = screen.getByRole('button', { name: '当前线路 当前源' });
      const backup = screen.getByRole('button', { name: '切换线路 备用源' });
      expect(current).toHaveAttribute('aria-current', 'true');
      expect(screen.getAllByRole('button').slice(0, 2)).toEqual([
        current,
        backup,
      ]);
      expect(backup).toBeEnabled();
      fireEvent.click(backup);
      expect(onSourceClick).toHaveBeenCalledWith(sources[0]);
      expect(screen.queryByText('暂无可用的换源')).not.toBeInTheDocument();
      expect(screen.queryByText('搜索中...')).not.toBeInTheDocument();
    }
  );

  it.each([
    { loading: true, error: null, message: '搜索中...' },
    { loading: false, error: '搜索失败', message: '搜索失败' },
    { loading: false, error: null, message: '暂无可用的换源' },
  ])(
    'retains the original empty-list state: $message',
    ({ loading, error, message }) => {
      render(
        <EpisodeSelectorSources
          sourceSearchLoading={loading}
          sourceSearchError={error}
          availableSourcesCount={0}
          sourceAvailabilityList={[]}
          onSourceClick={jest.fn()}
          onSearchMismatchClick={jest.fn()}
        />
      );

      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText('正在获取更多线路...')).not.toBeInTheDocument();
      expect(
        screen.queryByText('更多线路获取失败，仍可使用已有线路。')
      ).not.toBeInTheDocument();
    }
  );
});
