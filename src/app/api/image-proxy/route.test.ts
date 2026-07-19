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
  body: unknown;

  constructor(bodyValue: unknown, init?: ResponseInit) {
    this.body = bodyValue;
    this.status = init?.status ?? 200;
    this.headers = new MockHeaders();
    if (init?.headers) {
      new MockHeaders(init.headers as Record<string, string>).forEach(
        (value, key) => this.headers.set(key, value)
      );
    }
  }

  async text(): Promise<string> {
    return typeof this.body === 'string'
      ? this.body
      : JSON.stringify(this.body);
  }

  async json(): Promise<unknown> {
    return typeof this.body === 'string' ? JSON.parse(this.body) : this.body;
  }

  get ok() {
    return this.status >= 200 && this.status < 300;
  }
}

(global as unknown as { Headers?: typeof MockHeaders }).Headers = MockHeaders;
(global as unknown as { Request?: typeof MockRequest }).Request = MockRequest;
(global as unknown as { Response?: typeof MockResponse }).Response =
  MockResponse;

jest.mock('next/server', () => ({
  NextResponse: {
    json: (payload: unknown, init?: ResponseInit) =>
      new MockResponse(payload, init),
  },
}));

let GET: (request: Request) => Promise<Response>;

describe('image proxy route', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET } = require('@/app/api/image-proxy/route'));
  });

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(
      new MockResponse('image-bytes', {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
        },
      }) as unknown as Response
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 400 when url is missing', async () => {
    const response = await GET(
      new MockRequest('https://app.example.com/api/image-proxy') as unknown as Request
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing image URL',
    });
  });

  it('returns 400 for blocked private hosts', async () => {
    const response = await GET(
      new MockRequest(
        'https://app.example.com/api/image-proxy?url=http%3A%2F%2F127.0.0.1%2Fposter.jpg'
      ) as unknown as Request
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Blocked host',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('proxies a valid public image URL', async () => {
    const response = await GET(
      new MockRequest(
        'https://app.example.com/api/image-proxy?url=https%3A%2F%2Fimg.example.com%2Fposter.jpg'
      ) as unknown as Request
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('image-bytes');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://img.example.com/poster.jpg',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('rejects redirects to private hosts', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new MockResponse(null, {
        status: 302,
        headers: {
          Location: 'http://127.0.0.1/internal',
        },
      }) as unknown as Response
    );

    const response = await GET(
      new MockRequest(
        'https://app.example.com/api/image-proxy?url=https%3A%2F%2Fimg.example.com%2Fposter.jpg'
      ) as unknown as Request
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Blocked redirect target: Blocked host',
    });
  });
});
