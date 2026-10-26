import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { readPlaybackQualitySummary } from '@/lib/playback-quality.server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request)))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const days = Number(new URL(request.url).searchParams.get('days') || '7');
  if (!Number.isInteger(days) || days < 1 || days > 30)
    return NextResponse.json(
      { error: 'days must be between 1 and 30' },
      { status: 400 }
    );
  try {
    let env: Record<string, unknown>;
    try {
      env = (getOptionalRequestContext()?.env || process.env) as Record<
        string,
        unknown
      >;
    } catch {
      env = process.env as Record<string, unknown>;
    }
    const summary = await readPlaybackQualitySummary(env, days);
    if (!summary)
      return NextResponse.json(
        { available: false, reason: 'no-d1' },
        { status: 202, headers: { 'Cache-Control': 'no-store' } }
      );
    return NextResponse.json(
      { available: true, ...summary },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      { available: false, reason: 'storage-unavailable' },
      { status: 202, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
