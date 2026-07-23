import { NextResponse } from 'next/server';

import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';
import {
  ProxyRedirectError,
  fetchWithValidatedRedirects,
  validateProxyTargetUrl,
} from '@/lib/proxy-url-policy';

export const runtime = 'edge';

const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

type CloudflareImageFetchInit = RequestInit & {
  cf?: {
    image?: {
      fit?: 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad';
      format?: 'auto';
      height?: number;
      quality?: number;
      width?: number;
    };
  };
};

function parseBoundedInteger(
  value: string | null,
  min: number,
  max: number
): number | undefined {
  if (!value) return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;

  return Math.min(Math.max(parsed, min), max);
}

// 处理OPTIONS预检请求（OrionTV客户端需要）
export async function OPTIONS() {
  return handleOptionsRequest();
}

// OrionTV 兼容接口
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');
  const width = parseBoundedInteger(searchParams.get('w'), 32, 1200);
  const height = parseBoundedInteger(searchParams.get('h'), 32, 1800);
  const quality = parseBoundedInteger(searchParams.get('q'), 40, 90);

  if (!imageUrl) {
    const response = NextResponse.json(
      { error: 'Missing image URL' },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  const urlValidation = validateProxyTargetUrl(imageUrl);
  if (!urlValidation.ok) {
    const response = NextResponse.json(
      { error: urlValidation.reason },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  try {
    const fetchInit: CloudflareImageFetchInit = {
      headers: {
        Referer: 'https://movie.douban.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      },
    };

    if (width || height || quality) {
      fetchInit.cf = {
        image: {
          fit: 'cover',
          format: 'auto',
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
          ...(quality ? { quality } : {}),
        },
      };
    }

    const imageResponse = await fetchWithValidatedRedirects(
      urlValidation.url.href,
      fetchInit
    );

    if (!imageResponse.ok) {
      const response = NextResponse.json(
        { error: imageResponse.statusText },
        { status: imageResponse.status }
      );
      return addCorsHeaders(response);
    }

    const contentType =
      imageResponse.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ||
      '';
    if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
      const response = NextResponse.json(
        { error: 'Unsupported image content type' },
        { status: 415 }
      );
      return addCorsHeaders(response);
    }

    if (!imageResponse.body) {
      const response = NextResponse.json(
        { error: 'Image response has no body' },
        { status: 500 }
      );
      return addCorsHeaders(response);
    }

    // 创建响应头
    const headers = new Headers({
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    });

    // 设置缓存头（可选）
    headers.set('Cache-Control', 'public, max-age=15720000, s-maxage=15720000'); // 缓存半年
    headers.set('CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=15720000');

    // 直接返回图片流
    const response = new Response(imageResponse.body, {
      status: 200,
      headers,
    });
    return addCorsHeaders(response);
  } catch (error) {
    if (error instanceof ProxyRedirectError) {
      const response = NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
      return addCorsHeaders(response);
    }

    const response = NextResponse.json(
      { error: 'Error fetching image' },
      { status: 500 }
    );
    return addCorsHeaders(response);
  }
}
