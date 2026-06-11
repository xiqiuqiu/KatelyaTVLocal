import { NextResponse } from 'next/server';

import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';
import {
  analyzeM3U8AdCandidates,
  applyM3U8AdFiltering,
  formatM3U8AdFilterDebugMessage,
  observeM3U8AdSignals,
} from '@/lib/hls-ad-filter';
import type { HlsMediaSegmentMode } from '@/lib/hls-proxy-rewrite';
import { rewritePlaylistContent } from '@/lib/hls-proxy-rewrite';

export const runtime = 'edge';

const PLAYLIST_CONTENT_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
];

const proxyAdObserveDebugLogKeys = new Set<string>();

function buildProxyPrefix(
  requestUrl: URL,
  mediaSegmentMode: HlsMediaSegmentMode,
  shouldFilterAds: boolean
): string {
  const params = new URLSearchParams();

  if (mediaSegmentMode === 'direct') {
    params.set('segmentMode', 'direct');
  }

  if (!shouldFilterAds) {
    params.set('filterAds', '0');
  }

  params.set('url', '');

  return `${requestUrl.origin}/api/hls-proxy?${params.toString()}`;
}

function logProxyAdObserveDebug(
  targetUrl: string,
  playlistContent: string
): void {
  const debugInfo = observeM3U8AdSignals(playlistContent, targetUrl);

  if (!debugInfo.shouldLog) {
    return;
  }

  const logKey = JSON.stringify({
    targetUrl,
    removedLineCount: debugInfo.removedLineCount,
    candidateAdBlocks: debugInfo.summary.candidateAdBlocks,
    cueOutCount: debugInfo.summary.cueOutCount,
    cueInCount: debugInfo.summary.cueInCount,
    scte35Count: debugInfo.summary.scte35Count,
    daterangeCount: debugInfo.summary.daterangeCount,
    removedBlocks: debugInfo.summary.removedBlocks.length,
  });

  if (proxyAdObserveDebugLogKeys.has(logKey)) {
    return;
  }

  proxyAdObserveDebugLogKeys.add(logKey);

  const message = `[去广告][代理观测] ${formatM3U8AdFilterDebugMessage(
    debugInfo
  )}，仅记录，未移除分片`;

  console.log(message, {
    targetUrl,
    wouldRemoveLineCount: debugInfo.removedLineCount,
    removed: false,
    removedBlocks: debugInfo.summary.removedBlocks,
    summary: debugInfo.summary,
  });
}

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
  const mediaSegmentMode: HlsMediaSegmentMode =
    requestUrl.searchParams.get('segmentMode') === 'direct'
      ? 'direct'
      : 'proxy';
  const shouldFilterAds = requestUrl.searchParams.get('filterAds') !== '0';
  const observeOnly = requestUrl.searchParams.get('observeOnly') === '1';

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

    const proxyPrefix = buildProxyPrefix(
      requestUrl,
      mediaSegmentMode,
      shouldFilterAds
    );
    const isPlaylist = isPlaylistResponse(
      targetUrl,
      upstreamResponse.headers.get('content-type')
    );

    if (isPlaylist) {
      const playlistContent = await upstreamResponse.text();

      if (observeOnly) {
        const adAnalysis = analyzeM3U8AdCandidates(playlistContent, targetUrl);
        const response = NextResponse.json(
          {
            observeOnly: true,
            removed: false,
            targetUrl,
            candidates: adAnalysis.candidates,
            summary: adAnalysis.summary,
            removedLineCount: adAnalysis.removedLineCount,
            wouldRemoveLineCount: adAnalysis.removedLineCount,
          },
          {
            headers: {
              'Cache-Control': 'no-store',
            },
          }
        );
        return addCorsHeaders(response);
      }

      if (shouldFilterAds) {
        logProxyAdObserveDebug(targetUrl, playlistContent);
      }

      const adAnalysis = shouldFilterAds
        ? analyzeM3U8AdCandidates(playlistContent, targetUrl)
        : null;
      const playablePlaylistContent =
        shouldFilterAds && adAnalysis
          ? applyM3U8AdFiltering(playlistContent, adAnalysis)
          : playlistContent;
      const rewrittenPlaylist = rewritePlaylistContent(
        playablePlaylistContent,
        targetUrl,
        proxyPrefix,
        { mediaSegmentMode }
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
