import { getCacheTime } from '@/lib/config';

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
}

class MockRequest {
  url: string;
  method: string;
  headers: MockHeaders;

  constructor(input: string, init?: { method?: string }) {
    this.url = input;
    this.method = init?.method || 'GET';
    this.headers = new MockHeaders();
  }
}

class MockResponse {
  status: number;
  headers: MockHeaders;

  constructor(
    private readonly payload: unknown,
    init?: { status?: number; headers?: Record<string, string> }
  ) {
    this.status = init?.status ?? 200;
    this.headers = new MockHeaders(init?.headers);
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

jest.mock('next/server', () => ({
  NextResponse: {
    json: (
      payload: unknown,
      init?: { status?: number; headers?: Record<string, string> }
    ) => new MockResponse(payload, init),
  },
}));

jest.mock('@/lib/config', () => ({
  getCacheTime: jest.fn(),
}));

describe('douban recommends route', () => {
  const mockedGetCacheTime = getCacheTime as jest.MockedFunction<
    typeof getCacheTime
  >;
  const originalFetch = global.fetch;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET } = require('@/app/api/douban/recommends/route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetCacheTime.mockResolvedValue(7200);
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns genreFallback candidates and empty alsoLiked with cache headers', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        subjects: [
          {
            id: '100',
            title: '同题材甲',
            cover: 'https://img.example/100.jpg',
            rate: '8.1',
          },
        ],
      }),
    });

    const response = await GET(
      new MockRequest(
        'https://example.com/api/douban/recommends?title=%E5%BA%86%E4%BD%99%E5%B9%B4&class=%E5%96%9C%E5%89%A7%2C%E7%88%B1%E6%83%85&type=tv'
      ) as unknown as Request
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      message: '获取成功',
      alsoLiked: [],
      genreFallback: [
        {
          id: '100',
          title: '同题材甲',
          poster: 'https://img.example/100.jpg',
          rate: '8.1',
          year: '',
        },
      ],
    });
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=7200, s-maxage=7200'
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('tag=%E5%96%9C%E5%89%A7'),
      expect.any(Object)
    );
  });

  it('returns empty tiers when no genre tag can be derived', async () => {
    const response = await GET(
      new MockRequest(
        'https://example.com/api/douban/recommends?title=Unknown&class='
      ) as unknown as Request
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      message: '无可推荐题材',
      alsoLiked: [],
      genreFallback: [],
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toContain('max-age=7200');
  });

  it('rejects missing title', async () => {
    const response = await GET(
      new MockRequest(
        'https://example.com/api/douban/recommends?class=%E5%96%9C%E5%89%A7'
      ) as unknown as Request
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '缺少必要参数: title' });
  });
});
