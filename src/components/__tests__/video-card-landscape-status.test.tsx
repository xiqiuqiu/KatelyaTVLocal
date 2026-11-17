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

describe('VideoCard landscape status', () => {
  it('shows the total episode count together with the progress percent', () => {
    render(
      <VideoCard
        layout='landscape'
        from='playrecord'
        id='1'
        source='test'
        source_name='如意资源'
        title='庆余年'
        poster='https://example.com/p.jpg'
        episodes={12}
        currentEpisode={3}
        progress={25}
      />
    );

    expect(
      screen.getByText('第 3 集 / 共 12 集 · 已看 25% · 如意资源')
    ).toBeInTheDocument();
  });

  it('omits the total when the source does not report episodes', () => {
    render(
      <VideoCard
        layout='landscape'
        from='playrecord'
        id='2'
        source='test'
        title='未知集数'
        poster='https://example.com/p.jpg'
        currentEpisode={4}
        progress={50}
      />
    );

    expect(screen.getByText('第 4 集 · 已看 50%')).toBeInTheDocument();
  });
});
