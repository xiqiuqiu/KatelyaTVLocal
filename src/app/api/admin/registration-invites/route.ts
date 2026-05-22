import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import {
  createRegistrationInvite,
  disableRegistrationInvite,
  listRegistrationInvites,
} from '@/lib/registration/invite-admin';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  if ((process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储管理邀请码' },
      { status: 400 }
    );
  }

  try {
    const isAdmin = await isAdminRequest(request);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const invites = await listRegistrationInvites();
    return NextResponse.json(
      { invites },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '获取邀请码失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if ((process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储管理邀请码' },
      { status: 400 }
    );
  }

  try {
    const isAdmin = await isAdminRequest(request);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      action?: 'create' | 'disable';
      code?: string;
      maxUses?: number;
      expiresAt?: number | null;
    };

    if (body.action === 'create') {
      const invite = await createRegistrationInvite({
        maxUses: body.maxUses,
        expiresAt: body.expiresAt,
      });
      return NextResponse.json({ invite });
    }

    if (body.action === 'disable') {
      if (!body.code) {
        return NextResponse.json({ error: '缺少邀请码' }, { status: 400 });
      }

      await disableRegistrationInvite({ code: body.code });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: '邀请码操作失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
