import { NextRequest, NextResponse } from 'next/server';

import {
  applyAdSkipWindowConfirmation,
  generateAdSkipConfigKey,
  mergeEpisodeAdSkipConfigs,
} from '@/lib/ad-skip-window';
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

function isValidConfirmationWindow(window: {
  startTimeSeconds?: unknown;
  endTimeSeconds?: unknown;
}): boolean {
  return (
    typeof window.startTimeSeconds === 'number' &&
    typeof window.endTimeSeconds === 'number' &&
    Number.isFinite(window.startTimeSeconds) &&
    Number.isFinite(window.endTimeSeconds) &&
    window.startTimeSeconds < window.endTimeSeconds
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, key, config, window, kind, source, id, episodeIndex, nowMs } =
      body;

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
        // Merge-on-set: concurrent writers keep sibling timeline windows.
        const existing = await storage.getAdSkipConfig(key);
        const merged = mergeEpisodeAdSkipConfigs(
          existing,
          config as EpisodeAdSkipConfig
        );
        await storage.setAdSkipConfig(key, merged);
        const response = NextResponse.json({ success: true, config: merged });
        return addCorsHeaders(response);
      }

      case 'recordConfirmation': {
        if (
          typeof source !== 'string' ||
          !source ||
          typeof id !== 'string' ||
          !id ||
          typeof episodeIndex !== 'number' ||
          !Number.isInteger(episodeIndex) ||
          episodeIndex < 0 ||
          !window ||
          !isValidConfirmationWindow(window) ||
          (kind !== 'confirm' && kind !== 'undo')
        ) {
          const response = NextResponse.json(
            { error: '确认数据格式错误' },
            { status: 400 }
          );
          return addCorsHeaders(response);
        }

        const episodeKey =
          typeof key === 'string' && key.length > 0
            ? key
            : generateAdSkipConfigKey(source, id, episodeIndex);
        const existing = await storage.getAdSkipConfig(episodeKey);
        const next = applyAdSkipWindowConfirmation({
          source,
          id,
          episodeIndex,
          existing,
          window: {
            startTimeSeconds: window.startTimeSeconds,
            endTimeSeconds: window.endTimeSeconds,
            ruleId:
              typeof window.ruleId === 'string' ? window.ruleId : undefined,
          },
          kind,
          nowMs: typeof nowMs === 'number' ? nowMs : Date.now(),
        });

        if (!next) {
          const response = NextResponse.json({
            success: true,
            config: existing,
            skipped: true,
          });
          return addCorsHeaders(response);
        }

        const merged = mergeEpisodeAdSkipConfigs(existing, next);
        await storage.setAdSkipConfig(episodeKey, merged);
        const response = NextResponse.json({ success: true, config: merged });
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
