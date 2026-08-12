/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getSessionSigningSecret } from '@/lib/auth';
import {
  type AuthAuditFailureReason,
  recordAuthAuditEvent,
} from '@/lib/auth-audit';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { recordLoginResult, validateLoginSecurity } from '@/lib/login/security';
import {
  type SessionRole,
  createSessionCookieValue,
} from '@/lib/security/session';
import { getClientIp } from '@/lib/turnstile';

export const runtime = 'edge';

function getStorageType() {
  return (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE as
      | 'localstorage'
      | 'redis'
      | 'd1'
      | 'upstash'
      | undefined) || 'localstorage'
  );
}

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

function getRequestUserAgent(req: NextRequest): string | null {
  return req.headers.get('user-agent');
}

async function writeAuthAudit(input: {
  eventType: 'login_success' | 'login_failure';
  username?: string | null;
  failureReason?: AuthAuditFailureReason | null;
  ip: string;
  userAgent: string | null;
}) {
  try {
    await recordAuthAuditEvent(input);
  } catch (error) {
    console.error('auth audit write failed', error);
  }
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

    const { username, password, turnstileToken } = await req.json();
    const storageType = getStorageType();
    const clientIp = getClientIp(req.headers);
    const userAgent = getRequestUserAgent(req);
    const securityUsername =
      storageType === 'localstorage'
        ? 'owner'
        : typeof username === 'string'
        ? username
        : '';
    const security = await validateLoginSecurity({
      username: securityUsername,
      turnstileToken:
        typeof turnstileToken === 'string' ? turnstileToken : undefined,
      ip: clientIp,
    });
    if (!security.ok) {
      if (security.auditReason) {
        await writeAuthAudit({
          eventType: 'login_failure',
          username: securityUsername,
          failureReason: security.auditReason,
          ip: clientIp,
          userAgent,
        });
      }
      return NextResponse.json(
        { error: security.error },
        { status: security.status }
      );
    }

    const createAuthenticatedResponse = async (session: {
      username?: string;
      role: SessionRole;
    }) => {
      await recordLoginResult({
        attemptKey: security.attemptKey,
        success: true,
      });
      await writeAuthAudit({
        eventType: 'login_success',
        username: session.username ?? securityUsername,
        ip: clientIp,
        userAgent,
      });
      const response = NextResponse.json({ ok: true });
      const cookieValue = await createSessionCookieValue(
        session,
        signingSecret
      );
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);

      setAuthCookie(req, response, cookieValue, expires);
      return response;
    };
    const createFailedCredentialsResponse = async (
      auditUsername: string = securityUsername
    ) => {
      await recordLoginResult({
        attemptKey: security.attemptKey,
        success: false,
      });
      await writeAuthAudit({
        eventType: 'login_failure',
        username: auditUsername,
        failureReason: 'invalid_credentials',
        ip: clientIp,
        userAgent,
      });
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    };

    if (storageType === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      if (!envPassword) {
        await recordLoginResult({
          attemptKey: security.attemptKey,
          success: true,
        });
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

      if (typeof password !== 'string') {
        return await createFailedCredentialsResponse();
      }

      if (password !== envPassword) {
        return await createFailedCredentialsResponse();
      }

      return await createAuthenticatedResponse({ role: 'user' });
    }

    if (!username || typeof username !== 'string') {
      await writeAuthAudit({
        eventType: 'login_failure',
        username: typeof username === 'string' ? username : '',
        failureReason: 'invalid_username',
        ip: clientIp,
        userAgent,
      });
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      await writeAuthAudit({
        eventType: 'login_failure',
        username,
        failureReason: 'invalid_credentials',
        ip: clientIp,
        userAgent,
      });
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    if (
      username === process.env.USERNAME &&
      password === process.env.PASSWORD
    ) {
      return await createAuthenticatedResponse({ username, role: 'owner' });
    } else if (username === process.env.USERNAME) {
      return await createFailedCredentialsResponse(username);
    }

    const config = await getConfig();
    const user = config.UserConfig.Users.find(
      (item) => item.username === username
    );
    if (user?.banned) {
      return await createFailedCredentialsResponse(username);
    }

    try {
      await db.upgradeLegacyPasswords();
      const verified = await db.verifyUser(username, password);
      if (!verified) {
        return await createFailedCredentialsResponse(username);
      }

      return await createAuthenticatedResponse({
        username,
        role: user?.role || 'user',
      });
    } catch (err) {
      console.error('数据库验证失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('登录接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
