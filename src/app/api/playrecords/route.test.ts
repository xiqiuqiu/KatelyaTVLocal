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

let GET: (request: Request) => Promise<MockResponse>;

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

    ({ POST, DELETE, GET } = require('@/app/api/playrecords/route'));

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

  // ─── GET ──────────────────────────────────────────────────────────────────

  it('GET returns all play records for the authenticated user', async () => {
    const records = [{ title: '示例影片' }];
    mockedDb.getAllPlayRecords.mockResolvedValue(records as any);

    const response = await GET(
      new Request('https://app.example.com/api/playrecords', { method: 'GET' })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(records);
    expect(mockedDb.getAllPlayRecords).toHaveBeenCalledWith('alice');
  });

  it('GET returns 401 when the request is unauthenticated', async () => {
    mockedGetAuthInfoFromCookie.mockResolvedValue(null as any);

    const response = await GET(
      new Request('https://app.example.com/api/playrecords', { method: 'GET' })
    );

    expect(response.status).toBe(401);
  });

  // ─── POST — auth & validation ──────────────────────────────────────────────

  it('POST returns 401 when the request is unauthenticated', async () => {
    mockedGetAuthInfoFromCookie.mockResolvedValue(null as any);

    const response = await POST(
      new Request('https://app.example.com/api/playrecords', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'src+1', record: {} }),
      })
    );

    expect(response.status).toBe(401);
    expect(mockedDb.savePlayRecord).not.toHaveBeenCalled();
  });

  it('POST returns 400 when the body is missing the key field', async () => {
    const response = await POST(
      new Request('https://app.example.com/api/playrecords', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          record: { title: '示例', source_name: '源', index: 1 },
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mockedDb.savePlayRecord).not.toHaveBeenCalled();
  });

  it('POST returns 400 when the body is missing the record field', async () => {
    const response = await POST(
      new Request('https://app.example.com/api/playrecords', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'src+1' }),
      })
    );

    expect(response.status).toBe(400);
    expect(mockedDb.savePlayRecord).not.toHaveBeenCalled();
  });

  it('POST returns 400 when the record has no title', async () => {
    const response = await POST(
      new Request('https://app.example.com/api/playrecords', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'src+1',
          record: { title: '', source_name: '源', index: 1 },
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mockedDb.savePlayRecord).not.toHaveBeenCalled();
  });

  it('POST returns 400 when the record index is less than 1', async () => {
    const response = await POST(
      new Request('https://app.example.com/api/playrecords', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'src+1',
          record: { title: '示例', source_name: '源', index: 0 },
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mockedDb.savePlayRecord).not.toHaveBeenCalled();
  });

  it('POST returns 400 when the key has no + separator', async () => {
    const response = await POST(
      new Request('https://app.example.com/api/playrecords', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'invalid-key-without-plus',
          record: { title: '示例影片', source_name: '测试源', index: 1 },
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mockedDb.savePlayRecord).not.toHaveBeenCalled();
  });

  // ─── DELETE — auth, single-record, validation ──────────────────────────────

  it('DELETE returns 401 when the request is unauthenticated', async () => {
    mockedGetAuthInfoFromCookie.mockResolvedValue(null as any);

    const response = await DELETE(
      new Request('https://app.example.com/api/playrecords', {
        method: 'DELETE',
      })
    );

    expect(response.status).toBe(401);
    expect(mockedDb.clearAllPlayRecords).not.toHaveBeenCalled();
    expect(mockedDb.deletePlayRecord).not.toHaveBeenCalled();
  });

  it('DELETE with a valid key removes only that single play record', async () => {
    const response = await DELETE(
      new Request(
        'https://app.example.com/api/playrecords?key=source-a%2Bvideo-1',
        { method: 'DELETE' }
      )
    );

    expect(response.status).toBe(200);
    expect(mockedDb.deletePlayRecord).toHaveBeenCalledWith(
      'alice',
      'source-a',
      'video-1'
    );
    expect(mockedDb.clearAllPlayRecords).not.toHaveBeenCalled();
  });

  it('DELETE returns 400 when the key param has no + separator', async () => {
    const response = await DELETE(
      new Request(
        'https://app.example.com/api/playrecords?key=bad-key-format',
        { method: 'DELETE' }
      )
    );

    expect(response.status).toBe(400);
    expect(mockedDb.deletePlayRecord).not.toHaveBeenCalled();
    expect(mockedDb.clearAllPlayRecords).not.toHaveBeenCalled();
  });
});
