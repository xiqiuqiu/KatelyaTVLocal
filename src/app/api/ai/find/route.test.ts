import { getAiFindConfig } from '@/lib/ai-find/config';
import { AiFindUserFacingError } from '@/lib/ai-find/errors';
import { runAiFind } from '@/lib/ai-find/orchestrator';
import { enforceAiFindRequestGuard } from '@/lib/ai-find/request-guard';

class MockHeaders {
  private readonly values = new Map<string, string>();

  constructor(init?: Record<string, string>) {
    Object.entries(init || {}).forEach(([key, value]) => {
      this.values.set(key.toLowerCase(), value);
    });
  }

  get(key: string) {
    return this.values.get(key.toLowerCase()) || null;
  }

  set(key: string, value: string) {
    this.values.set(key.toLowerCase(), value);
  }

  forEach(callback: (value: string, key: string) => void) {
    this.values.forEach((value, key) => callback(value, key));
  }
}

class MockRequest {
  url: string;
  method: string;
  headers: MockHeaders;
  private readonly bodyText: string;

  constructor(
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ) {
    this.url = input;
    this.method = init?.method || 'GET';
    this.headers = new MockHeaders(init?.headers);
    this.bodyText = init?.body || '';
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.bodyText || 'null');
  }
}

class MockResponse {
  status: number;
  headers: MockHeaders;

  constructor(private readonly payload: unknown, init?: { status?: number }) {
    this.status = init?.status ?? 200;
    this.headers = new MockHeaders();
  }

  async json(): Promise<unknown> {
    return this.payload;
  }

  static json(payload: unknown, init?: { status?: number }) {
    return new MockResponse(payload, init);
  }
}

(global as unknown as { Request?: typeof MockRequest }).Request = MockRequest;
(global as unknown as { Headers?: typeof MockHeaders }).Headers = MockHeaders;
(global as unknown as { Response?: typeof MockResponse }).Response =
  MockResponse;

let POST: (request: Request) => Promise<MockResponse>;

jest.mock('next/server', () => ({
  NextResponse: {
    json: (payload: unknown, init?: { status?: number }) =>
      new MockResponse(payload, init),
  },
}));

jest.mock('@/lib/ai-find/config', () => ({
  getAiFindConfig: jest.fn(),
  getAiFindConfigError: jest.fn((config) => {
    if (!config.enabled) {
      return 'AI find assistant is disabled';
    }

    if (!config.apiKey) {
      return 'AI_API_KEY is required when AI find assistant is enabled';
    }

    if (!config.model) {
      return 'AI_MODEL is required when AI find assistant is enabled';
    }

    return null;
  }),
}));

jest.mock('@/lib/ai-find/orchestrator', () => ({
  runAiFind: jest.fn(),
}));

jest.mock('@/lib/ai-find/request-guard', () => ({
  enforceAiFindRequestGuard: jest.fn(),
}));

jest.mock('@/lib/cors', () => ({
  addCorsHeaders: (response: MockResponse) => response,
  handleOptionsRequest: jest.fn(),
}));

describe('AI find route', () => {
  const mockedGetAiFindConfig = getAiFindConfig as jest.MockedFunction<
    typeof getAiFindConfig
  >;
  const mockedRunAiFind = runAiFind as jest.MockedFunction<typeof runAiFind>;
  const mockedEnforceAiFindRequestGuard =
    enforceAiFindRequestGuard as jest.MockedFunction<
      typeof enforceAiFindRequestGuard
    >;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ POST } = require('@/app/api/ai/find/route'));
  });

  beforeEach(() => {
    mockedGetAiFindConfig.mockReturnValue({
      enabled: false,
      baseUrl: 'https://ai.example/v1',
      apiKey: '',
      model: '',
      debug: false,
      temperature: 0.2,
      maxToolRounds: 4,
      requestTimeoutMs: 20000,
      maxTokens: 800,
      thinkingMode: 'auto',
      maxResults: 5,
      webSearchEnabled: false,
      webSearchProvider: 'none',
      webSearchEndpoint: '',
      webSearchApiKey: '',
      dailyLimitPerUser: 20,
      dailyLimitPerIp: 60,
      dailyLimitGlobal: 500,
      groupDailyLimitPerUser: 100,
      groupDailyLimitPerIp: 300,
      groupDailyLimitGlobal: 2500,
      cacheTtlSeconds: 1800,
    });
    mockedEnforceAiFindRequestGuard.mockResolvedValue({
      ok: true,
      username: 'alice',
      ip: '203.0.113.10',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects disabled AI find requests before auth and rate limiting', async () => {
    const response = await POST(
      new Request('https://app.example.com/api/ai/find', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: '想看节奏快一点的国产悬疑剧',
        }),
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'AI find assistant is disabled',
    });
    expect(mockedEnforceAiFindRequestGuard).not.toHaveBeenCalled();
    expect(mockedRunAiFind).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated AI find requests before running AI', async () => {
    mockedGetAiFindConfig.mockReturnValue({
      enabled: true,
      baseUrl: 'https://ai.example/v1',
      apiKey: 'key',
      model: 'model',
      debug: false,
      temperature: 0.2,
      maxToolRounds: 4,
      requestTimeoutMs: 20000,
      maxTokens: 800,
      thinkingMode: 'auto',
      maxResults: 5,
      webSearchEnabled: false,
      webSearchProvider: 'none',
      webSearchEndpoint: '',
      webSearchApiKey: '',
      dailyLimitPerUser: 20,
      dailyLimitPerIp: 60,
      dailyLimitGlobal: 500,
      groupDailyLimitPerUser: 100,
      groupDailyLimitPerIp: 300,
      groupDailyLimitGlobal: 2500,
      cacheTtlSeconds: 1800,
    });
    mockedEnforceAiFindRequestGuard.mockResolvedValue({
      ok: false,
      ip: '203.0.113.10',
      status: 401,
      error: '请先登录后再使用 AI 找片',
    });

    const response = await POST(
      new Request('https://app.example.com/api/ai/find', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: '想看节奏快一点的国产悬疑剧',
        }),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: '请先登录后再使用 AI 找片',
    });
    expect(mockedRunAiFind).not.toHaveBeenCalled();
  });

  it('rejects daily quota exhaustion before running AI', async () => {
    mockedGetAiFindConfig.mockReturnValue({
      enabled: true,
      baseUrl: 'https://ai.example/v1',
      apiKey: 'key',
      model: 'model',
      debug: false,
      temperature: 0.2,
      maxToolRounds: 4,
      requestTimeoutMs: 20000,
      maxTokens: 800,
      thinkingMode: 'auto',
      maxResults: 5,
      webSearchEnabled: false,
      webSearchProvider: 'none',
      webSearchEndpoint: '',
      webSearchApiKey: '',
      dailyLimitPerUser: 20,
      dailyLimitPerIp: 60,
      dailyLimitGlobal: 500,
      groupDailyLimitPerUser: 100,
      groupDailyLimitPerIp: 300,
      groupDailyLimitGlobal: 2500,
      cacheTtlSeconds: 1800,
    });
    mockedEnforceAiFindRequestGuard.mockResolvedValue({
      ok: false,
      username: 'alice',
      ip: '203.0.113.10',
      status: 429,
      error: 'AI 找片次数已达到今日上限',
      resetAt: 1779292800000,
    });

    const response = await POST(
      new Request('https://app.example.com/api/ai/find', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: '想看节奏快一点的国产悬疑剧',
        }),
      })
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: 'AI 找片次数已达到今日上限',
      resetAt: 1779292800000,
    });
    expect(mockedRunAiFind).not.toHaveBeenCalled();
  });

  it('returns a JSON error when ai find execution aborts unexpectedly', async () => {
    mockedGetAiFindConfig.mockReturnValue({
      enabled: true,
      baseUrl: 'https://ai.example/v1',
      apiKey: 'key',
      model: 'model',
      debug: false,
      temperature: 0.2,
      maxToolRounds: 4,
      requestTimeoutMs: 20000,
      maxTokens: 800,
      thinkingMode: 'auto',
      maxResults: 5,
      webSearchEnabled: false,
      webSearchProvider: 'none',
      webSearchEndpoint: '',
      webSearchApiKey: '',
      dailyLimitPerUser: 20,
      dailyLimitPerIp: 60,
      dailyLimitGlobal: 500,
      groupDailyLimitPerUser: 100,
      groupDailyLimitPerIp: 300,
      groupDailyLimitGlobal: 2500,
      cacheTtlSeconds: 1800,
    });
    mockedRunAiFind.mockRejectedValue(new Error('The operation was aborted'));

    const response = await POST(
      new Request('https://app.example.com/api/ai/find', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: '想看节奏快一点的国产悬疑剧',
        }),
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'AI 找片暂时不可用，请稍后再试',
    });
  });

  it('returns a timeout error without running a raw-query fallback search', async () => {
    mockedGetAiFindConfig.mockReturnValue({
      enabled: true,
      baseUrl: 'https://ai.example/v1',
      apiKey: 'key',
      model: 'model',
      debug: false,
      temperature: 0.2,
      maxToolRounds: 4,
      requestTimeoutMs: 20000,
      maxTokens: 800,
      thinkingMode: 'auto',
      maxResults: 5,
      webSearchEnabled: false,
      webSearchProvider: 'none',
      webSearchEndpoint: '',
      webSearchApiKey: '',
      dailyLimitPerUser: 20,
      dailyLimitPerIp: 60,
      dailyLimitGlobal: 500,
      groupDailyLimitPerUser: 100,
      groupDailyLimitPerIp: 300,
      groupDailyLimitGlobal: 2500,
      cacheTtlSeconds: 1800,
    });
    mockedRunAiFind.mockRejectedValue(
      new AiFindUserFacingError({
        message: 'The operation was aborted',
        publicMessage: 'AI 找片请求超时，请稍后再试',
        status: 504,
      })
    );

    const response = await POST(
      new Request('https://app.example.com/api/ai/find', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: '有部好莱坞电影，里面坏蛋在车门上装了炸弹',
        }),
      })
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({
      error: 'AI 找片请求超时，请稍后再试',
    });
  });

  it('propagates request id and per-request debug flag to the orchestrator', async () => {
    mockedGetAiFindConfig.mockReturnValue({
      enabled: true,
      baseUrl: 'https://ai.example/v1',
      apiKey: 'key',
      model: 'model',
      debug: false,
      temperature: 0.2,
      maxToolRounds: 4,
      requestTimeoutMs: 20000,
      maxTokens: 800,
      thinkingMode: 'auto',
      maxResults: 5,
      webSearchEnabled: false,
      webSearchProvider: 'none',
      webSearchEndpoint: '',
      webSearchApiKey: '',
      dailyLimitPerUser: 20,
      dailyLimitPerIp: 60,
      dailyLimitGlobal: 500,
      groupDailyLimitPerUser: 100,
      groupDailyLimitPerIp: 300,
      groupDailyLimitGlobal: 2500,
      cacheTtlSeconds: 1800,
    });
    mockedRunAiFind.mockResolvedValue({
      answer: 'ok',
      candidateQueries: [],
      groups: [],
      suggestions: [],
      toolTrace: [],
      generatedAt: Date.now(),
    });

    const response = await POST(
      new Request('https://app.example.com/api/ai/find?aiDebug=1', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ai-find-request-id': 'af-test-123',
          'x-ai-find-debug': '1',
        },
        body: JSON.stringify({
          query: '想看节奏快一点的国产悬疑剧',
        }),
      })
    );

    expect(mockedRunAiFind).toHaveBeenCalledWith(
      expect.objectContaining({
        debugContext: expect.objectContaining({
          enabled: true,
          requestId: 'af-test-123',
          scope: 'server',
        }),
      })
    );
    expect(response.headers.get('x-ai-find-request-id')).toBe('af-test-123');
    expect(response.headers.get('x-ai-find-debug-enabled')).toBe('1');
  });
});
