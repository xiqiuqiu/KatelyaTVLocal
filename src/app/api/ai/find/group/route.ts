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
import { buildAiFindCandidateGroup } from '@/lib/ai-find/orchestrator';
import type {
  AiFindCandidateQuery,
  AiFindMediaType,
  AiFindRequest,
} from '@/lib/ai-find/types';
import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';

export const runtime = 'edge';

function normalizeConfidence(
  value: unknown
): AiFindCandidateQuery['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

function normalizeType(value: unknown): AiFindMediaType {
  return value === 'movie' || value === 'tv' || value === 'show'
    ? value
    : 'unknown';
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function validatePayload(payload: unknown): {
  candidate: AiFindCandidateQuery;
  userPreference?: AiFindRequest['userPreference'];
} | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const body = payload as {
    candidate?: Partial<AiFindCandidateQuery>;
    userPreference?: AiFindRequest['userPreference'];
  };
  const query = body.candidate?.query?.trim();
  if (!query) {
    return null;
  }

  return {
    candidate: {
      query: query.slice(0, 100),
      reason:
        body.candidate?.reason?.trim().slice(0, 160) ||
        '根据你的描述生成的候选片名',
      confidence: normalizeConfidence(body.candidate?.confidence),
      verifiedTitle: normalizeOptionalText(body.candidate?.verifiedTitle),
      year: normalizeOptionalText(body.candidate?.year),
      type: normalizeType(body.candidate?.type),
    },
    userPreference: body.userPreference,
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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return createResponse({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const body = validatePayload(payload);
  if (!body) {
    return createResponse({ error: 'Missing candidate query' }, { status: 400 });
  }

  const config = getAiFindConfig();
  debugEnabled = shouldLogAiFindDebug(config.debug, initialDebugContext);
  const debugContext = {
    ...initialDebugContext,
    enabled: debugEnabled,
  };
  const configError = getAiFindConfigError(config);
  if (configError) {
    return createResponse({ error: configError }, { status: 503 });
  }

  logAiFindDebug({
    configDebug: config.debug,
    context: debugContext,
    event: 'candidate group request received',
    details: {
      query: sanitizeAiFindDebugText(body.candidate.query),
      origin: request.headers.get('origin') || requestUrl.origin,
    },
  });

  const result = await buildAiFindCandidateGroup({
    config,
    candidate: body.candidate,
    request: {
      userPreference: body.userPreference,
    },
    requestOrigin: request.headers.get('origin') || requestUrl.origin,
    debugContext,
  });

  logAiFindDebug({
    configDebug: config.debug,
    context: debugContext,
    event: 'candidate group request completed',
    details: {
      durationMs: Date.now() - startedAt,
      query: sanitizeAiFindDebugText(result.group.query),
      rawCount: result.group.rawCount,
      groupedCount: result.group.groupedCount,
      failed: result.failed,
    },
  });

  return createResponse(
    {
      ...result,
      generatedAt: Date.now(),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
