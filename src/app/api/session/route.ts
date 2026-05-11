import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      username: authInfo.username ?? null,
      role: authInfo.role,
    },
  });
}
