import type { NextRequest } from 'next/server';

import type { AiFindConfig } from './types';
import {
  type AiFindQuotaResult,
  checkAndConsumeAiFindQuota,
} from './usage-quota';
import { getAuthInfoFromCookie } from '../auth';

export type AiFindEndpoint = 'find' | 'group';

export interface AiFindRequestGuardResult {
  ok: boolean;
  username?: string;
  ip: string;
  quota?: AiFindQuotaResult;
  status?: number;
  error?: string;
  resetAt?: number;
}

export function getAiFindClientIp(request: NextRequest): string {
  const cfConnectingIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  const forwardedFor = request.headers.get('x-forwarded-for');
  return forwardedFor?.split(',')[0]?.trim() || 'anonymous';
}

export async function enforceAiFindRequestGuard({
  request,
  endpoint,
  config,
}: {
  request: NextRequest;
  endpoint: AiFindEndpoint;
  config: AiFindConfig;
}): Promise<AiFindRequestGuardResult> {
  const ip = getAiFindClientIp(request);
  const authInfo = await getAuthInfoFromCookie(request);
  const username = authInfo?.username;

  if (!username) {
    return {
      ok: false,
      ip,
      status: 401,
      error: '请先登录后再使用 AI 找片',
    };
  }

  const quota = await checkAndConsumeAiFindQuota({
    username,
    ip,
    endpoint,
    config,
  });

  if (!quota.allowed) {
    return {
      ok: false,
      username,
      ip,
      quota,
      status: quota.status,
      error: quota.message || 'AI 找片次数已达到今日上限',
      resetAt: quota.resetAt,
    };
  }

  return {
    ok: true,
    username,
    ip,
    quota,
  };
}
