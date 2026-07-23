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

let GET: (request: Request) => Promise<Response>;

describe('source probe route', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET } = require('@/app/api/source-probe/route'));
  });

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns unavailable for blocked targets without fetching upstream', async () => {
    const response = await GET(
      new MockRequest(
        'https://app.example.com/api/source-probe?url=http%3A%2F%2F127.0.0.1%2Fvideo.mp4',
        { headers: { origin: 'https://app.example.com' } }
      ) as unknown as Request
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        kind: 'unavailable',
        reason: 'Blocked host',
      })
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
