/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getSessionSigningSecret } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { createSessionCookieValue } from '@/lib/security/session';

export const runtime = 'edge';

const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'd1'
    | 'upstash'
    | undefined) || 'localstorage';

function setAuthCookie(
  req: NextRequest,
  response: NextResponse,
  cookieValue: string,
  expires: Date
) {
  response.cookies.set('auth', cookieValue, {
    path: '/',
    expires,
    sameSite: 'lax',
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
  });
}

export async function POST(req: NextRequest) {
  try {
    const signingSecret = getSessionSigningSecret();
    if (!signingSecret) {
      return NextResponse.json(
        { error: 'AUTH_SIGNING_SECRET 未配置' },
        { status: 500 }
      );
    }

    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: '当前模式不支持注册' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    if (!config.UserConfig.AllowRegister) {
      return NextResponse.json({ error: '当前未开放注册' }, { status: 400 });
    }

    const { username, password } = await req.json();
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }
    if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用户已存在' }, { status: 400 });
    }

    try {
      const exists = await db.checkUserExist(username);
      if (exists) {
        return NextResponse.json({ error: '用户已存在' }, { status: 400 });
      }

      await db.upgradeLegacyPasswords();
      await db.registerUser(username, password);

      config.UserConfig.Users.push({
        username,
        role: 'user',
      });
      await db.saveAdminConfig(config);

      const response = NextResponse.json({ ok: true });
      const cookieValue = await createSessionCookieValue(
        { username, role: 'user' },
        signingSecret
      );
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);

      setAuthCookie(req, response, cookieValue, expires);
      return response;
    } catch (err) {
      console.error('数据库注册失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('注册接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
