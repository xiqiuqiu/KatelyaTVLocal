/* eslint-disable @next/next/no-img-element */
import { render, screen } from '@testing-library/react';

import VideoCard from '@/components/VideoCard';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt, src }: { alt: string; src: string }) => (
    <img alt={alt} src={src} />
  ),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock(
  '@/components/playback-preparation/PlaybackPreparationProvider',
  () => ({
    usePlaybackPreparation: () => ({
      active: true,
      start: jest.fn(),
      markFrameReady: jest.fn(),
      markTerminalFailure: jest.fn(),
      cancel: jest.fn(),
    }),
  })
);

jest.mock('@/components/ui/CardActions', () => ({
  __esModule: true,
  default: () => null,
}));

describe('VideoCard douban score', () => {
  it('shows the score on the right of a search result title', () => {
    render(
      <VideoCard
        layout='result'
        from='search'
        id='1'
        source='test'
        source_name='测试源'
        title='庆余年'
        poster='https://example.com/p.jpg'
        year='2019'
        episodes={46}
        typeName='国产剧'
        statusText='共46集'
        rate='7.9'
      />
    );

    expect(screen.getByText('豆瓣 7.9')).toBeInTheDocument();
    expect(screen.getByText('国产剧')).toBeInTheDocument();
  });

  it('shows the score in the poster footer without duplicating a poster badge', () => {
    render(
      <VideoCard
        from='douban'
        title='繁花'
        poster='https://example.com/p.jpg'
        year='2023'
        rate='8.6'
      />
    );

    const scores = screen.getAllByText('8.6');
    expect(scores).toHaveLength(1);
    expect(scores[0]).toHaveClass('ui-video-score');
  });
});
