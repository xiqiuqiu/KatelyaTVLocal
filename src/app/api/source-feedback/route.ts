import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { savePlaybackFeedback } from '@/lib/source-ranking/feedback';
import { getSourceRankingRuntime } from '@/lib/source-ranking/runtime';

export const runtime = 'edge';

type RuntimeSource = Record<string, unknown>;

const playbackFeedbackSchema = z
  .object({
    sourceKey: z.string().trim().min(1).max(512),
    platform: z
      .enum(['apple-hlsjs', 'android-hlsjs', 'desktop-hlsjs'])
      .optional(),
    playbackDomain: z.string().trim().max(255).nullable().optional(),
    title: z.string().trim().max(256).optional(),
    playbackMode: z.enum(['direct', 'proxy']),
    startupSuccess: z.boolean(),
    startupTimeMs: z.number().finite().min(0).max(600_000).optional(),
    switchedToProxy: z.boolean().optional(),
    browserQuality: z.string().trim().max(64).optional(),
    browserPingMs: z.number().finite().min(0).max(600_000).optional(),
    browserSpeedLabel: z.string().trim().max(64).optional(),
    sessionError: z.string().trim().max(256).optional(),
  })
  .strict();

function resolveSourceRankingEnv(): RuntimeSource | undefined {
  try {
    const requestContext = getOptionalRequestContext();
    return requestContext?.env as RuntimeSource | undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  const authInfo = await getAuthInfoFromCookie(request as NextRequest);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let rawPayload: unknown;

  try {
    rawPayload = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 }
    );
  }

  const parsedPayload = playbackFeedbackSchema.safeParse(rawPayload);
  if (!parsedPayload.success) {
    return NextResponse.json(
      { error: 'Invalid playback feedback' },
      { status: 400 }
    );
  }
  const payload = parsedPayload.data;

  const rankingEnv = resolveSourceRankingEnv();
  const runtimeState = getSourceRankingRuntime(
    rankingEnv || (process.env as unknown as RuntimeSource)
  );

  if (!runtimeState.enabled || !runtimeState.hasD1) {
    return NextResponse.json(
      {
        saved: false,
        skipped: true,
      },
      { status: 202 }
    );
  }

  try {
    const saved = await savePlaybackFeedback(
      rankingEnv || (process.env as unknown as RuntimeSource),
      payload
    );
    return NextResponse.json({ saved }, { status: saved ? 200 : 202 });
  } catch {
    // Missing D1 migrations (e.g. platform column) must not 500 the play page.
    return NextResponse.json(
      { saved: false, skipped: true, error: 'feedback-persist-failed' },
      { status: 202 }
    );
  }
}
