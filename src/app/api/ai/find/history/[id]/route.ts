import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'edge';

interface RouteContext {
  params: {
    id: string;
  };
}

async function getUserName(request: NextRequest): Promise<string | null> {
  const authInfo = await getAuthInfoFromCookie(request);
  return authInfo?.username || null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const userName = await getUserName(request);
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const record = await db.getAiFindSavedRecord(userName, context.params.id);
  if (!record) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await db.touchAiFindSavedRecord(userName, context.params.id);
  return NextResponse.json({ record }, { status: 200 });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const userName = await getUserName(request);
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await db.deleteAiFindSavedRecord(userName, context.params.id);
  return NextResponse.json({ success: true }, { status: 200 });
}
