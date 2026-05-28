import { db } from '@/lib/db';
import { getAuthInfoFromCookie } from '@/lib/auth';

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
let DELETE: (request: Request) => Promise<MockResponse>;

jest.mock('next/server', () => ({
  NextResponse: {
    json: (payload: unknown, init?: { status?: number }) =>
      new MockResponse(payload, init),
  },
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    clearAllPlayRecords: jest.fn(),
    deletePlayRecord: jest.fn(),
    getAllPlayRecords: jest.fn(),
    savePlayRecord: jest.fn(),
  },
}));

describe('playrecords route', () => {
  const mockedDb = db as jest.Mocked<typeof db>;
  const mockedGetAuthInfoFromCookie =
    getAuthInfoFromCookie as jest.MockedFunction<typeof getAuthInfoFromCookie>;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ POST, DELETE } = require('@/app/api/playrecords/route'));
  });

  beforeEach(() => {
    mockedGetAuthInfoFromCookie.mockResolvedValue({ username: 'alice' } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('saves play records with source/id parsed from the storage key', async () => {
    const response = await POST(
      new Request('https://app.example.com/api/playrecords', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          key: 'source-a+video-1',
          record: {
            title: '示例影片',
            source_name: '测试源',
            cover: 'https://example.com/poster.jpg',
            year: '2026',
            index: 1,
            total_episodes: 12,
            play_time: 120,
            total_time: 1800,
            save_time: 123456,
            search_title: '示例影片',
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockedDb.savePlayRecord).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video-1',
      expect.objectContaining({
        title: '示例影片',
        index: 1,
      })
    );
  });

  it('clears all play records via the optimized DbManager path', async () => {
    const response = await DELETE(
      new Request('https://app.example.com/api/playrecords', {
        method: 'DELETE',
      })
    );

    expect(response.status).toBe(200);
    expect(mockedDb.clearAllPlayRecords).toHaveBeenCalledWith('alice');
    expect(mockedDb.getAllPlayRecords).not.toHaveBeenCalled();
    expect(mockedDb.deletePlayRecord).not.toHaveBeenCalled();
  });
});
