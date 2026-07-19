import {
  ProxyRedirectError,
  fetchWithValidatedRedirects,
  validateProxyTargetUrl,
} from './proxy-url-policy';

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
}

describe('validateProxyTargetUrl', () => {
  it('accepts public https URLs', () => {
    const result = validateProxyTargetUrl('https://img.example.com/poster.jpg');
    expect(result).toEqual({
      ok: true,
      url: new URL('https://img.example.com/poster.jpg'),
    });
  });

  it('rejects non-http(s) protocols', () => {
    expect(validateProxyTargetUrl('ftp://files.example.com/a.jpg')).toEqual({
      ok: false,
      reason: 'URL must use http or https',
    });
  });

  it('rejects localhost and private IPv4 hosts', () => {
    expect(validateProxyTargetUrl('http://localhost/poster.jpg')).toEqual({
      ok: false,
      reason: 'Blocked host',
    });
    expect(validateProxyTargetUrl('http://127.0.0.1/poster.jpg')).toEqual({
      ok: false,
      reason: 'Blocked host',
    });
    expect(validateProxyTargetUrl('http://10.0.0.5/poster.jpg')).toEqual({
      ok: false,
      reason: 'Blocked host',
    });
    expect(validateProxyTargetUrl('http://192.168.1.1/poster.jpg')).toEqual({
      ok: false,
      reason: 'Blocked host',
    });
    expect(validateProxyTargetUrl('http://169.254.169.254/')).toEqual({
      ok: false,
      reason: 'Blocked host',
    });
  });

  it('rejects cloud metadata hostnames', () => {
    expect(
      validateProxyTargetUrl('http://metadata.google.internal/computeMetadata/v1/')
    ).toEqual({
      ok: false,
      reason: 'Blocked host',
    });
  });

  it('rejects URLs with embedded credentials', () => {
    expect(
      validateProxyTargetUrl('https://user:pass@img.example.com/poster.jpg')
    ).toEqual({
      ok: false,
      reason: 'URL must not contain credentials',
    });
  });
});

describe('fetchWithValidatedRedirects', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the response when no redirect is needed', async () => {
    const mockResponse = new MockResponse('image-bytes', { status: 200 });
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    const response = await fetchWithValidatedRedirects(
      'https://img.example.com/poster.jpg',
      {}
    );

    expect(response).toBe(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://img.example.com/poster.jpg',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('follows a validated redirect and returns the final response', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new MockResponse(null, {
          status: 302,
          headers: { Location: 'https://cdn.example.com/poster.jpg' },
        })
      )
      .mockResolvedValueOnce(new MockResponse('image-bytes', { status: 200 }));

    const response = await fetchWithValidatedRedirects(
      'https://img.example.com/poster.jpg',
      {}
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('image-bytes');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects redirects to private hosts', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new MockResponse(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1/internal' },
      })
    );

    await expect(
      fetchWithValidatedRedirects('https://img.example.com/poster.jpg', {})
    ).rejects.toThrow(ProxyRedirectError);
  });

  it('rejects redirect chains that exceed the hop limit', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new MockResponse(null, {
          status: 302,
          headers: { Location: 'https://cdn.example.com/a.jpg' },
        })
      )
      .mockResolvedValueOnce(
        new MockResponse(null, {
          status: 302,
          headers: { Location: 'https://cdn.example.com/b.jpg' },
        })
      )
      .mockResolvedValueOnce(
        new MockResponse(null, {
          status: 302,
          headers: { Location: 'https://cdn.example.com/c.jpg' },
        })
      );

    await expect(
      fetchWithValidatedRedirects(
        'https://img.example.com/poster.jpg',
        {},
        { maxRedirects: 2 }
      )
    ).rejects.toThrow('Too many redirects');
  });
});
