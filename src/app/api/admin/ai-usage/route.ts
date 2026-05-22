import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { getAiFindUsageReport } from '@/lib/ai-find/usage-report';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  if ((process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储查看 AI 用量' },
      { status: 400 }
    );
  }

  try {
    const isAdmin = await isAdminRequest(request);
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
