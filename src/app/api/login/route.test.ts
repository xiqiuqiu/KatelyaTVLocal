import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { verifyTurnstileToken } from '@/lib/turnstile';

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
}

class MockRequest {
  url: string;
  method: string;
  headers: MockHeaders;
  nextUrl: { protocol: string };
  private readonly bodyText: string;

  constructor(
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ) {
    this.url = input;
    this.method = init?.method || 'GET';
    this.headers = new MockHeaders(init?.headers);
    this.nextUrl = { protocol: new URL(input).protocol };
    this.bodyText = init?.body || '';
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.bodyText || 'null');
  }
}

class MockResponse {
  status: number;
  cookies = { set: jest.fn() };

  constructor(private readonly payload: unknown, init?: { status?: number }) {
    this.status = init?.status ?? 200;
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

jest.mock('next/server', () => ({
  NextResponse: {
    json: (payload: unknown, init?: { status?: number }) =>
      new MockResponse(payload, init),
  },
}));

jest.mock('@/lib/auth', () => ({
  getSessionSigningSecret: jest.fn(() => 'secret'),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    upgradeLegacyPasswords: jest.fn(),
    verifyUser: jest.fn(),
  },
}));

jest.mock('@/lib/security/session', () => ({
  createSessionCookieValue: jest.fn(() => Promise.resolve('session-cookie')),
}));

jest.mock('@/lib/turnstile', () => ({
  getClientIp: jest.fn(() => '203.0.113.10'),
  verifyTurnstileToken: jest.fn(),
}));

describe('login route without Turnstile protection', () => {
  const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
  const mockedDb = db as jest.Mocked<typeof db>;
  const mockedVerifyTurnstileToken =
    verifyTurnstileToken as jest.MockedFunction<typeof verifyTurnstileToken>;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
    process.env.LOGIN_TURNSTILE_REQUIRED = 'true';
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ POST } = require('@/app/api/login/route'));
  });

  beforeEach(() => {
    mockedGetConfig.mockResolvedValue({
      UserConfig: {
        AllowRegister: true,
        Users: [{ username: 'alice', role: 'user' }],
      },
    } as unknown as Awaited<ReturnType<typeof getConfig>>);
    mockedDb.verifyUser.mockResolvedValue(true);
    mockedVerifyTurnstileToken.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    delete process.env.LOGIN_TURNSTILE_REQUIRED;
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it('allows login without Turnstile when Turnstile verification would fail', async () => {
    mockedVerifyTurnstileToken.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Turnstile failed',
    });

    const response = await POST(
      new Request('https://app.example.com/api/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.10',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mockedVerifyTurnstileToken).not.toHaveBeenCalled();
    expect(mockedDb.verifyUser).toHaveBeenCalledWith('alice', 'password123');
  });

  it('ignores Turnstile token during normal login', async () => {
    const response = await POST(
      new Request('https://app.example.com/api/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.10',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
          turnstileToken: 'token',
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockedVerifyTurnstileToken).not.toHaveBeenCalled();
    expect(mockedDb.verifyUser).toHaveBeenCalledWith('alice', 'password123');
  });
});
