import { act, fireEvent, render, screen } from '@testing-library/react';

import { getSearchHistory, subscribeToDataUpdates } from '@/lib/db.client';

import SearchPage from '@/app/search/page';

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

jest.mock('@/lib/db.client', () => ({
  addSearchHistory: jest.fn(),
  clearSearchHistory: jest.fn(),
  deleteSearchHistory: jest.fn(),
  getSearchHistory: jest.fn(),
  subscribeToDataUpdates: jest.fn(),
}));

jest.mock('@/components/AiFindPanel', () => {
  return function MockAiFindPanel(props: { initialQuery?: string }) {
    return (
      <div data-testid='ai-find-panel'>
        AI Find Panel {props.initialQuery || ''}
      </div>
    );
  };
});

jest.mock(
  '@/components/PageLayout',
  () =>
    ({ children }: { children: React.ReactNode }) =>
      <div data-testid='page-layout'>{children}</div>
);

jest.mock(
  '@/components/ui/PageHeader',
  () =>
    (props: { title: string; subtitle?: string; action?: React.ReactNode }) =>
      (
        <div>
          <div>{props.title}</div>
          <div>{props.subtitle}</div>
          {props.action}
        </div>
      )
);

jest.mock(
  '@/components/ui/SectionHeader',
  () =>
    (props: { title: string; subtitle?: string; action?: React.ReactNode }) =>
      (
        <div>
          <div>{props.title}</div>
          <div>{props.subtitle}</div>
          {props.action}
        </div>
      )
);

jest.mock(
  '@/components/ui/Surface',
  () =>
    ({ children }: { children: React.ReactNode }) =>
      <div>{children}</div>
);

jest.mock(
  '@/components/ui/PosterGrid',
  () =>
    ({ children }: { children: React.ReactNode }) =>
      <div>{children}</div>
);

jest.mock(
  '@/components/ui/ActionLink',
  () =>
    ({
      children,
      onClick,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
    }) =>
      (
        <button onClick={onClick} type='button'>
          {children}
        </button>
      )
);

jest.mock('@/components/ui/LoadingPrimitives', () => ({
  SkeletonPosterCard: () => <div>loading</div>,
}));

jest.mock('@/components/VideoCard', () => {
  return function MockVideoCard(props: {
    title?: string;
    items?: Array<{ title: string }>;
    typeName?: string;
    year?: string;
    statusText?: string;
  }) {
    const title = props.title || props.items?.[0]?.title || 'Video Card';
    return (
      <div data-testid='video-card'>
        <span>{title}</span>
        {props.typeName ? <span>{props.typeName}</span> : null}
        {props.year ? <span>{props.year}</span> : null}
        {props.statusText ? <span>{props.statusText}</span> : null}
      </div>
    );
  };
});

jest.mock('@/components/CapsuleSwitch', () => {
  return function MockCapsuleSwitch(props: {
    options: Array<{ label: string; value: string }>;
    active: string;
    onChange: (value: string) => void;
  }) {
    return (
      <div role='tablist' aria-label='结果分类'>
        {props.options.map((option) => (
          <button
            key={option.value}
            aria-pressed={props.active === option.value}
            onClick={() => props.onChange(option.value)}
            type='button'
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  };
});

const sampleResults = [
  {
    id: '1',
    title: '电影甲',
    poster: 'https://img.example/a.jpg',
    episodes: ['1'],
    source: 's1',
    source_name: '源1',
    year: '2024',
    type_name: '电影',
  },
  {
    id: '2',
    title: '剧集乙',
    poster: 'https://img.example/b.jpg',
    episodes: ['1', '2', '3'],
    source: 's2',
    source_name: '源2',
    year: '2023',
    type_name: '电视剧',
  },
  {
    id: '3',
    title: '综艺丙',
    poster: 'https://img.example/c.jpg',
    episodes: ['1', '2'],
    source: 's3',
    source_name: '源3',
    year: '2022',
    class: '真人秀',
  },
];

describe('SearchPage', () => {
  const mockedGetSearchHistory = getSearchHistory as jest.MockedFunction<
    typeof getSearchHistory
  >;
  const mockedSubscribeToDataUpdates =
    subscribeToDataUpdates as jest.MockedFunction<
      typeof subscribeToDataUpdates
    >;

  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockedGetSearchHistory.mockResolvedValue([]);
    mockedSubscribeToDataUpdates.mockReturnValue(() => undefined);
    window.localStorage.clear();
    (
      global as typeof globalThis & {
        requestAnimationFrame?: (callback: FrameRequestCallback) => number;
      }
    ).requestAnimationFrame = jest.fn(() => 0);
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({
        json: async () => ({ results: [] }),
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('keeps normal search as default and only renders AI panel after switching modes', async () => {
    await act(async () => {
      render(<SearchPage />);
    });

    expect(screen.queryByTestId('ai-find-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '普通搜索' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 找片' }));

    expect(screen.getByTestId('ai-find-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 找片' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('opens AI mode from URL params and passes the search query into the panel', async () => {
    mockSearchParams = new URLSearchParams('mode=ai&q=鬼灭之刃');

    await act(async () => {
      render(<SearchPage />);
    });

    expect(screen.getByTestId('ai-find-panel')).toHaveTextContent(
      'AI Find Panel 鬼灭之刃'
    );
    expect(screen.getByRole('button', { name: 'AI 找片' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('shows category tabs with honest counts from the loaded result set', async () => {
    mockSearchParams = new URLSearchParams('q=庆余年');
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({
        json: async () => ({ results: sampleResults }),
      });

    await act(async () => {
      render(<SearchPage />);
    });

    expect(await screen.findByRole('tablist', { name: '结果分类' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '电影 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '剧集 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '综艺 1' })).toBeInTheDocument();
  });

  it('switches tabs by filtering already-fetched results without a new search request', async () => {
    mockSearchParams = new URLSearchParams('q=庆余年');
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({ results: sampleResults }),
    });
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;

    await act(async () => {
      render(<SearchPage />);
    });

    expect(await screen.findByText('电影甲')).toBeInTheDocument();
    expect(screen.getByText('剧集乙')).toBeInTheDocument();
    expect(screen.getByText('综艺丙')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '电影 1' }));

    expect(screen.getByText('电影甲')).toBeInTheDocument();
    expect(screen.queryByText('剧集乙')).not.toBeInTheDocument();
    expect(screen.queryByText('综艺丙')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps aggregate toggle meaning and shows an empty state for empty tabs', async () => {
    mockSearchParams = new URLSearchParams('q=庆余年');
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({
        json: async () => ({
          results: [
            {
              id: 'only-movie',
              title: '只有电影',
              poster: 'https://img.example/m.jpg',
              episodes: ['1'],
              source: 's1',
              source_name: '源1',
              year: '2024',
              type_name: '电影',
            },
          ],
        }),
      });

    await act(async () => {
      render(<SearchPage />);
    });

    expect(await screen.findByText('只有电影')).toBeInTheDocument();
    expect(screen.getByLabelText('聚合')).toBeInTheDocument();

    const aggregateToggle = screen.getByRole('checkbox');
    expect(aggregateToggle).toBeChecked();

    fireEvent.click(aggregateToggle);
    expect(aggregateToggle).not.toBeChecked();
    expect(screen.getByText('只有电影')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '剧集 0' }));
    expect(screen.getByText('该分类下暂无结果')).toBeInTheDocument();
    expect(screen.queryByText('只有电影')).not.toBeInTheDocument();
  });
});
