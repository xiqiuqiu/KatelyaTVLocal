import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { createAiFindRequestId } from '@/lib/ai-find/debug';
import {
  deleteAiFindSavedRecord,
  getAiFindSavedRecord,
  listAiFindSavedRecords,
} from '@/lib/ai-find/history-client';
import type { AiFindResponse } from '@/lib/ai-find/types';

import AiFindPanel from './AiFindPanel';

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: () => null,
  }),
}));

jest.mock('@/lib/ai-find/debug', () => ({
  AI_FIND_DEBUG_HEADER: 'x-ai-find-debug',
  AI_FIND_DEBUG_RESPONSE_HEADER: 'x-ai-find-debug-enabled',
  AI_FIND_REQUEST_ID_HEADER: 'x-ai-find-request-id',
  createAiFindRequestId: jest.fn(() => 'req_test'),
  sanitizeAiFindDebugText: (value: string | null) => value || '',
}));

jest.mock('@/lib/ai-find/history-client', () => ({
  createAiFindSavedRecordId: () => 'saved_test',
  deleteAiFindSavedRecord: jest.fn(),
  getAiFindSavedRecord: jest.fn(),
  listAiFindSavedRecords: jest.fn(),
  saveAiFindSavedRecordSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock(
  '@/components/ui/Surface',
  () =>
    ({ children }: { children: React.ReactNode }) =>
      <div>{children}</div>
);

jest.mock(
  '@/components/ui/SectionHeader',
  () => (props: { title: string; subtitle?: string }) =>
    (
      <div>
        <h2>{props.title}</h2>
        {props.subtitle ? <p>{props.subtitle}</p> : null}
      </div>
    )
);

jest.mock(
  '@/components/ui/PosterGrid',
  () =>
    ({ children }: { children: React.ReactNode }) =>
      <div>{children}</div>
);

jest.mock(
  '@/components/VideoCard',
  () => (props: { items?: Array<{ title: string }>; tvMode?: boolean }) =>
    (
      <button
        type='button'
        data-testid='ai-video-card'
        data-tv-mode={props.tvMode}
        data-tv-card-primary={props.tvMode || undefined}
      >
        海报卡片 {props.items?.[0]?.title || ''}
      </button>
    )
);

const savedResponse: AiFindResponse = {
  answer: '这是保存的结果',
  candidateQueries: [
    {
      query: '英雄本色',
      reason: '经典港片动作片',
      confidence: 'high',
      type: 'movie',
    },
  ],
  groups: [
    {
      query: '英雄本色',
      reason: '经典港片动作片',
      confidence: 'high',
      rawCount: 1,
      groupedCount: 1,
      groups: [
        {
          groupKey: '英雄本色-1986-movie',
          title: '英雄本色',
          year: '1986',
          items: [
            {
              id: '1',
              title: '英雄本色',
              poster: 'poster.jpg',
              episodes: ['第一集'],
              source: 'test',
              source_name: '测试源',
              year: '1986',
            },
          ],
        },
      ],
    },
  ],
  suggestions: [],
  toolTrace: [],
  generatedAt: 1700000000000,
};

function mockHeaders() {
  return {
    get: (key: string) =>
      key.toLowerCase() === 'x-ai-find-request-id' ? 'server_req' : null,
  };
}

describe('AiFindPanel', () => {
  const mockedListAiFindSavedRecords =
    listAiFindSavedRecords as jest.MockedFunction<
      typeof listAiFindSavedRecords
    >;
  const mockedGetAiFindSavedRecord =
    getAiFindSavedRecord as jest.MockedFunction<typeof getAiFindSavedRecord>;
  const mockedDeleteAiFindSavedRecord =
    deleteAiFindSavedRecord as jest.MockedFunction<
      typeof deleteAiFindSavedRecord
    >;
  const mockedCreateAiFindRequestId =
    createAiFindRequestId as jest.MockedFunction<typeof createAiFindRequestId>;

  beforeEach(() => {
    mockedListAiFindSavedRecords.mockResolvedValue([]);
    mockedGetAiFindSavedRecord.mockResolvedValue(null);
    mockedCreateAiFindRequestId.mockReturnValue('req_test');
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses the shared AI and progressive group pipeline in TV mode, with results usable while other candidates load', async () => {
    mockedListAiFindSavedRecords.mockResolvedValue([
      {
        id: 'busy_record',
        query: '保存的查询',
        answer: '',
        candidateCount: 1,
        foundGroupCount: 1,
        status: 'complete',
        createdAt: 1,
        updatedAt: 1,
        lastOpenedAt: 1,
        openedCount: 0,
      },
    ]);
    let finishGroup: () => void = () => undefined;
    const pendingGroup = new Promise<void>((resolve) => {
      finishGroup = resolve;
    });
    const fetchMock = jest
      .fn()
      .mockImplementation(async (url: string, init: RequestInit) => {
        if (url === '/api/ai/find')
          return {
            ok: true,
            status: 200,
            headers: mockHeaders(),
            json: async () => ({
              ...savedResponse,
              candidateQueries: [
                ...savedResponse.candidateQueries,
                { ...savedResponse.candidateQueries[0], query: '另一部' },
              ],
              groups: [],
            }),
          };
        const { candidate } = JSON.parse(String(init.body));
        if (candidate.query === '另一部') {
          await pendingGroup;
          return { ok: false, json: async () => ({ error: '线路查询失败' }) };
        }
        return {
          ok: true,
          json: async () => ({ group: savedResponse.groups[0] }),
        };
      });
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;
    await act(async () => {
      render(<AiFindPanel tvMode initialQuery='港片动作片' />);
    });
    const input = screen.getByRole('searchbox', { name: 'AI 找片描述' });
    expect(input).toHaveAttribute('readonly');
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: '  经典港片  ' } });
    fireEvent.submit(screen.getByRole('search'));
    const card = await screen.findByTestId('ai-video-card');
    expect(card).toHaveTextContent('英雄本色');
    expect(card).toHaveAttribute('data-tv-mode', 'true');
    expect(screen.queryByText(savedResponse.answer)).not.toBeInTheDocument();
    expect(screen.queryByText('高匹配')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新结果' })).toBeDisabled();
    const savedButton = screen.getByRole('button', { name: '保存的查询' });
    expect(savedButton).toBeDisabled();
    fireEvent.click(savedButton);
    expect(mockedGetAiFindSavedRecord).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      '已找到的影片可以直接播放'
    );
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ai/find');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      query: '经典港片',
      resolveGroups: false,
    });
    await act(async () => {
      finishGroup();
    });
    expect(await screen.findByText('线路查询失败')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新结果' })).not.toBeDisabled();
    expect(savedButton).not.toBeDisabled();
    expect(card).toBeInTheDocument();
  });

  it('opens compact TV saved results without rerunning AI and keeps cards in TV mode', async () => {
    mockedListAiFindSavedRecords.mockResolvedValue([
      {
        id: 'rec_tv',
        query: '经典港片',
        answer: savedResponse.answer,
        candidateCount: 1,
        foundGroupCount: 1,
        status: 'complete',
        createdAt: 1,
        updatedAt: 2,
        lastOpenedAt: 2,
        openedCount: 0,
      },
    ]);
    mockedGetAiFindSavedRecord.mockResolvedValue({
      id: 'rec_tv',
      userName: 'alice',
      query: '经典港片',
      response: savedResponse,
      status: 'complete',
      createdAt: 1,
      updatedAt: 2,
      lastOpenedAt: 2,
      openedCount: 0,
    });
    await act(async () => {
      render(<AiFindPanel tvMode />);
    });
    fireEvent.click(await screen.findByRole('button', { name: '经典港片' }));
    expect(await screen.findByTestId('ai-video-card')).toHaveAttribute(
      'data-tv-mode',
      'true'
    );
    await waitFor(() =>
      expect(screen.getByTestId('ai-video-card')).toHaveFocus()
    );
    expect(screen.getByRole('searchbox')).toHaveValue('经典港片');
    expect(screen.getByRole('button', { name: '经典港片' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('offers TV retry and fills suggestions without making an automatic AI request', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: mockHeaders(),
        json: async () => ({ error: 'AI 暂时不可用' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => ({
          ...savedResponse,
          candidateQueries: [],
          groups: [],
          answer: '请补充线索',
          suggestions: ['经典港片'],
        }),
      });
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;
    await act(async () => {
      render(<AiFindPanel tvMode initialQuery='找电影' />);
    });
    fireEvent.submit(screen.getByRole('search'));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI 暂时不可用');
    expect(screen.getByRole('searchbox')).toHaveAttribute(
      'aria-describedby',
      'tv-search-help ai-find-error'
    );
    fireEvent.click(screen.getByRole('button', { name: '重试找片' }));
    const suggestion = await screen.findByRole('button', { name: '经典港片' });
    fireEvent.click(suggestion);
    expect(screen.getByRole('searchbox')).toHaveValue('经典港片');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stops loading timers and ignores a pending AI response after leaving the panel', async () => {
    let finishFind: () => void = () => undefined;
    const pendingFind = new Promise<void>((resolve) => {
      finishFind = resolve;
    });
    const fetchMock = jest.fn().mockImplementation(async () => {
      await pendingFind;
      return {
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => savedResponse,
      };
    });
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;
    const clearInterval = jest.spyOn(window, 'clearInterval');
    const view = render(<AiFindPanel tvMode initialQuery='港片' />);
    fireEvent.submit(screen.getByRole('search'));
    await screen.findByRole('button', { name: '查找中' });
    clearInterval.mockClear();
    view.unmount();
    expect(clearInterval).toHaveBeenCalled();
    await act(async () => {
      finishFind();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearInterval.mockRestore();
  });

  it('loads a saved record without calling AI find endpoints', async () => {
    mockedListAiFindSavedRecords.mockResolvedValue([
      {
        id: 'rec_1',
        query: '90年代港片动作片',
        answer: '这是保存的结果',
        candidateCount: 1,
        foundGroupCount: 1,
        status: 'complete',
        createdAt: 1,
        updatedAt: 2,
        lastOpenedAt: 2,
        openedCount: 0,
      },
    ]);
    mockedGetAiFindSavedRecord.mockResolvedValue({
      id: 'rec_1',
      userName: 'alice',
      query: '90年代港片动作片',
      response: savedResponse,
      status: 'complete',
      createdAt: 1,
      updatedAt: 2,
      lastOpenedAt: 2,
      openedCount: 0,
    });

    await act(async () => {
      render(<AiFindPanel />);
    });

    fireEvent.click(
      await screen.findByRole('button', { name: '90年代港片动作片' })
    );

    await waitFor(() => {
      expect(screen.getAllByText('英雄本色').length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/海报卡片 英雄本色/)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/ai\/find/)
    );
  });

  it('removes the opened saved record from the screen after deleting it', async () => {
    const openedResponse: AiFindResponse = {
      answer: 'saved answer',
      candidateQueries: [
        {
          query: 'saved title',
          reason: 'saved reason',
          confidence: 'high',
          type: 'movie',
        },
      ],
      groups: [
        {
          query: 'saved title',
          reason: 'saved reason',
          confidence: 'high',
          rawCount: 1,
          groupedCount: 1,
          groups: [
            {
              groupKey: 'saved-title-1986-movie',
              title: 'saved title',
              year: '1986',
              items: [
                {
                  id: '1',
                  title: 'saved title',
                  poster: 'poster.jpg',
                  episodes: ['episode 1'],
                  source: 'test',
                  source_name: 'test source',
                  year: '1986',
                },
              ],
            },
          ],
        },
      ],
      suggestions: [],
      toolTrace: [],
      generatedAt: 1700000000000,
    };
    const summary = {
      id: 'rec_1',
      query: 'saved query',
      answer: 'saved answer',
      candidateCount: 1,
      foundGroupCount: 1,
      status: 'complete' as const,
      createdAt: 1,
      updatedAt: 2,
      lastOpenedAt: 2,
      openedCount: 0,
    };
    mockedListAiFindSavedRecords
      .mockResolvedValueOnce([summary])
      .mockResolvedValueOnce([summary])
      .mockResolvedValueOnce([]);
    mockedGetAiFindSavedRecord.mockResolvedValue({
      id: 'rec_1',
      userName: 'alice',
      query: 'saved query',
      response: openedResponse,
      status: 'complete',
      createdAt: 1,
      updatedAt: 2,
      lastOpenedAt: 2,
      openedCount: 0,
    });
    mockedDeleteAiFindSavedRecord.mockResolvedValue(undefined);

    await act(async () => {
      render(<AiFindPanel />);
    });

    fireEvent.click(await screen.findByRole('button', { name: 'saved query' }));

    await waitFor(() => {
      expect(screen.getAllByText('saved title').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: '删除记录' }));

    await waitFor(() => {
      expect(mockedDeleteAiFindSavedRecord).toHaveBeenCalledWith('rec_1');
      expect(
        screen.queryByRole('button', { name: 'saved query' })
      ).not.toBeInTheDocument();
      expect(screen.queryByText('saved title')).not.toBeInTheDocument();
    });
  });

  it('uses the AI response candidate count as-is', async () => {
    const candidateQueries = Array.from({ length: 7 }, (_, index) => ({
      query: `候选${index + 1}`,
      reason: '根据你的描述生成的候选片名',
      confidence: 'medium',
      type: 'movie',
    }));
    const fetchMock = jest
      .fn()
      .mockImplementation(async (url: string, init?: { body?: string }) => {
        if (url === '/api/ai/find') {
          return {
            ok: true,
            status: 200,
            headers: mockHeaders(),
            json: async () => ({
              answer: '已根据你的描述生成候选搜索词。',
              candidateQueries,
              groups: [],
              suggestions: [],
              toolTrace: [],
              generatedAt: 1700000000000,
            }),
          };
        }

        const body = init?.body ? JSON.parse(init.body) : {};
        const candidate = body.candidate || candidateQueries[0];
        return {
          ok: true,
          status: 200,
          headers: mockHeaders(),
          json: async () => ({
            group: {
              query: candidate.query,
              reason: candidate.reason,
              confidence: candidate.confidence,
              rawCount: 0,
              groupedCount: 0,
              groups: [],
              notFound: true,
            },
            failed: false,
          }),
        };
      });
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;

    await act(async () => {
      render(<AiFindPanel />);
    });

    fireEvent.change(screen.getByPlaceholderText(/想看节奏快一点/), {
      target: { value: '90年代经典港片动作片' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始找片' }));

    await waitFor(() => {
      expect(screen.getAllByText('候选7').length).toBeGreaterThan(0);
    });

    candidateQueries.forEach((candidate) => {
      expect(screen.getAllByText(candidate.query).length).toBeGreaterThan(0);
    });
  });

  it('prefills the input from the search page query', async () => {
    await act(async () => {
      render(<AiFindPanel initialQuery='鬼灭之刃' />);
    });

    expect(screen.getByPlaceholderText(/想看节奏快一点/)).toHaveValue(
      '鬼灭之刃'
    );
  });

  it('exposes an accessible name and live regions for query status', async () => {
    let resolveFind:
      | ((value: {
          ok: boolean;
          status: number;
          headers: ReturnType<typeof mockHeaders>;
          json: () => Promise<unknown>;
        }) => void)
      | undefined;
    const findPromise = new Promise<{
      ok: boolean;
      status: number;
      headers: ReturnType<typeof mockHeaders>;
      json: () => Promise<unknown>;
    }>((resolve) => {
      resolveFind = resolve;
    });

    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockImplementation(async (url: string) => {
        if (url === '/api/ai/find') {
          return findPromise;
        }

        return {
          ok: true,
          status: 200,
          headers: mockHeaders(),
          json: async () => ({
            group: {
              query: '测试候选',
              reason: '测试',
              confidence: 'high',
              rawCount: 0,
              groupedCount: 0,
              groups: [],
              notFound: true,
            },
            failed: false,
          }),
        };
      });

    await act(async () => {
      render(<AiFindPanel />);
    });

    const input = screen.getByRole('textbox', { name: 'AI 找片描述' });
    expect(input).toHaveAttribute('id', 'ai-find-query');
    expect(input).not.toHaveAttribute('aria-describedby');

    fireEvent.change(input, {
      target: { value: '90年代经典港片动作片' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始找片' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('正在理解你的找片需求');

    resolveFind?.({
      ok: false,
      status: 500,
      headers: mockHeaders(),
      json: async () => ({
        error: 'AI 找片服务暂时不可用',
      }),
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('id', 'ai-find-error');
    expect(alert).toHaveTextContent('AI 找片服务暂时不可用');
    expect(input).toHaveAttribute('aria-describedby', 'ai-find-error');
  });

  it('ignores a stale main submit when a newer submit finishes first', async () => {
    mockedCreateAiFindRequestId
      .mockReturnValueOnce('run_first')
      .mockReturnValueOnce('run_second');

    type MockFindResponse = {
      ok: boolean;
      status: number;
      headers: ReturnType<typeof mockHeaders>;
      json: () => Promise<unknown>;
    };

    let resolveFirstFind: ((value: MockFindResponse) => void) | undefined;
    const firstFindPromise = new Promise<MockFindResponse>((resolve) => {
      resolveFirstFind = resolve;
    });

    const fetchMock = jest.fn().mockImplementation(async (url: string) => {
      if (url === '/api/ai/find') {
        const callIndex = fetchMock.mock.calls.filter(
          ([requestedUrl]) => requestedUrl === '/api/ai/find'
        ).length;

        if (callIndex === 1) {
          return firstFindPromise;
        }

        return {
          ok: true,
          status: 200,
          headers: mockHeaders(),
          json: async () => ({
            answer: '第二次提交的结果',
            candidateQueries: [
              {
                query: '第二次候选',
                reason: '第二次提交',
                confidence: 'high',
                type: 'movie',
              },
            ],
            groups: [],
            suggestions: [],
            toolTrace: [],
            generatedAt: 1700000000000,
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        headers: mockHeaders(),
        json: async () => ({
          group: {
            query: '第二次候选',
            reason: '第二次提交',
            confidence: 'high',
            rawCount: 0,
            groupedCount: 0,
            groups: [],
            notFound: true,
          },
          failed: false,
        }),
      };
    });
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;

    await act(async () => {
      render(<AiFindPanel />);
    });

    const form = screen
      .getByPlaceholderText(/想看节奏快一点/)
      .closest('form') as HTMLFormElement;

    fireEvent.change(screen.getByPlaceholderText(/想看节奏快一点/), {
      target: { value: '第一次查询' },
    });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '查找中' })).toBeDisabled();
    });

    fireEvent.change(screen.getByPlaceholderText(/想看节奏快一点/), {
      target: { value: '第二次查询' },
    });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('第二次提交的结果')).toBeInTheDocument();
      expect(screen.getAllByText('第二次候选').length).toBeGreaterThan(0);
    });

    resolveFirstFind?.({
      ok: true,
      status: 200,
      headers: mockHeaders(),
      json: async () => ({
        answer: '第一次提交的结果',
        candidateQueries: [
          {
            query: '第一次候选',
            reason: '第一次提交',
            confidence: 'high',
            type: 'movie',
          },
        ],
        groups: [],
        suggestions: [],
        toolTrace: [],
        generatedAt: 1700000000000,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('第二次提交的结果')).toBeInTheDocument();
      expect(screen.queryByText('第一次提交的结果')).not.toBeInTheDocument();
      expect(screen.queryByText('第一次候选')).not.toBeInTheDocument();
    });
  });
});
