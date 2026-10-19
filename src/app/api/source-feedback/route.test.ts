import { getOptionalRequestContext } from '@cloudflare/next-on-pages';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { savePlaybackFeedback } from '@/lib/source-ranking/feedback';
import { getSourceRankingRuntime } from '@/lib/source-ranking/runtime';

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
}

(global as unknown as { Request?: typeof MockRequest }).Request = MockRequest;
(global as unknown as { Headers?: typeof MockHeaders }).Headers = MockHeaders;
(global as unknown as { Response?: typeof MockResponse }).Response =
  MockResponse;

let POST: (request: Request) => Promise<MockResponse>;

jest.mock(
  '@cloudflare/next-on-pages',
  () => ({
    getOptionalRequestContext: jest.fn(),
  }),
  { virtual: true }
);

jest.mock('next/server', () => ({
  NextResponse: {
    json: (payload: unknown, init?: { status?: number }) =>
      new MockResponse(payload, init),
  },
}));

jest.mock('@/lib/source-ranking/feedback', () => ({
  savePlaybackFeedback: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/source-ranking/runtime', () => ({
  getSourceRankingRuntime: jest.fn(),
}));

describe('source feedback route', () => {
  const mockedGetOptionalRequestContext =
    getOptionalRequestContext as jest.MockedFunction<
      typeof getOptionalRequestContext
    >;
  const mockedSavePlaybackFeedback =
    savePlaybackFeedback as jest.MockedFunction<typeof savePlaybackFeedback>;
  const mockedGetAuthInfoFromCookie =
    getAuthInfoFromCookie as jest.MockedFunction<typeof getAuthInfoFromCookie>;
  const mockedGetSourceRankingRuntime =
    getSourceRankingRuntime as jest.MockedFunction<
      typeof getSourceRankingRuntime
    >;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ POST } = require('@/app/api/source-feedback/route'));
  });

  beforeEach(() => {
    mockedGetAuthInfoFromCookie.mockResolvedValue({
      version: 2,
      username: 'viewer',
      role: 'user',
      issuedAt: 1710000000,
    });
    mockedGetOptionalRequestContext.mockReturnValue({
      env: {
        DB: { prepare: jest.fn() },
      },
      cf: {},
      ctx: {},
    });
  });

  it('rejects unauthenticated feedback', async () => {
    mockedGetAuthInfoFromCookie.mockResolvedValue(null);

    const response = await POST(
      new Request('https://app.example.com/api/source-feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceKey: 'alpha',
          playbackMode: 'direct',
          startupSuccess: true,
        }),
      })
    );

    expect(response.status).toBe(401);
    expect(mockedSavePlaybackFeedback).not.toHaveBeenCalled();
  });

  it.each([
    [{ sourceKey: 'alpha', playbackMode: 'invalid', startupSuccess: true }],
    [{ sourceKey: 'alpha', playbackMode: 'direct' }],
    [
      {
        sourceKey: 'alpha',
        playbackMode: 'direct',
        startupSuccess: true,
        startupTimeMs: -1,
      },
    ],
    [
      {
        sourceKey: 'alpha',
        playbackMode: 'direct',
        startupSuccess: true,
        sessionError: 'x'.repeat(257),
      },
    ],
  ])('rejects invalid feedback payload %#', async (payload) => {
    const response = await POST(
      new Request('https://app.example.com/api/source-feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    );

    expect(response.status).toBe(400);
    expect(mockedSavePlaybackFeedback).not.toHaveBeenCalled();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('saves feedback with Cloudflare request env when ranking is enabled', async () => {
    mockedGetSourceRankingRuntime.mockReturnValue({
      enabled: true,
      hasD1: true,
      fallbackToLive: true,
    });
    mockedSavePlaybackFeedback.mockResolvedValue(true);

    const response = await POST(
      new Request('https://app.example.com/api/source-feedback', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceKey: 'alpha',
          playbackMode: 'direct',
          startupSuccess: true,
        }),
      })
    );

    expect(mockedGetSourceRankingRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        DB: expect.any(Object),
      })
    );
    expect(mockedSavePlaybackFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        DB: expect.any(Object),
      }),
      expect.objectContaining({
        sourceKey: 'alpha',
        playbackMode: 'direct',
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    await expect(response.json()).resolves.toEqual({ saved: true });
  });

  it('returns skipped when runtime says D1 is unavailable', async () => {
    mockedGetSourceRankingRuntime.mockReturnValue({
      enabled: true,
      hasD1: false,
      fallbackToLive: true,
    });

    const response = await POST(
      new Request('https://app.example.com/api/source-feedback', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceKey: 'alpha',
          playbackMode: 'direct',
          startupSuccess: true,
        }),
      })
    );

    expect(mockedSavePlaybackFeedback).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      saved: false,
      skipped: true,
    });
  });

  it('returns 202 instead of 500 when D1 persist throws (e.g. missing column)', async () => {
    mockedGetSourceRankingRuntime.mockReturnValue({
      enabled: true,
      hasD1: true,
      fallbackToLive: true,
    });
    mockedSavePlaybackFeedback.mockRejectedValue(
      new Error('no such column: platform')
    );

    const response = await POST(
      new Request('https://app.example.com/api/source-feedback', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceKey: 'alpha',
          playbackMode: 'direct',
          startupSuccess: true,
        }),
      })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      saved: false,
      skipped: true,
      error: 'feedback-persist-failed',
    });
  });
});
