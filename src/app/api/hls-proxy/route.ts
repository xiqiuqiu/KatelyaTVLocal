import { NextResponse } from 'next/server';

import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';

export const runtime = 'edge';

const PLAYLIST_CONTENT_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
];

function isPlaylistResponse(
  targetUrl: string,
  contentType: string | null
): boolean {
  const normalizedContentType = contentType?.toLowerCase() || '';

  return (
    PLAYLIST_CONTENT_TYPES.some((item) =>
      normalizedContentType.includes(item)
    ) || targetUrl.toLowerCase().includes('.m3u8')
  );
}

function buildAbsoluteUrl(input: string, baseUrl: string): string {
  return new URL(input, baseUrl).toString();
}

function rewritePlaylistAttributes(
  line: string,
  baseUrl: string,
  proxyPrefix: string
): string {
  return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
    const absoluteUrl = buildAbsoluteUrl(uri, baseUrl);
    return `URI="${proxyPrefix}${encodeURIComponent(absoluteUrl)}"`;
  });
}

function rewritePlaylistContent(
  content: string,
  baseUrl: string,
  proxyPrefix: string
): string {
  return content
    .split('\n')
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line) return rawLine;

      if (line.startsWith('#')) {
        return rewritePlaylistAttributes(rawLine, baseUrl, proxyPrefix);
      }

      const absoluteUrl = buildAbsoluteUrl(line, baseUrl);
      return `${proxyPrefix}${encodeURIComponent(absoluteUrl)}`;
    })
    .join('\n');
}

function buildUpstreamHeaders(request: Request, targetUrl: string): Headers {
  const headers = new Headers();
  const rangeHeader = request.headers.get('range');

  if (rangeHeader) {
    headers.set('Range', rangeHeader);
  }

  headers.set(
    'User-Agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
  );
  headers.set('Referer', new URL(targetUrl).origin);
  headers.set('Accept', '*/*');

  return headers;
}

function createPassthroughHeaders(
  upstreamResponse: Response,
  isPlaylist: boolean
): Headers {
  const headers = new Headers();
  const passthroughHeaderNames = [
    'accept-ranges',
    'content-length',
    'content-range',
    'content-type',
    'etag',
    'last-modified',
  ];

  passthroughHeaderNames.forEach((headerName) => {
    if (
      isPlaylist &&
      (headerName === 'content-length' || headerName === 'content-range')
    ) {
      return;
    }

    const value = upstreamResponse.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  });

  if (isPlaylist) {
    headers.set('content-type', 'application/vnd.apple.mpegurl; charset=utf-8');
    headers.set('Cache-Control', 'public, max-age=30, s-maxage=30');
  } else {
    headers.set('Cache-Control', 'public, max-age=600, s-maxage=600');
  }

  return headers;
}

export async function OPTIONS() {
  return handleOptionsRequest();
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const targetUrl = requestUrl.searchParams.get('url');

  if (!targetUrl) {
    const response = NextResponse.json(
      { error: 'Missing HLS URL' },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  try {
    const upstreamResponse = await fetch(targetUrl, {
      headers: buildUpstreamHeaders(request, targetUrl),
      redirect: 'follow',
    });

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      const response = NextResponse.json(
        {
          error: 'Upstream request failed',
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
        },
        { status: upstreamResponse.status }
      );
      return addCorsHeaders(response);
    }

    if (!upstreamResponse.body) {
      const response = NextResponse.json(
        { error: 'Upstream response has no body' },
        { status: 502 }
      );
      return addCorsHeaders(response);
    }

    const proxyPrefix = `${requestUrl.origin}/api/hls-proxy?url=`;
    const isPlaylist = isPlaylistResponse(
      targetUrl,
      upstreamResponse.headers.get('content-type')
    );

    if (isPlaylist) {
      const playlistContent = await upstreamResponse.text();
      const rewrittenPlaylist = rewritePlaylistContent(
        playlistContent,
        targetUrl,
        proxyPrefix
      );

      const response = new Response(rewrittenPlaylist, {
        status: upstreamResponse.status,
        headers: createPassthroughHeaders(upstreamResponse, true),
      });

      return addCorsHeaders(response);
    }

    const response = new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: createPassthroughHeaders(upstreamResponse, false),
    });

    return addCorsHeaders(response);
  } catch (error) {
    const response = NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Proxy request failed',
      },
      { status: 500 }
    );
    return addCorsHeaders(response);
  }
}
