import { NextResponse } from 'next/server';

import { isAllowedTmdbPath, sanitizeTmdbParams } from '@/lib/tmdb/endpoints';

export const runtime = 'edge';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const DEFAULT_LANGUAGE = 'zh-CN';

/** 列表类端点缓存 1 小时，详情类 6 小时 —— 榜单变化没那么快。 */
const LIST_CACHE_SECONDS = 3600;
const DETAIL_CACHE_SECONDS = 21600;

interface TmdbAuth {
  apiKey?: string;
  readToken?: string;
}

function getAuth(): TmdbAuth {
  return {
    readToken: process.env.TMDB_READ_TOKEN?.trim() || undefined,
    apiKey: process.env.TMDB_API_KEY?.trim() || undefined,
  };
}

function buildUpstreamUrl(
  path: string,
  params: URLSearchParams,
  auth: TmdbAuth
): string {
  const upstream = new URL(`${TMDB_API_BASE}/${path}`);
  const merged = new URLSearchParams(params);
  if (!merged.has('language')) merged.set('language', DEFAULT_LANGUAGE);
  merged.forEach((value, key) => upstream.searchParams.set(key, value));
  // v3 key 只能放在查询串里；v4 走 Authorization 头，不落 URL
  if (!auth.readToken && auth.apiKey) {
    upstream.searchParams.set('api_key', auth.apiKey);
  }
  return upstream.toString();
}

function cacheSecondsFor(path: string): number {
  return /^(search|discover|trending|genre)\//.test(path)
    ? LIST_CACHE_SECONDS
    : DETAIL_CACHE_SECONDS;
}

async function handle(request: Request, path: string) {
  const auth = getAuth();
  if (!auth.readToken && !auth.apiKey) {
    return NextResponse.json(
      { error: 'TMDB 未配置：需要 TMDB_API_KEY 或 TMDB_READ_TOKEN' },
      { status: 503 }
    );
  }

  if (!isAllowedTmdbPath(path)) {
    return NextResponse.json({ error: '不支持的 TMDB 端点' }, { status: 400 });
  }

  const url = new URL(request.url);
  const params = sanitizeTmdbParams(url.searchParams);
  const upstreamUrl = buildUpstreamUrl(path, params, auth);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (auth.readToken) headers.authorization = `Bearer ${auth.readToken}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { headers });
  } catch {
    return NextResponse.json({ error: 'TMDB 请求失败' }, { status: 502 });
  }

  if (!upstream.ok) {
    const status = upstream.status === 404 ? 404 : 502;
    return NextResponse.json(
      { error: 'TMDB 返回异常', status: upstream.status },
      { status }
    );
  }

  const body = await upstream.text();
  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, s-maxage=${cacheSecondsFor(
        path
      )}, stale-while-revalidate=86400`,
    },
  });
}

export async function GET(
  request: Request,
  context: { params: { path?: string[] } }
) {
  const path = (context.params.path ?? []).join('/');
  return handle(request, path);
}
