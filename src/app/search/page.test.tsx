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

jest.mock('@/components/VideoCard', () => () => <div>Video Card</div>);

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
});
