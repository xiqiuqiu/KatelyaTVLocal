import { getAuthInfoFromCookie } from '@/lib/auth';
import { getStorage } from '@/lib/db';
import type { EpisodeAdSkipConfig } from '@/lib/types';

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

  constructor(
    private readonly payload: unknown,
    init?: { status?: number; headers?: Record<string, string> }
  ) {
    this.status = init?.status ?? 200;
    this.headers = new MockHeaders(init?.headers);
  }

  async json(): Promise<unknown> {
    return this.payload;
  }
}

(global as unknown as { Request?: typeof MockRequest }).Request = MockRequest;
(global as unknown as { Headers?: typeof MockHeaders }).Headers = MockHeaders;
(global as unknown as { Response?: typeof MockResponse }).Response =
  MockResponse;

let POST: (request: Request) => Promise<MockResponse>;
let OPTIONS: () => Promise<MockResponse | Response>;

jest.mock('next/server', () => ({
  NextResponse: {
    json: (
      payload: unknown,
      init?: { status?: number; headers?: Record<string, string> }
    ) => new MockResponse(payload, init),
  },
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  getStorage: jest.fn(),
}));

jest.mock('@/lib/cors', () => ({
  addCorsHeaders: (response: MockResponse) => {
    response.headers.set('Access-Control-Allow-Origin', '*');
    return response;
  },
  handleOptionsRequest: () =>
    new MockResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods':
          'GET, POST, PUT, DELETE, OPTIONS',
      },
    }),
}));

describe('ad-skip-windows route', () => {
  const mockedGetAuthInfoFromCookie =
    getAuthInfoFromCookie as jest.MockedFunction<typeof getAuthInfoFromCookie>;
  const mockedGetStorage = getStorage as jest.MockedFunction<typeof getStorage>;

  const sampleConfig: EpisodeAdSkipConfig = {
    source: 'ruyi',
    id: '38961',
    episodeIndex: 0,
    updated_time: 1000,
    windows: [
      {
        source: 'ruyi',
        id: '38961',
        episodeIndex: 0,
        startTimeSeconds: 10,
        endTimeSeconds: 20,
        trustScore: 1,
        confirmCount: 1,
        undoCount: 0,
        updated_time: 1000,
        ruleId: 'user-mark',
        origin: 'persisted',
      },
    ],
  };

  const storage = {
    getAdSkipConfig: jest.fn(),
    setAdSkipConfig: jest.fn(),
    getAllAdSkipConfigs: jest.fn(),
    deleteAdSkipConfig: jest.fn(),
  };

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ POST, OPTIONS } = require('@/app/api/ad-skip-windows/route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAuthInfoFromCookie.mockResolvedValue({
      username: 'alice',
    } as Awaited<ReturnType<typeof getAuthInfoFromCookie>>);
    mockedGetStorage.mockReturnValue(storage as never);
    storage.getAdSkipConfig.mockResolvedValue(sampleConfig);
    storage.setAdSkipConfig.mockResolvedValue(undefined);
    storage.getAllAdSkipConfigs.mockResolvedValue({
      'ruyi+38961+0': sampleConfig,
    });
    storage.deleteAdSkipConfig.mockResolvedValue(undefined);
  });

  it('rejects unauthenticated requests', async () => {
    mockedGetAuthInfoFromCookie.mockResolvedValue(null);

    const response = await POST(
      new MockRequest('https://app.example.com/api/ad-skip-windows', {
        method: 'POST',
        body: JSON.stringify({ action: 'get', key: 'ruyi+38961+0' }),
      }) as unknown as Request
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: '用户未登录' });
    expect(storage.getAdSkipConfig).not.toHaveBeenCalled();
  });

  it('returns CORS headers on OPTIONS preflight', async () => {
    const response = await OPTIONS();
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('reads an episode Ad Skip Window config by shared key', async () => {
    const response = await POST(
      new MockRequest('https://app.example.com/api/ad-skip-windows', {
        method: 'POST',
        body: JSON.stringify({ action: 'get', key: 'ruyi+38961+0' }),
      }) as unknown as Request
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    await expect(response.json()).resolves.toEqual({ config: sampleConfig });
    expect(storage.getAdSkipConfig).toHaveBeenCalledWith('ruyi+38961+0');
  });

  it('writes a shared episode Ad Skip Window config without user scoping', async () => {
    const response = await POST(
      new MockRequest('https://app.example.com/api/ad-skip-windows', {
        method: 'POST',
        body: JSON.stringify({
          action: 'set',
          key: 'ruyi+38961+0',
          config: sampleConfig,
        }),
      }) as unknown as Request
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(storage.setAdSkipConfig).toHaveBeenCalledWith(
      'ruyi+38961+0',
      sampleConfig
    );
  });

  it('lists all shared Ad Skip Window configs', async () => {
    const response = await POST(
      new MockRequest('https://app.example.com/api/ad-skip-windows', {
        method: 'POST',
        body: JSON.stringify({ action: 'getAll' }),
      }) as unknown as Request
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      configs: { 'ruyi+38961+0': sampleConfig },
    });
    expect(storage.getAllAdSkipConfigs).toHaveBeenCalled();
  });

  it('deletes a shared episode Ad Skip Window config', async () => {
    const response = await POST(
      new MockRequest('https://app.example.com/api/ad-skip-windows', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', key: 'ruyi+38961+0' }),
      }) as unknown as Request
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(storage.deleteAdSkipConfig).toHaveBeenCalledWith('ruyi+38961+0');
  });

  it('rejects invalid window payload on set', async () => {
    const response = await POST(
      new MockRequest('https://app.example.com/api/ad-skip-windows', {
        method: 'POST',
        body: JSON.stringify({
          action: 'set',
          key: 'ruyi+38961+0',
          config: {
            source: 'ruyi',
            id: '38961',
            episodeIndex: 0,
            updated_time: 1000,
            windows: [
              {
                startTimeSeconds: 20,
                endTimeSeconds: 10,
              },
            ],
          },
        }),
      }) as unknown as Request
    );

    expect(response.status).toBe(400);
    expect(storage.setAdSkipConfig).not.toHaveBeenCalled();
  });
});
