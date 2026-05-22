/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getSessionSigningSecret } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { createSessionCookieValue } from '@/lib/security/session';
import { getClientIp, verifyTurnstileToken } from '@/lib/turnstile';

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

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return value === true || value === 'true';
}

function shouldVerifyLoginTurnstile(): boolean {
  return parseBoolean(
    process.env.LOGIN_TURNSTILE_REQUIRED,
    Boolean(process.env.TURNSTILE_SECRET_KEY)
  );
}

async function verifyLoginTurnstile(req: NextRequest, token?: string) {
  if (!shouldVerifyLoginTurnstile()) {
    return { ok: true, status: 200 };
  }

  return verifyTurnstileToken({
    token,
    ip: getClientIp(req.headers),
    secretKey: process.env.TURNSTILE_SECRET_KEY || '',
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
      const envPassword = process.env.PASSWORD;

      if (!envPassword) {
        const response = NextResponse.json({ ok: true });
        response.cookies.set('auth', '', {
          path: '/',
          expires: new Date(0),
          sameSite: 'lax',
          httpOnly: true,
          secure: req.nextUrl.protocol === 'https:',
        });
        return response;
      }

      const { password, turnstileToken } = await req.json();
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
      }

      const turnstile = await verifyLoginTurnstile(req, turnstileToken);
      if (!turnstile.ok) {
        return NextResponse.json(
          { error: turnstile.error },
          { status: turnstile.status }
        );
      }

      if (password !== envPassword) {
        return NextResponse.json(
          { ok: false, error: '密码错误' },
          { status: 401 }
        );
      }

      const response = NextResponse.json({ ok: true });
      const cookieValue = await createSessionCookieValue(
        { role: 'user' },
        signingSecret
      );
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);

      setAuthCookie(req, response, cookieValue, expires);
      return response;
    }

    const { username, password, turnstileToken } = await req.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    const turnstile = await verifyLoginTurnstile(req, turnstileToken);
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: turnstile.error },
        { status: turnstile.status }
      );
    }

    if (username === process.env.USERNAME && password === process.env.PASSWORD) {
      const response = NextResponse.json({ ok: true });
      const cookieValue = await createSessionCookieValue(
        { username, role: 'owner' },
        signingSecret
      );
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);

      setAuthCookie(req, response, cookieValue, expires);
      return response;
    } else if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const config = await getConfig();
    const user = config.UserConfig.Users.find((item) => item.username === username);
    if (user?.banned) {
      return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
    }

    try {
      await db.upgradeLegacyPasswords();
      const verified = await db.verifyUser(username, password);
      if (!verified) {
        return NextResponse.json(
          { error: '用户名或密码错误' },
          { status: 401 }
        );
      }

      const response = NextResponse.json({ ok: true });
      const cookieValue = await createSessionCookieValue(
        { username, role: user?.role || 'user' },
        signingSecret
      );
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);

      setAuthCookie(req, response, cookieValue, expires);
      return response;
    } catch (err) {
      console.error('数据库验证失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('登录接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
