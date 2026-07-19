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

  it('returns empty tiers when subject_suggest finds nothing and no genre is usable', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const response = await GET(
      new MockRequest(
        'https://example.com/api/douban/recommends?title=UnknownObscureTitle&class='
      ) as unknown as Request
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      message: '无可推荐题材',
      alsoLiked: [],
      genreFallback: [],
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/j/subject_suggest?q='),
      expect.any(Object)
    );
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/subject\/\d+\//),
      expect.any(Object)
    );
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

  it('populates alsoLiked from rexxar recommendations when doubanId is provided', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (String(url).includes('/rexxar/api/v2/movie/1292052/recommendations')) {
        return {
          ok: true,
          json: async () => [
            {
              id: '1292720',
              title: '阿甘正传',
              pic: { normal: 'https://img.example/forrest.webp' },
              rating: { value: 9.5 },
            },
          ],
        };
      }

      return {
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
      };
    });

    const response = await GET(
      new MockRequest(
        'https://example.com/api/douban/recommends?title=%E8%82%96%E7%94%B3%E5%85%8B%E7%9A%84%E6%95%91%E8%B5%8E&class=%E5%89%A7%E6%83%85&type=movie&doubanId=1292052'
      ) as unknown as Request
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      message: '获取成功',
      alsoLiked: [
        {
          id: '1292720',
          title: '阿甘正传',
          poster: 'https://img.example/forrest.webp',
          rate: '9.5',
          year: '',
        },
      ],
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
      'https://m.douban.com/rexxar/api/v2/movie/1292052/recommendations',
      expect.any(Object)
    );
  });

  it('maps 真人秀 onto 综艺 for genreFallback (production play-page repro)', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (String(url).includes('/rexxar/api/v2/tv/38397649/recommendations')) {
        return {
          ok: true,
          json: async () => [
            {
              id: '38433912',
              title: '豆豆农场',
              pic: { normal: 'https://img.example/doudou.webp' },
              rating: { value: 8.4 },
              card_subtitle: '2026 / 韩国 / 真人秀',
            },
          ],
        };
      }

      if (String(url).includes('tag=%E7%BB%BC%E8%89%BA')) {
        return {
          ok: true,
          json: async () => ({
            subjects: [
              {
                id: '200',
                title: '综艺兜底甲',
                cover: 'https://img.example/200.jpg',
                rate: '7.2',
              },
            ],
          }),
        };
      }

      return { ok: true, json: async () => ({ subjects: [] }) };
    });

    const response = await GET(
      new MockRequest(
        'https://example.com/api/douban/recommends?title=%E5%AD%A4%E5%8D%95%E5%8F%88%E7%81%BF%E7%83%82%E7%9A%84%E7%A5%9E%EF%BC%9A%E9%AC%BC%E6%80%AA%E5%8D%81%E5%91%A8%E5%B9%B4%E7%89%B9%E8%BE%91&class=%E7%9C%9F%E4%BA%BA%E7%A7%80&type=tv&doubanId=38397649'
      ) as unknown as Request
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      message: '获取成功',
      alsoLiked: [
        {
          id: '38433912',
          title: '豆豆农场',
          poster: 'https://img.example/doudou.webp',
          rate: '8.4',
          year: '2026',
        },
      ],
      genreFallback: [
        {
          id: '200',
          title: '综艺兜底甲',
          poster: 'https://img.example/200.jpg',
          rate: '7.2',
          year: '',
        },
      ],
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('tag=%E7%BB%BC%E8%89%BA'),
      expect.any(Object)
    );
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('tag=%E7%9C%9F%E4%BA%BA%E7%A7%80'),
      expect.any(Object)
    );
  });

  it('degrades to genreFallback when the rexxar recommendations fetch fails', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (String(url).includes('/rexxar/')) {
        return { ok: false, status: 503, json: async () => ({}) };
      }

      return {
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
      };
    });

    const response = await GET(
      new MockRequest(
        'https://example.com/api/douban/recommends?title=Foo&class=%E5%96%9C%E5%89%A7&type=movie&doubanId=999'
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
  });

  it('resolves subject id via subject_suggest when doubanId is missing', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      const href = String(url);
      if (href.includes('/j/subject_suggest')) {
        return {
          ok: true,
          json: async () => [
            {
              title: '肖申克的救赎',
              type: 'movie',
              year: '1994',
              id: '1292052',
            },
          ],
        };
      }
      if (href.includes('/rexxar/api/v2/movie/1292052/recommendations')) {
        return {
          ok: true,
          json: async () => [
            {
              id: '1292720',
              title: '阿甘正传',
              pic: { normal: 'https://img.example/forrest.webp' },
              rating: { value: 9.5 },
            },
          ],
        };
      }
      return {
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
      };
    });

    const response = await GET(
      new MockRequest(
        'https://example.com/api/douban/recommends?title=%E8%82%96%E7%94%B3%E5%85%8B%E7%9A%84%E6%95%91%E8%B5%8E&class=%E5%89%A7%E6%83%85&type=movie'
      ) as unknown as Request
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      message: '获取成功',
      alsoLiked: [
        {
          id: '1292720',
          title: '阿甘正传',
          poster: 'https://img.example/forrest.webp',
          rate: '9.5',
          year: '',
        },
      ],
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
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://movie.douban.com/j/subject_suggest?q='
      ),
      expect.any(Object)
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://m.douban.com/rexxar/api/v2/movie/1292052/recommendations',
      expect.any(Object)
    );
  });

  it('skips subject_suggest when doubanId is already provided', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (String(url).includes('/rexxar/api/v2/movie/1292052/recommendations')) {
        return {
          ok: true,
          json: async () => [
            {
              id: '1292720',
              title: '阿甘正传',
              pic: { normal: 'https://img.example/forrest.webp' },
              rating: { value: 9.5 },
            },
          ],
        };
      }
      return {
        ok: true,
        json: async () => ({ subjects: [] }),
      };
    });

    await GET(
      new MockRequest(
        'https://example.com/api/douban/recommends?title=%E8%82%96%E7%94%B3%E5%85%8B%E7%9A%84%E6%95%91%E8%B5%8E&type=movie&doubanId=1292052'
      ) as unknown as Request
    );

    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/j/subject_suggest'),
      expect.any(Object)
    );
  });
});
