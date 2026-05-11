import { NextResponse } from 'next/server';

import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';
import { probeSourcePlaybackWithCache } from '@/lib/source-preference';

export const runtime = 'edge';

export async function OPTIONS() {
  return handleOptionsRequest();
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const targetUrl = requestUrl.searchParams.get('url');

  if (!targetUrl) {
    const response = NextResponse.json(
      { error: 'Missing source URL' },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  const origin = request.headers.get('origin') || requestUrl.origin;
  const result = await probeSourcePlaybackWithCache(targetUrl, origin);
  const response = NextResponse.json(result, { status: 200 });
  return addCorsHeaders(response);
}
