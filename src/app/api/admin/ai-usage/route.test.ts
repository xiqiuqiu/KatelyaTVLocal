import { getAiFindUsageReport } from '@/lib/ai-find/usage-report';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

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

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

jest.mock('@/lib/ai-find/usage-report', () => ({
  getAiFindUsageReport: jest.fn(),
}));

describe('admin AI usage route', () => {
  const mockedGetAuthInfoFromCookie =
    getAuthInfoFromCookie as jest.MockedFunction<typeof getAuthInfoFromCookie>;
  const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
  const mockedGetAiFindUsageReport =
    getAiFindUsageReport as jest.MockedFunction<typeof getAiFindUsageReport>;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET } = require('@/app/api/admin/ai-usage/route'));
  });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
    process.env.USERNAME = 'owner';
    mockedGetAuthInfoFromCookie.mockResolvedValue({
      version: 2,
      username: 'owner',
      role: 'owner',
      issuedAt: 1,
    });
    mockedGetConfig.mockResolvedValue({
      UserConfig: { Users: [], AllowRegister: false },
    } as unknown as Awaited<ReturnType<typeof getConfig>>);
    mockedGetAiFindUsageReport.mockResolvedValue({
      generatedAt: 1,
      days: [],
      today: {
        dayKey: '2026-05-21',
        find: { total: 0, global: 0 },
        group: { total: 0, global: 0 },
      },
      topSubjects: [],
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    delete process.env.USERNAME;
  });

  it('rejects unauthenticated requests', async () => {
    mockedGetAuthInfoFromCookie.mockResolvedValue(null);

    const response = await GET({
      url: 'https://app.example.com/api/admin/ai-usage',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mockedGetAiFindUsageReport).not.toHaveBeenCalled();
  });

  it('allows configured owner to read usage report', async () => {
    const response = await GET({
      url: 'https://app.example.com/api/admin/ai-usage?days=14&limit=5',
    });

    expect(response.status).toBe(200);
    expect(mockedGetAiFindUsageReport).toHaveBeenCalledWith({
      days: 14,
      subjectLimit: 5,
    });
    await expect(response.json()).resolves.toMatchObject({
      today: {
        dayKey: '2026-05-21',
      },
    });
  });

  it('allows admin users from config', async () => {
    mockedGetAuthInfoFromCookie.mockResolvedValue({
      version: 2,
      username: 'alice',
      role: 'admin',
      issuedAt: 1,
    });
    mockedGetConfig.mockResolvedValue({
      UserConfig: {
        AllowRegister: true,
        Users: [{ username: 'alice', role: 'admin' }],
      },
    } as unknown as Awaited<ReturnType<typeof getConfig>>);

    const response = await GET({
      url: 'https://app.example.com/api/admin/ai-usage',
    });

    expect(response.status).toBe(200);
    expect(mockedGetAiFindUsageReport).toHaveBeenCalled();
  });

  it('rejects normal users', async () => {
    mockedGetAuthInfoFromCookie.mockResolvedValue({
      version: 2,
      username: 'bob',
      role: 'user',
      issuedAt: 1,
    });
    mockedGetConfig.mockResolvedValue({
      UserConfig: {
        AllowRegister: true,
        Users: [{ username: 'bob', role: 'user' }],
      },
    } as unknown as Awaited<ReturnType<typeof getConfig>>);

    const response = await GET({
      url: 'https://app.example.com/api/admin/ai-usage',
    });

    expect(response.status).toBe(401);
    expect(mockedGetAiFindUsageReport).not.toHaveBeenCalled();
  });
});
