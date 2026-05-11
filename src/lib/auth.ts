import { NextRequest } from 'next/server';

import { SessionPayload, SessionRole, parseSessionCookieValue } from './security/session';

export type AuthInfo = SessionPayload;

export interface RuntimeCurrentUser {
  username?: string | null;
  role?: SessionRole;
}

export function getSessionSigningSecret(): string | null {
  return process.env.AUTH_SIGNING_SECRET || null;
}

// 从 cookie 获取认证信息 (服务端使用)
export async function getAuthInfoFromCookie(
  request: NextRequest
): Promise<AuthInfo | null> {
  const authCookie = request.cookies.get('auth');
  const signingSecret = getSessionSigningSecret();

  if (!authCookie || !signingSecret) {
    return null;
  }

  return parseSessionCookieValue(authCookie.value, signingSecret);
}

// 从运行时配置获取最小当前用户信息 (客户端使用)
export function getRuntimeCurrentUser(): RuntimeCurrentUser | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.RUNTIME_CONFIG?.CURRENT_USER || null;
}
