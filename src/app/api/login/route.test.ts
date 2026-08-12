import { recordAuthAuditEvent } from '@/lib/auth-audit';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { recordLoginResult, validateLoginSecurity } from '@/lib/login/security';

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
}));

jest.mock('@/lib/login/security', () => ({
  validateLoginSecurity: jest.fn(),
  recordLoginResult: jest.fn(),
}));

jest.mock('@/lib/auth-audit', () => ({
  recordAuthAuditEvent: jest.fn(() => Promise.resolve({ recorded: true })),
}));

describe('login route security', () => {
  const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
  const mockedDb = db as jest.Mocked<typeof db>;
  const mockedValidateLoginSecurity =
    validateLoginSecurity as jest.MockedFunction<typeof validateLoginSecurity>;
  const mockedRecordLoginResult = recordLoginResult as jest.MockedFunction<
    typeof recordLoginResult
  >;
  const mockedRecordAuthAuditEvent =
    recordAuthAuditEvent as jest.MockedFunction<typeof recordAuthAuditEvent>;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ POST } = require('@/app/api/login/route'));
  });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
    mockedGetConfig.mockResolvedValue({
      UserConfig: {
        AllowRegister: true,
        Users: [{ username: 'alice', role: 'user' }],
      },
    } as unknown as Awaited<ReturnType<typeof getConfig>>);
    mockedDb.verifyUser.mockResolvedValue(true);
    mockedValidateLoginSecurity.mockResolvedValue({
      ok: true,
      status: 200,
      attemptKey: 'attempt-key',
    });
    mockedRecordLoginResult.mockResolvedValue();
    mockedRecordAuthAuditEvent.mockResolvedValue({ recorded: true });
  });

  afterEach(() => {
    delete process.env.USERNAME;
    delete process.env.PASSWORD;
    jest.clearAllMocks();
  });

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    delete process.env.PASSWORD;
  });

  it('returns a required Turnstile failure before password verification', async () => {
    mockedValidateLoginSecurity.mockResolvedValue({
      ok: false,
      status: 400,
      error: '请先完成人机验证',
      auditReason: 'turnstile_failure',
    });

    const response = await POST(
      new Request('https://app.example.com/api/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.10',
          'user-agent': 'Mozilla/5.0 TestBrowser',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '请先完成人机验证',
    });
    expect(mockedValidateLoginSecurity).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alice',
        turnstileToken: undefined,
        ip: '203.0.113.10',
      })
    );
    expect(mockedDb.verifyUser).not.toHaveBeenCalled();
    expect(mockedRecordAuthAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'login_failure',
        username: 'alice',
        failureReason: 'turnstile_failure',
        ip: '203.0.113.10',
        userAgent: 'Mozilla/5.0 TestBrowser',
      })
    );
  });

  it('records rate-limited rejects before password verification', async () => {
    mockedValidateLoginSecurity.mockResolvedValue({
      ok: false,
      status: 429,
      error: '登录尝试过于频繁，请稍后再试',
      auditReason: 'rate_limited',
    });

    const response = await POST(
      new Request('https://app.example.com/api/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      })
    );

    expect(response.status).toBe(429);
    expect(mockedDb.verifyUser).not.toHaveBeenCalled();
    expect(mockedRecordAuthAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'login_failure',
        username: 'alice',
        failureReason: 'rate_limited',
      })
    );
  });

  it('records a successful D1 login before issuing its session', async () => {
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
    expect(mockedValidateLoginSecurity).toHaveBeenCalledWith(
      expect.objectContaining({ turnstileToken: 'token' })
    );
    expect(mockedDb.verifyUser).toHaveBeenCalledWith('alice', 'password123');
    expect(mockedRecordLoginResult).toHaveBeenCalledWith({
      attemptKey: 'attempt-key',
      success: true,
    });
    expect(mockedRecordAuthAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'login_success',
        username: 'alice',
        ip: '203.0.113.10',
      })
    );
  });

  it('does not issue a session when successful login recording fails', async () => {
    process.env.USERNAME = 'alice';
    process.env.PASSWORD = 'password123';
    mockedRecordLoginResult.mockRejectedValue(
      new Error('login security storage unavailable')
    );
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const response = await POST(
      new Request('https://app.example.com/api/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: '服务器错误' });
    consoleError.mockRestore();
  });

  it('still issues a session when auth audit write fails', async () => {
    mockedRecordAuthAuditEvent.mockRejectedValue(new Error('audit unavailable'));
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const response = await POST(
      new Request('https://app.example.com/api/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    consoleError.mockRestore();
  });

  it('records failed credentials without revealing whether the username exists', async () => {
    mockedDb.verifyUser.mockResolvedValue(false);

    const response = await POST(
      new Request('https://app.example.com/api/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'unknown',
          password: 'password123',
        }),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: '用户名或密码错误',
    });
    expect(mockedRecordLoginResult).toHaveBeenCalledWith({
      attemptKey: 'attempt-key',
      success: false,
    });
    expect(mockedRecordAuthAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'login_failure',
        username: 'unknown',
        failureReason: 'invalid_credentials',
      })
    );
  });

  it('records missing username as invalid_username without credential checks', async () => {
    const response = await POST(
      new Request('https://app.example.com/api/login', {
        method: 'POST',
        body: JSON.stringify({
          password: 'password123',
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mockedDb.verifyUser).not.toHaveBeenCalled();
    expect(mockedRecordAuthAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'login_failure',
        failureReason: 'invalid_username',
      })
    );
  });

  it('uses the synthetic owner username for localstorage pre-auth', async () => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
    process.env.PASSWORD = 'password123';

    const response = await POST(
      new Request('https://app.example.com/api/login', {
        method: 'POST',
        body: JSON.stringify({
          password: 'password123',
          turnstileToken: 'token',
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockedValidateLoginSecurity).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'owner',
        turnstileToken: 'token',
        ip: '203.0.113.10',
      })
    );
    expect(mockedRecordLoginResult).toHaveBeenCalledWith({
      attemptKey: 'attempt-key',
      success: true,
    });
    expect(mockedRecordAuthAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'login_success',
        username: 'owner',
      })
    );
  });
});
