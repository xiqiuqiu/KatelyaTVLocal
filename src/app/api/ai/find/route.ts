import { NextRequest, NextResponse } from 'next/server';

import { getAiFindConfig, getAiFindConfigError } from '@/lib/ai-find/config';
import { runAiFind } from '@/lib/ai-find/orchestrator';
import { checkAiFindRateLimit } from '@/lib/ai-find/rate-limit';
import type { AiFindRequest } from '@/lib/ai-find/types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';

export const runtime = 'edge';

function getClientIdentity(request: NextRequest, username?: string): string {
  if (username) return `user:${username}`;

  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || 'anonymous';
  return `ip:${ip}`;
}

function validatePayload(payload: unknown): AiFindRequest | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Partial<AiFindRequest>;
  if (typeof candidate.query !== 'string' || !candidate.query.trim()) {
    return null;
  }

  return {
    query: candidate.query.trim().slice(0, 200),
    mode: candidate.mode === 'browse' ? 'browse' : 'find',
    userPreference: candidate.userPreference,
  };
}

export async function OPTIONS() {
  return handleOptionsRequest();
}

export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    const response = NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  const aiFindRequest = validatePayload(payload);
  if (!aiFindRequest) {
    const response = NextResponse.json(
      { error: 'Missing query' },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  const config = getAiFindConfig();
  const configError = getAiFindConfigError(config);
  if (configError) {
    const response = NextResponse.json({ error: configError }, { status: 503 });
    return addCorsHeaders(response);
  }

  const authInfo = await getAuthInfoFromCookie(request);
  const rateLimit = checkAiFindRateLimit({
    key: getClientIdentity(request, authInfo?.username),
    limit: config.dailyLimitPerUser,
  });

  if (!rateLimit.allowed) {
    const response = NextResponse.json(
      {
        error: 'AI 找片次数已达到今日上限',
        resetAt: rateLimit.resetAt,
      },
      { status: 429 }
    );
    return addCorsHeaders(response);
  }

  const requestUrl = new URL(request.url);

  try {
    const result = await runAiFind({
      config,
      request: aiFindRequest,
      requestOrigin: request.headers.get('origin') || requestUrl.origin,
    });

    const response = NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
    return addCorsHeaders(response);
  } catch (error) {
    console.error('[ai-find] request failed', error);

    const response = NextResponse.json(
      { error: 'AI 找片暂时不可用，请稍后再试' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
    return addCorsHeaders(response);
  }
}
