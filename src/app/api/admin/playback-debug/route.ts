import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { getConfig } from '@/lib/config';
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
