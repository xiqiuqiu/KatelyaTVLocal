import { NextRequest, NextResponse } from 'next/server';

import type { AiFindResponse } from '@/lib/ai-find/types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import type { AiFindSavedRecordStatus } from '@/lib/types';

export const runtime = 'edge';

function isValidStatus(value: unknown): value is AiFindSavedRecordStatus {
  return value === 'partial' || value === 'complete';
}

function isValidAiFindResponse(value: unknown): value is AiFindResponse {
  const response = value as Partial<AiFindResponse> | null;

  return Boolean(
    response &&
      typeof response.answer === 'string' &&
      Array.isArray(response.candidateQueries) &&
      response.candidateQueries.length > 0 &&
      Array.isArray(response.groups) &&
      Array.isArray(response.suggestions) &&
      Array.isArray(response.toolTrace) &&
      typeof response.generatedAt === 'number'
  );
}

async function getUserName(request: NextRequest): Promise<string | null> {
  const authInfo = await getAuthInfoFromCookie(request);
  return authInfo?.username || null;
}

export async function GET(request: NextRequest) {
  const userName = await getUserName(request);
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const records = await db.getAiFindSavedRecords(userName);
  return NextResponse.json({ records }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const userName = await getUserName(request);
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 }
    );
  }

  const payload = body as Record<string, unknown>;
  const id =
    typeof payload.id === 'string' ? payload.id.trim().slice(0, 80) : '';
  const query =
    typeof payload.query === 'string' ? payload.query.trim().slice(0, 200) : '';

  if (
    !id ||
    !query ||
    !isValidStatus(payload.status) ||
    !isValidAiFindResponse(payload.response)
  ) {
    return NextResponse.json(
      { error: 'Invalid saved record' },
      { status: 400 }
    );
  }

  const now = Date.now();
  await db.saveAiFindSavedRecord(userName, {
    id,
    userName,
    query,
    response: payload.response,
    status: payload.status,
    createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : now,
    updatedAt: now,
    lastOpenedAt:
      typeof payload.lastOpenedAt === 'number' ? payload.lastOpenedAt : now,
    openedCount:
      typeof payload.openedCount === 'number' ? payload.openedCount : 0,
  });

  return NextResponse.json({ success: true, id }, { status: 200 });
}

export async function DELETE(request: NextRequest) {
  const userName = await getUserName(request);
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await db.clearAiFindSavedRecords(userName);
  return NextResponse.json({ success: true }, { status: 200 });
}
