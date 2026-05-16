import { getAiFindConfig } from '@/lib/ai-find/config';
import { runAiFind } from '@/lib/ai-find/orchestrator';
import { checkAiFindRateLimit } from '@/lib/ai-find/rate-limit';
import { getAuthInfoFromCookie } from '@/lib/auth';

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

jest.mock('@/lib/ai-find/rate-limit', () => ({
  checkAiFindRateLimit: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
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
  const mockedCheckAiFindRateLimit =
    checkAiFindRateLimit as jest.MockedFunction<typeof checkAiFindRateLimit>;
  const mockedGetAuthInfoFromCookie =
    getAuthInfoFromCookie as jest.MockedFunction<typeof getAuthInfoFromCookie>;

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
      temperature: 0.2,
      maxToolRounds: 4,
      requestTimeoutMs: 20000,
      maxResults: 5,
      webSearchEnabled: false,
      webSearchProvider: 'none',
      webSearchEndpoint: '',
      webSearchApiKey: '',
      dailyLimitPerUser: 20,
      cacheTtlSeconds: 1800,
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
    expect(mockedGetAuthInfoFromCookie).not.toHaveBeenCalled();
    expect(mockedCheckAiFindRateLimit).not.toHaveBeenCalled();
    expect(mockedRunAiFind).not.toHaveBeenCalled();
  });
});
