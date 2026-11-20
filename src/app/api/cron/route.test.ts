import { getOptionalRequestContext } from '@cloudflare/next-on-pages';

import { refreshD1Library } from '@/lib/library-refresh';
import { runLowFrequencySourceRankingCheck } from '@/lib/source-ranking/scheduler';

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

jest.mock('@/lib/library-refresh', () => ({ refreshD1Library: jest.fn() }));

jest.mock('@/lib/fetchVideoDetail', () => ({
  fetchVideoDetail: jest.fn(),
}));

jest.mock('@/lib/source-ranking/scheduler', () => ({
  runLowFrequencySourceRankingCheck: jest.fn(),
}));

const originalEnv = process.env;

let GET: (request: Request) => Promise<Response>;
let consoleErrorSpy: jest.SpyInstance;

describe('cron route auth', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET } = require('@/app/api/cron/route'));
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CRON_API_TOKEN;
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
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
    expect(consoleErrorSpy).toHaveBeenCalledWith(
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
    expect(consoleErrorSpy).toHaveBeenCalledWith(
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
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Cron API rejected: unauthorized request'
    );
  });

  it.each([
    ['?mode=ranking', 0],
    ['', 1],
    ['?mode=maintenance', 1],
  ])(
    'runs ranking and applies the maintenance mode for %s',
    async (query, maintenanceCalls) => {
      process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
      const run = jest.fn().mockResolvedValue({ meta: { changes: 7 } });
      const env = {
        CRON_API_TOKEN: 'secret-token',
        SOURCE_RANKING_CRON_ENABLED: 'true',
        DB: {
          prepare: jest.fn((sql: string) => {
            if (sql.includes('DELETE FROM playback_debug_logs'))
              return { bind: () => ({ run }) };
            throw new Error('unexpected SQL');
          }),
        },
      };
      jest
        .mocked(getOptionalRequestContext)
        .mockReturnValueOnce({ env } as unknown as ReturnType<
          typeof getOptionalRequestContext
        >);
      jest
        .mocked(runLowFrequencySourceRankingCheck)
        .mockClear()
        .mockResolvedValueOnce({
          triggered: true,
          status: 'completed',
          sampledRecordCount: 12,
          taskCount: 6,
          probeCount: 6,
          snapshotCount: 6,
          errorCount: 0,
        });
      jest.mocked(refreshD1Library).mockClear();
      const response = await GET(
        new MockRequest(`https://app.example.com/api/cron${query}`, {
          headers: { 'x-cron-token': 'secret-token' },
        }) as unknown as Request
      );

      expect(response.status).toBe(200);
      if (query.includes('maintenance'))
        expect(runLowFrequencySourceRankingCheck).not.toHaveBeenCalled();
      else
        expect(runLowFrequencySourceRankingCheck).toHaveBeenCalledWith({
          env,
          origin: 'https://app.example.com',
          triggerType: 'cron',
        });
      expect(refreshD1Library).toHaveBeenCalledTimes(maintenanceCalls);
      expect(run).toHaveBeenCalledTimes(maintenanceCalls);
      expect(await response.json()).toMatchObject({
        debugLogsDeleted: maintenanceCalls ? 7 : null,
      });
    }
  );

  it('retries library refresh without repeating probes or retention deletes', async () => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
    const prepare = jest.fn();
    jest.mocked(getOptionalRequestContext).mockReturnValueOnce({
      env: { CRON_API_TOKEN: 'secret-token', DB: { prepare } },
    } as unknown as ReturnType<typeof getOptionalRequestContext>);
    jest.mocked(refreshD1Library).mockClear();
    jest.mocked(runLowFrequencySourceRankingCheck).mockClear();
    const response = await GET(
      new MockRequest('https://app.example.com/api/cron?mode=library', {
        headers: { 'x-cron-token': 'secret-token' },
      }) as unknown as Request
    );
    expect(response.status).toBe(200);
    expect(refreshD1Library).toHaveBeenCalledTimes(1);
    expect(runLowFrequencySourceRankingCheck).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
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
