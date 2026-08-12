import { isAdminRequest } from '@/lib/admin-auth';
import { listAuthAuditEvents } from '@/lib/auth-audit';

class MockResponse {
  status: number;
  headers: Record<string, string>;

  constructor(
    private readonly payload: unknown,
    init?: { status?: number; headers?: Record<string, string> }
  ) {
    this.status = init?.status ?? 200;
    this.headers = init?.headers || {};
  }

  async json(): Promise<unknown> {
    return this.payload;
  }
}

let GET: (request: { url: string }) => Promise<MockResponse>;

jest.mock('next/server', () => ({
  NextResponse: {
    json: (
      payload: unknown,
      init?: { status?: number; headers?: Record<string, string> }
    ) => new MockResponse(payload, init),
  },
}));

jest.mock('@/lib/admin-auth', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/lib/auth-audit', () => ({
  listAuthAuditEvents: jest.fn(),
}));

jest.mock(
  '@cloudflare/next-on-pages',
  () => ({
    getOptionalRequestContext: jest.fn(() => ({
      env: { DB: { prepare: jest.fn() } },
    })),
  }),
  { virtual: true }
);

describe('admin auth audit route', () => {
  const mockedIsAdminRequest = isAdminRequest as jest.MockedFunction<
    typeof isAdminRequest
  >;
  const mockedListAuthAuditEvents = listAuthAuditEvents as jest.MockedFunction<
    typeof listAuthAuditEvents
  >;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET } = require('@/app/api/admin/auth-audit/route'));
  });

  beforeEach(() => {
    mockedIsAdminRequest.mockResolvedValue(true);
    mockedListAuthAuditEvents.mockResolvedValue({
      available: true,
      events: [
        {
          id: 1,
          eventType: 'login_success',
          username: 'alice',
          failureReason: null,
          ipRedacted: '203.0.113.0/24',
          deviceClass: 'desktop',
          createdAt: 1_700_000_000_000,
        },
      ],
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects non-admin users', async () => {
    mockedIsAdminRequest.mockResolvedValue(false);

    const response = await GET({
      url: 'https://app.example.com/api/admin/auth-audit',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mockedListAuthAuditEvents).not.toHaveBeenCalled();
  });

  it('passes filters through to the auth audit module', async () => {
    const response = await GET({
      url: 'https://app.example.com/api/admin/auth-audit?username=alice&eventType=login_failure&from=100&to=200&limit=25',
    });

    expect(response.status).toBe(200);
    expect(mockedListAuthAuditEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alice',
        eventType: 'login_failure',
        from: 100,
        to: 200,
        limit: 25,
        env: expect.objectContaining({
          DB: expect.any(Object),
        }),
      })
    );
    await expect(response.json()).resolves.toEqual({
      available: true,
      events: [
        expect.objectContaining({
          id: 1,
          eventType: 'login_success',
          username: 'alice',
        }),
      ],
    });
  });

  it('reports auth audit unavailable without inventing empty history', async () => {
    mockedListAuthAuditEvents.mockResolvedValue({
      available: false,
      reason: 'd1_unavailable',
    });

    const response = await GET({
      url: 'https://app.example.com/api/admin/auth-audit',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      available: false,
      reason: 'd1_unavailable',
      error: '认证审计不可用（需要 D1）',
    });
  });
});
