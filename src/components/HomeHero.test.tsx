import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import HomeHero from './HomeHero';

const mockStartPlaybackPreparation = jest.fn();

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    alt,
    src,
    onError,
  }: {
    alt: string;
    src: string;
    onError?: () => void;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} onError={onError} src={src} />
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

  it('automatically rotates through poster fallback without changing layout', async () => {
    jest.useFakeTimers();
    try {
      const show = {
        ...recommendation,
        type: 'show' as const,
        item: {
          ...recommendation.item,
          id: 'hero-2',
          title: '克拉克森的农场 第五季',
          poster: 'https://img.example/farm.jpg',
        },
      };
      const last = {
        ...recommendation,
        item: { ...recommendation.item, id: 'hero-3', title: '幻视任务' },
      };
      const fetchMock = mockTmdbResponse({
        enabled: true,
        items: [
          {
            title: recommendation.item.title,
            matched: true,
            backdropPath: '/first.jpg',
          },
          { title: show.item.title, matched: false },
          { title: last.item.title, matched: true, backdropPath: '/last.jpg' },
        ],
      });
      const { container } = render(
        <HomeHero recommendations={[recommendation, show, last]} />
      );
      await screen.findByRole('heading', { name: recommendation.item.title });

      const banner = screen.getByRole('region', { name: '为你推荐' });
      const layout = banner.getAttribute('data-layout');
      const play = screen.getByRole('link', { name: '立即播放' });
      const activeImage = () =>
        container.querySelector(
          '.ui-home-feature-art [data-active="true"] img'
        );
      expect(activeImage()).toHaveAttribute(
        'src',
        expect.stringContaining('/first.jpg')
      );

      act(() => jest.advanceTimersByTime(9000));
      expect(banner.getAttribute('data-layout')).toBe(layout);
      expect(
        screen.queryByRole('complementary', { name: '更多推荐' })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: show.item.title })
      ).toBeInTheDocument();
      expect(activeImage()).toHaveAttribute('src', show.item.poster);
      expect(screen.getByRole('link', { name: '立即播放' })).toBe(play);
      expect(play).toHaveAttribute(
        'href',
        expect.stringContaining('stype=show')
      );

      act(() => jest.advanceTimersByTime(9000));
      expect(banner.getAttribute('data-layout')).toBe(layout);
      expect(
        screen.getByRole('heading', { name: last.item.title })
      ).toBeInTheDocument();
      expect(activeImage()).toHaveAttribute(
        'src',
        expect.stringContaining('/last.jpg')
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
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

    // 等待期间先渲染骨架，数据到达后才换成 backdrop 图
    // next/image 在测试里被 mock 成裸 img，class 会丢，这里按 src 判断
    await waitFor(() =>
      expect(
        container.querySelector('img[src*="image.tmdb.org"]')
      ).not.toBeNull()
    );
    expect(container.querySelector('.ui-home-feature-poster')).toBeNull();
    expect(screen.getByText('剧情')).toBeInTheDocument();
    expect(screen.getByText('120 分钟')).toBeInTheDocument();
  });

  it('shows the poster inside the banner when TMDB is not configured', async () => {
    mockTmdbResponse({ enabled: false, items: [] });

    const { container } = render(
      <HomeHero recommendations={[recommendation]} />
    );

    await screen.findByRole('heading', { name: recommendation.item.title });
    expect(container.querySelector('.ui-home-feature-art img')).toHaveAttribute(
      'src',
      recommendation.item.poster
    );
    expect(
      container.querySelector('.ui-home-feature-poster img')
    ).toHaveAttribute('src', recommendation.item.poster);
  });

  it('keeps the title and play link when both images fail', async () => {
    mockTmdbResponse({
      enabled: true,
      items: [
        {
          title: recommendation.item.title,
          matched: true,
          backdropPath: '/bad.jpg',
        },
      ],
    });
    const { container } = render(
      <HomeHero recommendations={[recommendation]} />
    );
    await screen.findByRole('heading', { name: recommendation.item.title });

    const selector = '.ui-home-feature-art img';
    const background = () => {
      const image = container.querySelector(selector);
      if (!image) throw new Error('Missing banner background image');
      return image;
    };
    expect(background()).toHaveAttribute(
      'src',
      expect.stringContaining('/bad.jpg')
    );
    fireEvent.error(background());
    expect(background()).toHaveAttribute('src', recommendation.item.poster);
    fireEvent.error(background());

    expect(container.querySelector(selector)).toBeNull();
    expect(container.querySelector('.ui-home-feature-poster')).toBeNull();
    expect(
      screen.getByRole('heading', { name: recommendation.item.title })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '立即播放' })).toBeInTheDocument();
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
