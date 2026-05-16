import { NextRequest, NextResponse } from 'next/server';

import { getAiFindConfig, getAiFindConfigError } from '@/lib/ai-find/config';
import {
  AI_FIND_DEBUG_RESPONSE_HEADER,
  AI_FIND_REQUEST_ID_HEADER,
  createAiFindRequestId,
  getAiFindRequestId,
  isAiFindDebugRequested,
  logAiFindDebug,
  sanitizeAiFindDebugText,
  shouldLogAiFindDebug,
} from '@/lib/ai-find/debug';
import { isAiFindUserFacingError } from '@/lib/ai-find/errors';
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
  const startedAt = Date.now();
  const requestUrl = new URL(request.url);
  const requestId =
    getAiFindRequestId(request.headers) || createAiFindRequestId();
  const initialDebugContext = {
    enabled: isAiFindDebugRequested(request.headers, requestUrl.searchParams),
    requestId,
    scope: 'server' as const,
  };
  let debugEnabled = Boolean(initialDebugContext.enabled);
  let payload: unknown;

  const createResponse = (
    body: unknown,
    init?: { status?: number; headers?: Record<string, string> }
  ) => {
    const response = NextResponse.json(body, init);
    response.headers.set(AI_FIND_REQUEST_ID_HEADER, requestId);
    response.headers.set(
      AI_FIND_DEBUG_RESPONSE_HEADER,
      debugEnabled ? '1' : '0'
    );
    return addCorsHeaders(response);
  };

  try {
    payload = await request.json();
  } catch {
    logAiFindDebug({
      context: initialDebugContext,
      event: 'invalid json payload',
      details: {
        method: request.method,
        contentType: request.headers.get('content-type') || 'unknown',
        origin: request.headers.get('origin') || requestUrl.origin,
      },
    });

    return createResponse({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const aiFindRequest = validatePayload(payload);
  if (!aiFindRequest) {
    logAiFindDebug({
      context: initialDebugContext,
      event: 'payload validation failed',
      details: {
        payloadType: typeof payload,
        query: sanitizeAiFindDebugText(
          typeof (payload as { query?: unknown } | null)?.query === 'string'
            ? (payload as { query?: string }).query ?? null
            : null
        ),
      },
    });

    return createResponse({ error: 'Missing query' }, { status: 400 });
  }

  logAiFindDebug({
    context: initialDebugContext,
    event: 'request received',
    details: {
      method: request.method,
      mode: aiFindRequest.mode || 'find',
      query: sanitizeAiFindDebugText(aiFindRequest.query),
      queryLength: aiFindRequest.query.length,
      hasUserPreference: Boolean(aiFindRequest.userPreference),
      origin: request.headers.get('origin') || requestUrl.origin,
    },
  });

  const config = getAiFindConfig();
  debugEnabled = shouldLogAiFindDebug(config.debug, initialDebugContext);
  const debugContext = {
    ...initialDebugContext,
    enabled: debugEnabled,
  };
  const configError = getAiFindConfigError(config);
  if (configError) {
    logAiFindDebug({
      configDebug: config.debug,
      context: debugContext,
      event: 'request blocked by config',
      details: {
        errorMessage: configError,
      },
    });

    return createResponse({ error: configError }, { status: 503 });
  }

  const authInfo = await getAuthInfoFromCookie(request);
  const clientIdentity = getClientIdentity(request, authInfo?.username);
  const rateLimit = checkAiFindRateLimit({
    key: clientIdentity,
    limit: config.dailyLimitPerUser,
  });

  logAiFindDebug({
    configDebug: config.debug,
    context: debugContext,
    event: 'rate limit evaluated',
    details: {
      allowed: rateLimit.allowed,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.resetAt,
      identity: clientIdentity,
    },
  });

  if (!rateLimit.allowed) {
    return createResponse(
      {
        error: 'AI 找片次数已达到今日上限',
        resetAt: rateLimit.resetAt,
      },
      { status: 429 }
    );
  }

  try {
    logAiFindDebug({
      configDebug: config.debug,
      context: debugContext,
      event: 'orchestrator started',
      details: {
        requestOrigin: request.headers.get('origin') || requestUrl.origin,
      },
    });

    const result = await runAiFind({
      config,
      request: aiFindRequest,
      requestOrigin: request.headers.get('origin') || requestUrl.origin,
      debugContext,
    });

    logAiFindDebug({
      configDebug: config.debug,
      context: debugContext,
      event: 'request completed',
      details: {
        durationMs: Date.now() - startedAt,
        candidateCount: result.candidateQueries.length,
        groupCount: result.groups.length,
        foundCount: result.groups.reduce(
          (count, group) => count + group.groupedCount,
          0
        ),
        degraded: Boolean(result.degraded),
        errorMessage: result.errorMessage,
      },
    });

    return createResponse(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const status = isAiFindUserFacingError(error) ? error.status : 500;
    const publicMessage = isAiFindUserFacingError(error)
      ? error.publicMessage
      : 'AI 找片暂时不可用，请稍后再试';

    logAiFindDebug({
      configDebug: config.debug,
      context: debugContext,
      event: 'request failed',
      details: {
        durationMs: Date.now() - startedAt,
        errorMessage:
          error instanceof Error ? error.message : 'Unknown AI find failure',
        status,
      },
    });

    return createResponse(
      { error: publicMessage },
      {
        status,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
