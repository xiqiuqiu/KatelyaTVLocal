import { fireEvent, render, screen } from '@testing-library/react';

import HomeHero from './HomeHero';

const mockStartPlaybackPreparation = jest.fn();

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}));

jest.mock(
  '@/components/playback-preparation/PlaybackPreparationProvider',
  () => ({
    usePlaybackPreparation: () => ({
      active: true,
      start: mockStartPlaybackPreparation,
      markFrameReady: jest.fn(),
      markTerminalFailure: jest.fn(),
      cancel: jest.fn(),
    }),
  })
);

describe('HomeHero playback preparation', () => {
  beforeEach(() => {
    mockStartPlaybackPreparation.mockReset();
  });

  it('keeps a real play link while starting the shared transition', () => {
    render(
      <HomeHero
        candidate={{
          type: 'movie',
          item: {
            id: 'hero-1',
            title: '庆余年',
            poster: 'https://img.example/hero.jpg',
            rate: '9.4',
            year: '2024',
          },
        }}
      />
    );

    const link = screen.getByRole('link', { name: /立即播放/i });
    expect(link).toHaveAttribute(
      'href',
      '/play?title=%E5%BA%86%E4%BD%99%E5%B9%B4&year=2024&stype=movie'
    );

    fireEvent.click(link);

    expect(mockStartPlaybackPreparation).toHaveBeenCalledWith(
      expect.objectContaining({
        href: '/play?title=%E5%BA%86%E4%BD%99%E5%B9%B4&year=2024&stype=movie',
        title: '庆余年',
        poster: 'https://img.example/hero.jpg',
      })
    );
  });
});
