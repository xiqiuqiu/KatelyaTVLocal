import { render, screen, within } from '@testing-library/react';

import HomePage from '@/app/page';

const push = jest.fn();
let mockSearchParams = new URLSearchParams();
const mockSearchParamsAdapter = {
  get: (key: string) => mockSearchParams.get(key),
};

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
  }),
  useSearchParams: () => mockSearchParamsAdapter,
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={props.alt} src={props.src} />
  ),
}));

jest.mock('@/lib/db.client', () => ({
  clearAllFavorites: jest.fn(),
  deletePlayRecordByKey: jest.fn(),
  getAllFavorites: jest.fn().mockResolvedValue({}),
  getAllPlayRecords: jest.fn().mockResolvedValue({}),
  getRecentPlayRecords: jest.fn().mockResolvedValue({
    'source-a+1': {
      title: '续看示例',
      source_name: '测试源',
      year: '2026',
      cover: 'https://img.example/continue.jpg',
      index: 1,
      total_episodes: 12,
      play_time: 60,
      total_time: 1800,
      save_time: 1,
      search_title: '续看示例',
    },
  }),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));

jest.mock('@/lib/douban.client', () => ({
  getDoubanCategories: jest.fn(async ({ kind }: { kind: string }) => {
    if (kind === 'movie') {
      return {
        code: 200,
        message: 'ok',
        list: [
          {
            id: 'hero-1',
            title: '庆余年',
            poster: 'https://img.example/hero.jpg',
            rate: '9.4',
            year: '2024',
          },
        ],
      };
    }
    return { code: 200, message: 'ok', list: [] };
  }),
}));

jest.mock('@/components/SiteProvider', () => ({
  useSite: () => ({ siteName: 'ReelFind' }),
}));

jest.mock(
  '@/components/PageLayout',
  () =>
    ({ children }: { children: React.ReactNode }) =>
      <div data-testid='page-layout'>{children}</div>
);

jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

describe('Home page composition', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    push.mockReset();
  });

  it('puts Design Direction Hero before Continue Watching and demotes the large home PageHeader', async () => {
    const { container } = render(<HomePage />);

    const heroTitle = await screen.findByRole('heading', { name: '庆余年' });
    const hero = heroTitle.closest('section');
    expect(hero).not.toBeNull();
    expect(within(hero as HTMLElement).getByText('9.4')).toBeTruthy();
    expect(
      within(hero as HTMLElement).getByRole('link', { name: /立即播放/i })
    ).toHaveAttribute(
      'href',
      '/play?title=%E5%BA%86%E4%BD%99%E5%B9%B4&year=2024&stype=movie'
    );

    const continueHeading = await screen.findByRole('heading', {
      name: '继续观看',
    });
    const continueSection = continueHeading.closest('section');
    expect(continueSection).not.toBeNull();
    expect(
      within(continueSection as HTMLElement).getByRole('link', { name: /更多/i })
    ).toHaveAttribute('href', '/history');

    const heroIndex = container.textContent?.indexOf('庆余年') ?? -1;
    const continueIndex = container.textContent?.indexOf('继续观看') ?? -1;
    expect(heroIndex).toBeGreaterThanOrEqual(0);
    expect(continueIndex).toBeGreaterThan(heroIndex);

    expect(screen.queryByRole('heading', { name: '首页' })).toBeNull();
  });
});
