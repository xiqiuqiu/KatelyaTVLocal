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
  headers: MockHeaders;

  constructor(input: string, init?: { headers?: Record<string, string> }) {
    this.url = input;
    this.headers = new MockHeaders(init?.headers);
  }
}

class MockResponse {
  status: number;
  headers: MockHeaders;
  private readonly payload: unknown;

  constructor(payload: unknown, init?: { status?: number }) {
    this.payload = payload;
    this.status = init?.status ?? 200;
    this.headers = new MockHeaders();
  }

  async json(): Promise<unknown> {
    return this.payload;
  }
}

(global as unknown as { Headers?: typeof MockHeaders }).Headers = MockHeaders;
(global as unknown as { Request?: typeof MockRequest }).Request = MockRequest;
(global as unknown as { Response?: typeof MockResponse }).Response =
  MockResponse;

jest.mock('next/server', () => ({
  NextResponse: {
    json: (payload: unknown, init?: { status?: number }) =>
      new MockResponse(payload, init),
  },
}));

jest.mock(
  '@cloudflare/next-on-pages',
  () => ({
    getOptionalRequestContext: jest.fn(() => undefined),
  }),
  { virtual: true }
);

jest.mock('@/lib/db', () => ({
  db: {
    getAllUsers: jest.fn().mockResolvedValue([]),
    getRecentPlayRecords: jest.fn(),
    savePlayRecord: jest.fn(),
    getAllFavorites: jest.fn(),
    saveFavorite: jest.fn(),
  },
}));

jest.mock('@/lib/fetchVideoDetail', () => ({
  fetchVideoDetail: jest.fn(),
}));

jest.mock('@/lib/source-ranking/scheduler', () => ({
  runLowFrequencySourceRankingCheck: jest.fn(),
}));

const originalEnv = process.env;

let GET: (request: Request) => Promise<Response>;

describe('cron route auth', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET } = require('@/app/api/cron/route'));
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CRON_API_TOKEN;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('returns unauthorized when cron token is not configured', async () => {
    const response = await GET(
      new MockRequest('https://app.example.com/api/cron') as unknown as Request
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: 'Unauthorized',
    });
    expect(console.error).toHaveBeenCalledWith(
      'Cron API rejected: CRON_API_TOKEN is not configured'
    );
  });

  it('returns unauthorized when request token is absent', async () => {
    process.env.CRON_API_TOKEN = 'secret-token';

    const response = await GET(
      new MockRequest('https://app.example.com/api/cron') as unknown as Request
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: 'Unauthorized',
    });
    expect(console.error).toHaveBeenCalledWith(
      'Cron API rejected: unauthorized request'
    );
  });

  it('returns unauthorized when request token does not match', async () => {
    process.env.CRON_API_TOKEN = 'secret-token';

    const response = await GET(
      new MockRequest('https://app.example.com/api/cron', {
        headers: { 'x-cron-token': 'wrong-token' },
      }) as unknown as Request
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: 'Unauthorized',
    });
    expect(console.error).toHaveBeenCalledWith(
      'Cron API rejected: unauthorized request'
    );
  });

  it('does not expose token configuration details in unauthorized responses', async () => {
    process.env.CRON_API_TOKEN = 'secret-token';

    const response = await GET(
      new MockRequest('https://app.example.com/api/cron', {
        headers: { 'x-cron-token': 'wrong-token' },
      }) as unknown as Request
    );

    const body = await response.json();
    expect(body).toEqual({
      success: false,
      message: 'Unauthorized',
    });
    expect(JSON.stringify(body)).not.toContain('secret-token');
    expect(JSON.stringify(body)).not.toContain('wrong-token');
  });
});
