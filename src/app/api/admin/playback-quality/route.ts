import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import {
  readPlaybackDashboard,
  readPlaybackQualitySummary,
  readSourceRankingExperiment,
} from '@/lib/playback-quality.server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request)))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const days = Number(params.get('days') || '7');
  const cohort = params.get('cohort') ?? 'regular';
  if (cohort !== 'regular' && cohort !== 'test')
    return NextResponse.json({ error: 'Invalid cohort' }, { status: 400 });
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
    const view = params.get('view');
    const read =
      view === 'ranking-experiment'
        ? readSourceRankingExperiment
        : view === 'dashboard'
        ? readPlaybackDashboard
        : readPlaybackQualitySummary;
    const summary = await read(env, days, Date.now(), cohort === 'test');
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
