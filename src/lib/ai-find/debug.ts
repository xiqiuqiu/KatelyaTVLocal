export interface AiFindDebugContext {
  enabled?: boolean;
  requestId?: string;
  scope?: 'client' | 'server';
}

type HeaderReader = {
  get(name: string): string | null;
};

const AI_FIND_DEBUG_TEXT_LIMIT = 160;

export const AI_FIND_DEBUG_HEADER = 'x-ai-find-debug';
export const AI_FIND_DEBUG_RESPONSE_HEADER = 'x-ai-find-debug-enabled';
export const AI_FIND_REQUEST_ID_HEADER = 'x-ai-find-request-id';

export function createAiFindRequestId(now = Date.now()): string {
  return `af-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getAiFindRequestId(
  headers?: HeaderReader | null
): string | null {
  const requestId = headers?.get(AI_FIND_REQUEST_ID_HEADER)?.trim();
  return requestId ? requestId.slice(0, 64) : null;
}

export function isAiFindDebugRequested(
  headers?: HeaderReader | null,
  searchParams?: URLSearchParams
): boolean {
  const headerValue = headers?.get(AI_FIND_DEBUG_HEADER);
  if (headerValue === '1' || headerValue === 'true') {
    return true;
  }

  return searchParams?.get('aiDebug') === '1';
}

export function shouldLogAiFindDebug(
  configDebug: boolean,
  context?: AiFindDebugContext
): boolean {
  return configDebug || Boolean(context?.enabled);
}

export function logAiFindDebug({
  configDebug = false,
  context,
  event,
  details = {},
}: {
  configDebug?: boolean;
  context?: AiFindDebugContext;
  event: string;
  details?: Record<string, unknown>;
}): void {
  if (!shouldLogAiFindDebug(configDebug, context)) {
    return;
  }

  const prefix = ['[ai-find]'];

  if (context?.scope) {
    prefix.push(`[${context.scope}]`);
  }

  if (context?.requestId) {
    prefix.push(`[${context.requestId}]`);
  }

  console.log(`${prefix.join('')} ${event}`, details);
}

export function sanitizeAiFindDebugText(
  value: string | null | undefined,
  limit = AI_FIND_DEBUG_TEXT_LIMIT
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit)}...`;
}
