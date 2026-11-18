import { NextResponse } from 'next/server';

import {
  type TmdbJsonFetcher,
  enrichTmdbHero,
  parseTmdbHeroSeeds,
} from '@/lib/tmdb/hero';

export const runtime = 'edge';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const CACHE_SECONDS = 86400;

function getAuth() {
  return {
    readToken: process.env.TMDB_READ_TOKEN?.trim() || undefined,
    apiKey: process.env.TMDB_API_KEY?.trim() || undefined,
  };
}

/**
 * 首屏聚合接口：一次拿到 5 部片的 backdrop / 简介 / 时长 / 类型。
 *
 * 这不是开放代理：只接受最多 6 条标题，只返回白名单字段。
 */
export async function GET(request: Request) {
  const auth = getAuth();
  if (!auth.readToken && !auth.apiKey) {
    return NextResponse.json({ enabled: false, items: [] }, { status: 200 });
  }

  const url = new URL(request.url);
  const seeds = parseTmdbHeroSeeds(url.searchParams.get('items'));
  if (seeds.length === 0) {
    return NextResponse.json({ enabled: true, items: [] }, { status: 200 });
  }

  const fetchJson: TmdbJsonFetcher = async (path, params) => {
    const target = new URL(`${TMDB_API_BASE}/${path}`);
    target.searchParams.set('language', 'zh-CN');
    for (const [key, value] of Object.entries(params ?? {})) {
      target.searchParams.set(key, value);
    }
    if (!auth.readToken && auth.apiKey) {
      target.searchParams.set('api_key', auth.apiKey);
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (auth.readToken) headers.authorization = `Bearer ${auth.readToken}`;

    const response = await fetch(target.toString(), { headers });
    if (!response.ok) throw new Error(`tmdb ${response.status}`);
    return response.json();
  };

  const items = await enrichTmdbHero(seeds, fetchJson);

  return NextResponse.json(
    { enabled: true, items },
    {
      headers: {
        'cache-control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=604800`,
      },
    }
  );
}
