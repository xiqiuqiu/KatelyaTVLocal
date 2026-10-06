/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { isTvBrowser, TV_MODE_PREFERENCE_COOKIE } from '@/lib/tv-interaction';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  if (!process.env.PASSWORD) {
    const warningUrl = new URL('/warning', request.url);
    return NextResponse.redirect(warningUrl);
  }

  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  if (storageType === 'localstorage') {
    return handleTvMode(request);
  }

  if (!authInfo.username) {
    return handleAuthFailure(request, pathname);
  }

  return handleTvMode(request);
}

function handleTvMode(request: NextRequest): NextResponse {
  const { pathname, searchParams } = request.nextUrl;
  if (
    !['/', '/search', '/history', '/play'].includes(pathname) ||
    (pathname === '/' && searchParams.get('tab') === 'favorites') ||
    searchParams.has('tv') ||
    request.cookies.get(TV_MODE_PREFERENCE_COOKIE)?.value === 'web' ||
    !isTvBrowser(request.headers.get('user-agent') || '')
  )
    return NextResponse.next();

  const target = request.nextUrl.clone();
  target.searchParams.set('tv', '1');
  const response = NextResponse.redirect(target);
  // UA/cookie-dependent redirects must not leak into shared CDN caches.
  response.headers.set('cache-control', 'private, no-store');
  return response;
}

function handleAuthFailure(
  request: NextRequest,
  pathname: string
): NextResponse {
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set('redirect', fullUrl);
  return NextResponse.redirect(loginUrl);
}

function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
    '/tv-test',
    '/tv-remote-debug',
    '/api/tv-remote-debug',
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|warning|api/login|api/register|api/logout|api/cron|api/server-config|api/search|api/detail|api/image-proxy|api/tvbox).*)',
  ],
};
