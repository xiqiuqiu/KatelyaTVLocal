import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { getConfig, invalidateAdminConfigCache } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { listPlaybackDebugLogs } from '@/lib/playback-debug/logs';

export const runtime = 'edge';

type RuntimeEnv = Record<string, unknown>;

function resolveEnv(): RuntimeEnv {
  try {
    const requestContext = getOptionalRequestContext();
    return (requestContext?.env || process.env) as RuntimeEnv;
  } catch {
    return process.env as unknown as RuntimeEnv;
  }
}

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') || '100');
    invalidateAdminConfigCache();
    const config = await getConfig();
    const logs = await listPlaybackDebugLogs(resolveEnv(), limit);

    return NextResponse.json(
      {
        enabled: Boolean(config.SiteConfig.PlaybackDebugEnabled),
        logs,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '获取播放调试日志失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdminRequest(request)))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== 'boolean')
    return NextResponse.json({ error: '调试开关无效' }, { status: 400 });
  try {
    invalidateAdminConfigCache();
    const config = await getConfig();
    await getStorage().setAdminConfig({
      ...config,
      SiteConfig: { ...config.SiteConfig, PlaybackDebugEnabled: body.enabled },
    });
    invalidateAdminConfigCache();
    return NextResponse.json({ enabled: body.enabled });
  } catch {
    return NextResponse.json({ error: '保存调试开关失败' }, { status: 500 });
  }
}
