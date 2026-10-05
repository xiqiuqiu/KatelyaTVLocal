import { act, fireEvent, render, screen } from '@testing-library/react';

import { getSearchHistory, subscribeToDataUpdates } from '@/lib/db.client';

import SearchPage from '@/app/search/page';

const push = jest.fn();
let mockSearchParams = new URLSearchParams();
const mockSearchParamsAdapter = {
  get: (key: string) => mockSearchParams.get(key),
  toString: () => mockSearchParams.toString(),
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
  return function MockAiFindPanel(props: {
    initialQuery?: string;
    tvMode?: boolean;
  }) {
    return (
      <div data-testid='ai-find-panel' data-tv-mode={props.tvMode}>
        AI Find Panel {props.initialQuery || ''}
      </div>
    );
  };
});

jest.mock(
  '@/components/PageLayout',
  () =>
    ({
      children,
      tvMode,
      modeHref,
    }: {
      children: React.ReactNode;
      tvMode?: boolean;
      modeHref?: string;
    }) =>
      (
        <div
          data-testid='page-layout'
          data-tv-mode={tvMode}
          data-mode-href={modeHref}
        >
          {children}
        </div>
      )
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
      href,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      href?: string;
    }) =>
      href ? (
        <a href={href}>{children}</a>
      ) : (
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
    tvMode?: boolean;
  }) {
    const title = props.title || props.items?.[0]?.title || 'Video Card';
    return (
      <div data-testid='video-card' data-tv-mode={props.tvMode}>
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
        ok: true,
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
        ok: true,
        json: async () => ({ results: sampleResults }),
      });

    await act(async () => {
      render(<SearchPage />);
    });

    expect(
      await screen.findByRole('tablist', { name: '结果分类' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '电影 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '剧集 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '综艺 1' })).toBeInTheDocument();
  });

  it('switches tabs by filtering already-fetched results without a new search request', async () => {
    mockSearchParams = new URLSearchParams('q=庆余年');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
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

  it('passes AbortSignal to search fetch', async () => {
    mockSearchParams = new URLSearchParams('q=test');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;

    await act(async () => {
      render(<SearchPage />);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/search?q=test'),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('clears results when search API returns a non-OK response', async () => {
    mockSearchParams = new URLSearchParams('q=fail');
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          results: [
            { id: '1', title: '不应展示', episodes: ['1'], source: 's1' },
          ],
        }),
      });

    await act(async () => {
      render(<SearchPage />);
    });

    expect(screen.queryByText('不应展示')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tablist', { name: '结果分类' })
    ).not.toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('aborts in-flight search fetch on unmount', async () => {
    mockSearchParams = new URLSearchParams('q=test');
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }
    );
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;

    const { unmount } = render(<SearchPage />);
    await act(async () => undefined);

    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('keeps aggregate toggle meaning and shows an empty state for empty tabs', async () => {
    mockSearchParams = new URLSearchParams('q=庆余年');
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
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

  it('submits trimmed TV queries and keeps history in TV mode', async () => {
    mockSearchParams = new URLSearchParams('tv=1');
    mockedGetSearchHistory.mockResolvedValue(['庆余年']);
    await act(async () => {
      render(<SearchPage />);
    });
    expect(screen.getByTestId('page-layout')).toHaveAttribute(
      'data-tv-mode',
      'true'
    );
    expect(screen.queryByTestId('ai-find-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '庆余年' }));
    expect(push).toHaveBeenLastCalledWith(
      '/search?q=%E5%BA%86%E4%BD%99%E5%B9%B4&tv=1'
    );
    const input = screen.getByRole('searchbox');
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: '  庆余年 & 第二季  ' } });
    fireEvent.submit(screen.getByRole('search', { name: '电视搜索' }));
    expect(push).toHaveBeenLastCalledWith(
      '/search?q=%E5%BA%86%E4%BD%99%E5%B9%B4+%26+%E7%AC%AC%E4%BA%8C%E5%AD%A3&tv=1'
    );
    expect(input).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'AI 找片' }));
    expect(screen.getByTestId('ai-find-panel')).toHaveAttribute(
      'data-tv-mode',
      'true'
    );
    expect(push).toHaveBeenLastCalledWith('/search?tv=1&mode=ai');
  });

  it('opens TV AI directly without searching the description through normal search and retains mode on switching', async () => {
    mockSearchParams = new URLSearchParams('tv=1&mode=ai&q=港片');
    await act(async () => {
      render(<SearchPage />);
    });
    expect(screen.getByTestId('ai-find-panel')).toHaveTextContent('港片');
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '普通搜索' }));
    await act(async () => undefined);
    expect(screen.getByRole('searchbox')).toHaveValue('港片');
    expect(push).toHaveBeenLastCalledWith('/search?tv=1&q=%E6%B8%AF%E7%89%87');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps TV results navigable through aggregation and category changes without refetching', async () => {
    mockSearchParams = new URLSearchParams('tv=1&q=庆余年');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: sampleResults }),
    });
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;
    await act(async () => {
      render(<SearchPage />);
    });
    expect(screen.getAllByTestId('video-card')).toHaveLength(3);
    for (const card of screen.getAllByTestId('video-card'))
      expect(card).toHaveAttribute('data-tv-mode', 'true');
    fireEvent.click(screen.getByRole('button', { name: '聚合：开' }));
    expect(screen.getByRole('button', { name: '聚合：关' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    fireEvent.click(screen.getByRole('button', { name: '电影 1' }));
    expect(screen.getAllByTestId('video-card')).toHaveLength(1);
    expect(screen.getByTestId('video-card')).toHaveAttribute(
      'data-tv-mode',
      'true'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('page-layout')).toHaveAttribute(
      'data-mode-href',
      `/search?${mockSearchParams.toString()}`
    );
  });

  it('retries a failed TV search through the existing request and cancellation path', async () => {
    mockSearchParams = new URLSearchParams('tv=1&q=test');
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ results: sampleResults }),
      });
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;
    await act(async () => {
      render(<SearchPage />);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('搜索失败，请重试。');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重试搜索' }));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
