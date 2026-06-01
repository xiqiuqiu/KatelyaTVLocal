import { getOptionalRequestContext } from '@cloudflare/next-on-pages';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { savePlaybackDebugLog } from '@/lib/playback-debug/logs';

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

let GET: (request: Request) => Promise<MockResponse>;
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

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

jest.mock('@/lib/playback-debug/logs', () => ({
  hasPlaybackDebugD1: jest.fn(() => true),
  savePlaybackDebugLog: jest.fn(),
}));

describe('playback debug route', () => {
  const mockedGetOptionalRequestContext =
    getOptionalRequestContext as jest.MockedFunction<
      typeof getOptionalRequestContext
    >;
  const mockedGetAuthInfoFromCookie =
    getAuthInfoFromCookie as jest.MockedFunction<typeof getAuthInfoFromCookie>;
  const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
  const mockedSavePlaybackDebugLog =
    savePlaybackDebugLog as jest.MockedFunction<typeof savePlaybackDebugLog>;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET, POST } = require('@/app/api/playback-debug/route'));
  });

  beforeEach(() => {
    process.env.USERNAME = 'owner';
    mockedGetOptionalRequestContext.mockReturnValue({
      env: {
        DB: { prepare: jest.fn() },
      },
      cf: {},
      ctx: {},
    });
    mockedGetAuthInfoFromCookie.mockResolvedValue({
      version: 2,
      username: 'owner',
      role: 'owner',
      issuedAt: 1,
    });
    mockedGetConfig.mockResolvedValue({
      SiteConfig: {
        PlaybackDebugEnabled: true,
      },
      UserConfig: {
        Users: [{ username: 'owner', role: 'owner' }],
      },
    } as Awaited<ReturnType<typeof getConfig>>);
    mockedSavePlaybackDebugLog.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.USERNAME;
  });

  it('exposes enabled status only to admin sessions', async () => {
    const response = await GET(
      new Request('https://app.example.com/api/playback-debug')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      canViewOverlay: true,
    });
  });

  it('does not expose debug mode to normal users', async () => {
    mockedGetAuthInfoFromCookie.mockResolvedValue({
      version: 2,
      username: 'bob',
      role: 'user',
      issuedAt: 1,
    });
    mockedGetConfig.mockResolvedValue({
      SiteConfig: {
        PlaybackDebugEnabled: true,
      },
      UserConfig: {
        Users: [{ username: 'bob', role: 'user' }],
      },
    } as Awaited<ReturnType<typeof getConfig>>);

    const response = await GET(
      new Request('https://app.example.com/api/playback-debug')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enabled: false,
      canViewOverlay: false,
    });
  });

  it('skips saving when debug mode is disabled', async () => {
    mockedGetConfig.mockResolvedValue({
      SiteConfig: {
        PlaybackDebugEnabled: false,
      },
      UserConfig: {
        Users: [{ username: 'owner', role: 'owner' }],
      },
    } as Awaited<ReturnType<typeof getConfig>>);

    const response = await POST(
      new Request('https://app.example.com/api/playback-debug', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'session-1',
          eventType: 'native-stall',
        }),
      })
    );

    expect(mockedSavePlaybackDebugLog).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      saved: false,
      skipped: true,
      reason: 'disabled',
    });
  });

  it('saves admin debug events without blocking playback', async () => {
    const response = await POST(
      new Request('https://app.example.com/api/playback-debug', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'session-1',
          eventType: 'native-stall',
          currentTime: 438.2,
        }),
      })
    );

    expect(mockedSavePlaybackDebugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        DB: expect.any(Object),
      }),
      expect.objectContaining({
        sessionId: 'session-1',
        eventType: 'native-stall',
        currentTime: 438.2,
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ saved: true });
  });

  it('returns skipped when storage write fails', async () => {
    mockedSavePlaybackDebugLog.mockRejectedValue(new Error('D1 unavailable'));

    const response = await POST(
      new Request('https://app.example.com/api/playback-debug', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'session-1',
          eventType: 'native-stall',
        }),
      })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      saved: false,
      skipped: true,
      reason: 'write-failed',
    });
  });
});
