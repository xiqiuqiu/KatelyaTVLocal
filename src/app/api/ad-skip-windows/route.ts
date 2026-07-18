import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';
import { getStorage } from '@/lib/db';
import type { EpisodeAdSkipConfig, PersistedAdSkipWindow } from '@/lib/types';

export const runtime = 'edge';

export async function OPTIONS() {
  return handleOptionsRequest();
}

function isValidWindow(window: PersistedAdSkipWindow): boolean {
  return (
    typeof window.startTimeSeconds === 'number' &&
    typeof window.endTimeSeconds === 'number' &&
    Number.isFinite(window.startTimeSeconds) &&
    Number.isFinite(window.endTimeSeconds) &&
    window.startTimeSeconds < window.endTimeSeconds &&
    typeof window.trustScore === 'number' &&
    typeof window.confirmCount === 'number' &&
    typeof window.undoCount === 'number' &&
    typeof window.updated_time === 'number'
  );
}

function isValidConfig(config: EpisodeAdSkipConfig): boolean {
  return (
    typeof config.source === 'string' &&
    config.source.length > 0 &&
    typeof config.id === 'string' &&
    config.id.length > 0 &&
    typeof config.episodeIndex === 'number' &&
    Number.isInteger(config.episodeIndex) &&
    config.episodeIndex >= 0 &&
    typeof config.updated_time === 'number' &&
    Array.isArray(config.windows) &&
    config.windows.every(isValidWindow)
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, key, config } = body;

    if (!action) {
      const response = NextResponse.json(
        { error: '缺少操作类型' },
        { status: 400 }
      );
      return addCorsHeaders(response);
    }

    const authInfo = await getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      const response = NextResponse.json(
        { error: '用户未登录' },
        { status: 401 }
      );
      return addCorsHeaders(response);
    }

    const storage = getStorage();

    switch (action) {
      case 'get': {
        if (!key) {
          const response = NextResponse.json(
            { error: '缺少配置键' },
            { status: 400 }
          );
          return addCorsHeaders(response);
        }
        const adSkipConfig = await storage.getAdSkipConfig(key);
        const response = NextResponse.json({ config: adSkipConfig });
        return addCorsHeaders(response);
      }

      case 'set': {
        if (!key || !config) {
          const response = NextResponse.json(
            { error: '缺少配置键或配置数据' },
            { status: 400 }
          );
          return addCorsHeaders(response);
        }
        if (!isValidConfig(config as EpisodeAdSkipConfig)) {
          const response = NextResponse.json(
            { error: '配置数据格式错误' },
            { status: 400 }
          );
          return addCorsHeaders(response);
        }
        await storage.setAdSkipConfig(key, config as EpisodeAdSkipConfig);
        const response = NextResponse.json({ success: true });
        return addCorsHeaders(response);
      }

      case 'getAll': {
        const configs = await storage.getAllAdSkipConfigs();
        const response = NextResponse.json({ configs });
        return addCorsHeaders(response);
      }

      case 'delete': {
        if (!key) {
          const response = NextResponse.json(
            { error: '缺少配置键' },
            { status: 400 }
          );
          return addCorsHeaders(response);
        }
        await storage.deleteAdSkipConfig(key);
        const response = NextResponse.json({ success: true });
        return addCorsHeaders(response);
      }

      default: {
        const response = NextResponse.json(
          { error: '不支持的操作类型' },
          { status: 400 }
        );
        return addCorsHeaders(response);
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Ad Skip Window API 错误:', error);
    const response = NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
    return addCorsHeaders(response);
  }
}
