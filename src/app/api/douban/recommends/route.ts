import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { deriveDoubanGenreTag } from '@/lib/douban-genre-tag';
import type { DoubanItem } from '@/lib/types';

export const runtime = 'edge';

export type DoubanRecommendsResult = {
  code: number;
  message: string;
  alsoLiked: DoubanItem[];
  genreFallback: DoubanItem[];
};

interface DoubanApiResponse {
  subjects: Array<{
    id: string;
    title: string;
    cover: string;
    rate: string;
  }>;
}

async function fetchDoubanSubjects(
  type: 'movie' | 'tv',
  tag: string,
  pageSize: number
): Promise<DoubanItem[]> {
  const target = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=${pageSize}&page_start=0`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(target, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Referer: 'https://movie.douban.com/',
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const doubanData = (await response.json()) as DoubanApiResponse;
    return (doubanData.subjects || []).map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.cover,
      rate: item.rate,
      year: '',
    }));
  } finally {
    clearTimeout(timeoutId);
  }
}

function emptyResult(message: string): DoubanRecommendsResult {
  return {
    code: 200,
    message,
    alsoLiked: [],
    genreFallback: [],
  };
}

async function cachedJson(body: DoubanRecommendsResult) {
  const cacheTime = await getCacheTime();
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
      'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
    },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title')?.trim() || '';
  const vodClass = searchParams.get('class');
  const typeParam = searchParams.get('type') || 'movie';
  const pageSize = parseInt(searchParams.get('pageSize') || '16', 10);

  if (!title) {
    return NextResponse.json(
      { error: '缺少必要参数: title' },
      { status: 400 }
    );
  }

  if (!['tv', 'movie'].includes(typeParam)) {
    return NextResponse.json(
      { error: 'type 参数必须是 tv 或 movie' },
      { status: 400 }
    );
  }

  if (pageSize < 1 || pageSize > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400 }
    );
  }

  const genreTag = deriveDoubanGenreTag(vodClass);
  if (!genreTag) {
    return cachedJson(emptyResult('无可推荐题材'));
  }

  try {
    const genreFallback = await fetchDoubanSubjects(
      typeParam as 'movie' | 'tv',
      genreTag,
      pageSize
    );

    return cachedJson({
      code: 200,
      message: '获取成功',
      // T1a: also-liked scrape lands in a later ticket; keep the labeled tier empty.
      alsoLiked: [],
      genreFallback,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '获取豆瓣推荐失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
