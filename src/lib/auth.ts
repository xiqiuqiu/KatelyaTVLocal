import { NextRequest } from 'next/server';

import {
  parseSessionCookieValue,
  SessionPayload,
  SessionRole,
} from './security/session';

export type AuthInfo = SessionPayload;

export interface RuntimeCurrentUser {
  username?: string | null;
  role?: SessionRole;
}

export function getSessionSigningSecret(): string | null {
  return process.env.AUTH_SIGNING_SECRET || null;
}

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

export function getRuntimeCurrentUser(): RuntimeCurrentUser | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.RUNTIME_CONFIG?.CURRENT_USER || null;
}
