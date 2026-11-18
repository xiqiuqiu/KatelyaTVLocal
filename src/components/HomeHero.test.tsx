import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

const recommendation = {
  type: 'movie' as const,
  reason: '本周口碑高分',
  score: 9.4,
  item: {
    id: 'hero-1',
    title: '庆余年',
    poster: 'https://img.example/hero.jpg',
    rate: '9.4',
    year: '2024',
  },
};

function mockTmdbResponse(payload: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('HomeHero TMDB layout', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('uses the wide backdrop when TMDB returns one', async () => {
    mockTmdbResponse({
      enabled: true,
      items: [
        {
          title: '庆余年',
          matched: true,
          backdropPath: '/backdrop.jpg',
          genres: ['剧情'],
          runtime: 120,
        },
      ],
    });

    const { container } = render(
      <HomeHero recommendations={[recommendation]} />
    );

    await waitFor(() =>
      expect(container.querySelector('.ui-home-feature')).toHaveAttribute(
        'data-layout',
        'backdrop'
      )
    );
    // next/image 在测试里被 mock 成裸 img，class 会丢，这里按 src 判断
    expect(
      container.querySelector('img[src*="image.tmdb.org"]')
    ).not.toBeNull();
    expect(screen.getByText('剧情')).toBeInTheDocument();
    expect(screen.getByText('120 分钟')).toBeInTheDocument();
  });

  it('falls back to the portrait layout when TMDB cannot match', async () => {
    mockTmdbResponse({
      enabled: true,
      items: [{ title: '庆余年', matched: false }],
    });

    const { container } = render(
      <HomeHero recommendations={[recommendation]} />
    );

    await waitFor(() =>
      expect(container.querySelector('.ui-home-feature')).toHaveAttribute(
        'data-layout',
        'split'
      )
    );
    expect(container.querySelector('img[src*="image.tmdb.org"]')).toBeNull();
    expect(container.querySelector('.ui-home-feature-poster')).not.toBeNull();
  });

  it('keeps the portrait layout when TMDB is not configured', async () => {
    mockTmdbResponse({ enabled: false, items: [] });

    const { container } = render(
      <HomeHero recommendations={[recommendation]} />
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.querySelector('.ui-home-feature')).toHaveAttribute(
      'data-layout',
      'split'
    );
  });
});

describe('HomeHero playback preparation', () => {
  beforeEach(() => {
    mockStartPlaybackPreparation.mockReset();
  });

  it('keeps a real play link while starting the shared transition', () => {
    render(<HomeHero recommendations={[recommendation]} />);

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
