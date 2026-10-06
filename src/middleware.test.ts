import type { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

import { middleware } from '@/middleware';

jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('next/server', () => ({
  NextResponse: {
    next: () => ({ headers: new Map([['x-middleware-next', '1']]) }),
    redirect: (url: URL) => ({
      headers: new Map([['location', url.toString()]]),
    }),
  },
}));

describe('TV automatic entry middleware', () => {
  const oldPassword = process.env.PASSWORD;
  const oldStorage = process.env.NEXT_PUBLIC_STORAGE_TYPE;
  const auth = jest.mocked(getAuthInfoFromCookie);
  const ua = 'Mozilla/5.0 (Linux; Android 13; 8R710_Q7FP) Chrome/101.0';
  const request = (path: string, agent = ua, preference?: string) => {
    const url = new URL(path, 'https://tv.test');
    return {
      url: url.toString(),
      nextUrl: {
        pathname: url.pathname,
        search: url.search,
        searchParams: url.searchParams,
        clone: () => new URL(url),
      },
      headers: { get: () => agent },
      cookies: { get: () => (preference ? { value: preference } : undefined) },
    } as unknown as NextRequest;
  };

  beforeEach(() => {
    process.env.PASSWORD = 'test-only';
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
    auth.mockResolvedValue({ username: 'tester' } as Awaited<
      ReturnType<typeof getAuthInfoFromCookie>
    >);
  });
  afterAll(() => {
    if (oldPassword === undefined) delete process.env.PASSWORD;
    else process.env.PASSWORD = oldPassword;
    if (oldStorage === undefined) delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    else process.env.NEXT_PUBLIC_STORAGE_TYPE = oldStorage;
  });

  it.each(['/', '/search?q=test', '/history', '/play?source=a&id=1'])(
    'automatically enters TV mode for %s',
    async (path) => {
      const response = await middleware(request(path));
      const target = new URL(
        response.headers.get('location') || 'https://missing.test'
      );
      expect(target.searchParams.get('tv')).toBe('1');
      expect(target.pathname + target.search.replace(/[?&]tv=1$/, '')).toBe(
        path
      );
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  );
  it.each([
    '/search?tv=0',
    '/play?tv=1',
    '/?tab=favorites',
    '/admin',
    '/api/playrecords',
    '/tv-test',
  ])('leaves explicit modes and unsupported routes alone: %s', async (path) => {
    expect(
      (await middleware(request(path))).headers.get('location')
    ).toBeUndefined();
  });
  it('respects a saved Web preference and does not guess from Android alone', async () => {
    expect(
      (await middleware(request('/search', ua, 'web'))).headers.get('location')
    ).toBeUndefined();
    expect(
      (
        await middleware(
          request('/search', 'Mozilla/5.0 (Linux; Android 13) Chrome/101.0')
        )
      ).headers.get('location')
    ).toBeUndefined();
  });
  it('keeps authentication ahead of device detection', async () => {
    auth.mockResolvedValue(null);
    const response = await middleware(request('/play?source=a&id=1'));
    const login = new URL(
      response.headers.get('location') || 'https://missing.test'
    );
    expect(login.pathname).toBe('/login');
    expect(login.searchParams.get('redirect')).toBe('/play?source=a&id=1');
  });
});
