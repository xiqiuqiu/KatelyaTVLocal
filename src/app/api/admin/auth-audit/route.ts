import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import {
  type AuthAuditEventType,
  listAuthAuditEvents,
} from '@/lib/auth-audit';

export const runtime = 'edge';

type RuntimeEnv = Record<string, unknown>;

const EVENT_TYPES = new Set<AuthAuditEventType>([
  'login_success',
  'login_failure',
  'logout',
]);

function resolveEnv(): RuntimeEnv {
  try {
    const requestContext = getOptionalRequestContext();
    return (requestContext?.env || process.env) as RuntimeEnv;
  } catch {
    return process.env as unknown as RuntimeEnv;
  }
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const eventTypeParam = url.searchParams.get('eventType');
  const eventType =
    eventTypeParam && EVENT_TYPES.has(eventTypeParam as AuthAuditEventType)
      ? (eventTypeParam as AuthAuditEventType)
      : undefined;

  if (eventTypeParam && !eventType) {
    return NextResponse.json(
      { error: '无效的 eventType' },
      { status: 400 }
    );
  }

  const result = await listAuthAuditEvents({
    username: url.searchParams.get('username') || undefined,
    eventType,
    from: parseOptionalNumber(url.searchParams.get('from')),
    to: parseOptionalNumber(url.searchParams.get('to')),
    limit: parseOptionalNumber(url.searchParams.get('limit')),
    env: resolveEnv(),
  });

  if (!result.available) {
    return NextResponse.json(
      {
        available: false,
        reason: result.reason,
        error: '认证审计不可用（需要 D1）',
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  return NextResponse.json(
    {
      available: true,
      events: result.events,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
