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

function buildUpstreamHeaders(
  targetUrl: string,
  rangeHeader?: string | null
): Headers {
  const headers = new Headers();

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

function isCorsAccessible(response: Response, origin: string): boolean {
  const allowOrigin = response.headers.get('access-control-allow-origin');
  if (!allowOrigin) return false;
  if (allowOrigin === '*') return true;

  return allowOrigin
    .split(',')
    .map((value) => value.trim())
    .includes(origin);
}

function getFirstPlaylistTarget(
  content: string,
  baseUrl: string
): string | null {
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    return buildAbsoluteUrl(line, baseUrl);
  }

  return null;
}

async function probeNestedTarget(
  targetUrl: string,
  origin: string
): Promise<{ ok: boolean; corsAccessible: boolean; status: number }> {
  const isNestedPlaylist = targetUrl.toLowerCase().includes('.m3u8');
  const response = await fetch(targetUrl, {
    headers: buildUpstreamHeaders(
      targetUrl,
      isNestedPlaylist ? null : 'bytes=0-1'
    ),
    redirect: 'follow',
  });

  return {
    ok: response.ok || response.status === 206,
    corsAccessible: isCorsAccessible(response, origin),
    status: response.status,
  };
}

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

  try {
    const origin = request.headers.get('origin') || requestUrl.origin;
    const upstreamResponse = await fetch(targetUrl, {
      headers: buildUpstreamHeaders(targetUrl),
      redirect: 'follow',
    });

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      const response = NextResponse.json(
        {
          kind: 'unavailable',
          reason: `上游响应失败: ${upstreamResponse.status}`,
          domain: new URL(targetUrl).hostname.toLowerCase(),
          upstreamStatus: upstreamResponse.status,
        },
        { status: 200 }
      );
      return addCorsHeaders(response);
    }

    const domain = new URL(targetUrl).hostname.toLowerCase();
    const playlistResponse = isPlaylistResponse(
      targetUrl,
      upstreamResponse.headers.get('content-type')
    );
    const playlistCorsAccessible = isCorsAccessible(upstreamResponse, origin);

    if (!playlistResponse) {
      const response = NextResponse.json(
        {
          kind: playlistCorsAccessible ? 'direct' : 'proxy',
          reason: playlistCorsAccessible
            ? '媒体地址可直接跨域访问'
            : '媒体地址可拉取，但浏览器跨域受限',
          domain,
          upstreamStatus: upstreamResponse.status,
        },
        { status: 200 }
      );
      return addCorsHeaders(response);
    }

    const playlistContent = await upstreamResponse.text();
    const nextTarget = getFirstPlaylistTarget(playlistContent, targetUrl);

    if (!nextTarget) {
      const response = NextResponse.json(
        {
          kind: playlistCorsAccessible ? 'direct' : 'proxy',
          reason: playlistCorsAccessible
            ? '播放列表可直接访问'
            : '播放列表缺少跨域头，需走代理',
          domain,
          upstreamStatus: upstreamResponse.status,
        },
        { status: 200 }
      );
      return addCorsHeaders(response);
    }

    const nestedProbe = await probeNestedTarget(nextTarget, origin);

    if (!nestedProbe.ok) {
      const response = NextResponse.json(
        {
          kind: 'unavailable',
          reason: `首个媒体片段不可达: ${nestedProbe.status}`,
          domain,
          upstreamStatus: nestedProbe.status,
        },
        { status: 200 }
      );
      return addCorsHeaders(response);
    }

    const canDirect = playlistCorsAccessible && nestedProbe.corsAccessible;
    const response = NextResponse.json(
      {
        kind: canDirect ? 'direct' : 'proxy',
        reason: canDirect
          ? '播放列表和首个媒体片段都支持浏览器直连'
          : '上游可用，但至少一层缺少浏览器跨域头，建议走代理',
        domain,
        upstreamStatus: upstreamResponse.status,
      },
      { status: 200 }
    );

    return addCorsHeaders(response);
  } catch (error) {
    const response = NextResponse.json(
      {
        kind: 'unavailable',
        reason: error instanceof Error ? error.message : '探测失败',
      },
      { status: 200 }
    );

    return addCorsHeaders(response);
  }
}
