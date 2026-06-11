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

  constructor(private readonly bodyValue: unknown, init?: ResponseInit) {
    this.status = init?.status ?? 200;
    this.headers = new MockHeaders();
    if (init?.headers) {
      new MockHeaders(init.headers as Record<string, string>).forEach(
        (value, key) => this.headers.set(key, value)
      );
    }
  }

  async text(): Promise<string> {
    return typeof this.bodyValue === 'string'
      ? this.bodyValue
      : JSON.stringify(this.bodyValue);
  }

  async json(): Promise<unknown> {
    return typeof this.bodyValue === 'string'
      ? JSON.parse(this.bodyValue)
      : this.bodyValue;
  }

  get ok() {
    return this.status >= 200 && this.status < 300;
  }

  get body() {
    return this.bodyValue;
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

const playlistWithKnownAd = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:10',
  '#EXTINF:10,',
  'content-before.ts',
  '#EXT-X-CUE-OUT:20',
  '#EXTINF:10,',
  'ad-1.ts',
  '#EXTINF:10,',
  'ad-2.ts',
  '#EXT-X-CUE-IN',
  '#EXTINF:10,',
  'content-after.ts',
  '#EXT-X-ENDLIST',
].join('\n');

describe('hls proxy route', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET } = require('@/app/api/hls-proxy/route'));
  });

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(
      new MockResponse(playlistWithKnownAd, {
        status: 200,
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
        },
      }) as unknown as Response
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('filters high-confidence ad segments by default for playable proxy callers', async () => {
    const response = await GET(
      new MockRequest(
        'https://app.example.com/api/hls-proxy?url=https%3A%2F%2Fmedia.example.com%2Fshow%2Findex.m3u8'
      ) as unknown as Request
    );

    const body = await response.text();
    expect(body).not.toContain('ad-1.ts');
    expect(body).not.toContain('#EXT-X-CUE-OUT:20');
    expect(body).toContain(
      'https://app.example.com/api/hls-proxy?url=https%3A%2F%2Fmedia.example.com%2Fshow%2Fcontent-before.ts'
    );
  });

  it('can proxy playlists without removing ad-like segments', async () => {
    const response = await GET(
      new MockRequest(
        'https://app.example.com/api/hls-proxy?filterAds=0&url=https%3A%2F%2Fmedia.example.com%2Fshow%2Findex.m3u8'
      ) as unknown as Request
    );

    const body = await response.text();
    expect(body).toContain(
      'https://app.example.com/api/hls-proxy?filterAds=0&url=https%3A%2F%2Fmedia.example.com%2Fshow%2Fad-1.ts'
    );
    expect(body).toContain('#EXT-X-CUE-OUT:20');
  });

  it('can observe ad signals without returning a playable playlist', async () => {
    const response = await GET(
      new MockRequest(
        'https://app.example.com/api/hls-proxy?observeOnly=1&url=https%3A%2F%2Fmedia.example.com%2Fshow%2Findex.m3u8'
      ) as unknown as Request
    );

    const payload = (await response.json()) as {
      observeOnly: boolean;
      removed: boolean;
      candidates: unknown[];
      summary: { candidateAdBlocks: number; removedBlocks: unknown[] };
    };
    expect(payload.observeOnly).toBe(true);
    expect(payload.removed).toBe(false);
    expect(payload.candidates.length).toBeGreaterThan(0);
    expect(payload.summary.candidateAdBlocks).toBeGreaterThan(0);
    expect(payload.summary.removedBlocks.length).toBeGreaterThan(0);
  });
});
