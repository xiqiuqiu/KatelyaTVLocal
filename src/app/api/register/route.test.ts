import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { validateRegistrationSecurity } from '@/lib/registration/security';

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
    checkUserExist: jest.fn(),
    upgradeLegacyPasswords: jest.fn(),
    registerUser: jest.fn(),
    saveAdminConfig: jest.fn(),
  },
}));

jest.mock('@/lib/security/session', () => ({
  createSessionCookieValue: jest.fn(() => Promise.resolve('session-cookie')),
}));

jest.mock('@/lib/registration/security', () => ({
  getRequestIp: jest.fn(() => '203.0.113.10'),
  validateRegistrationSecurity: jest.fn(),
  recordSuccessfulRegistration: jest.fn(),
}));

describe('register route security', () => {
  const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
  const mockedDb = db as jest.Mocked<typeof db>;
  const mockedValidateRegistrationSecurity =
    validateRegistrationSecurity as jest.MockedFunction<
      typeof validateRegistrationSecurity
    >;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ POST } = require('@/app/api/register/route'));
  });

  beforeEach(() => {
    mockedGetConfig.mockResolvedValue({
      UserConfig: {
        AllowRegister: true,
        Users: [],
      },
    } as unknown as Awaited<ReturnType<typeof getConfig>>);
    mockedDb.checkUserExist.mockResolvedValue(false);
    mockedValidateRegistrationSecurity.mockResolvedValue({
      ok: false,
      status: 400,
      error: '请先完成人机验证',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects registration without Turnstile token before creating a user', async () => {
    const response = await POST(
      new Request('https://app.example.com/api/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.10',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
          inviteCode: 'invite-1',
        }),
      })
    );

    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: '请先完成人机验证',
    });
    expect(mockedValidateRegistrationSecurity).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alice',
        password: 'password123',
        ip: '203.0.113.10',
        inviteCode: 'invite-1',
        turnstileToken: undefined,
      })
    );
    expect(mockedDb.registerUser).not.toHaveBeenCalled();
  });
});
