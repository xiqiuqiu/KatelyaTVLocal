import { NextRequest, NextResponse } from 'next/server';

import { getAiFindUsageReport } from '@/lib/ai-find/usage-report';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export const runtime = 'edge';

async function requireAdmin(request: NextRequest) {
  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return false;
  }

  if (authInfo.username === process.env.USERNAME) {
    return true;
  }

  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (entry) => entry.username === authInfo.username
  );

  return user?.role === 'admin';
}

export async function GET(request: NextRequest) {
  if ((process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储查看 AI 用量' },
      { status: 400 }
    );
  }

  try {
    const isAdmin = await requireAdmin(request);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const days = Number(url.searchParams.get('days') || '7');
    const subjectLimit = Number(url.searchParams.get('limit') || '20');
    const report = await getAiFindUsageReport({ days, subjectLimit });

    return NextResponse.json(report, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '获取 AI 用量失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
