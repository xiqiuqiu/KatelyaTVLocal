import { NextResponse } from 'next/server';

import {
  getAvailableApiSitesFromConfig,
  getCacheTimeFromConfig,
  getConfig,
  getSearchDownstreamMaxPageFromConfig,
} from '@/lib/config';
import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';
import { searchFromApi } from '@/lib/downstream';

export const runtime = 'edge';

// 处理OPTIONS预检请求（OrionTV客户端需要）
export async function OPTIONS() {
  return handleOptionsRequest();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const config = await getConfig();
  const cacheTime = getCacheTimeFromConfig(config);

  if (!query) {
    const response = NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
    return addCorsHeaders(response);
  }

  const apiSites = getAvailableApiSitesFromConfig(config);
  const maxSearchPages = getSearchDownstreamMaxPageFromConfig(config);
  const searchPromises = apiSites.map((site) =>
    searchFromApi(site, query, { maxSearchPages })
  );

  try {
    const results = await Promise.all(searchPromises);
    const flattenedResults = results.flat();

    const response = NextResponse.json(
      { results: flattenedResults },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
    return addCorsHeaders(response);
  } catch (error) {
    const response = NextResponse.json({ error: '搜索失败' }, { status: 500 });
    return addCorsHeaders(response);
  }
}
