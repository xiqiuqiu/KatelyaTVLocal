import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextResponse } from 'next/server';

import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';
import { savePlaybackFeedback } from '@/lib/source-ranking/feedback';
import { getSourceRankingRuntime } from '@/lib/source-ranking/runtime';
import { PlaybackFeedbackInput } from '@/lib/types';

export const runtime = 'edge';

type RuntimeSource = Record<string, unknown>;

function resolveSourceRankingEnv(): RuntimeSource | undefined {
  try {
    const requestContext = getOptionalRequestContext();
    return requestContext?.env as RuntimeSource | undefined;
  } catch {
    return undefined;
  }
}

export async function OPTIONS() {
  return handleOptionsRequest();
}

export async function POST(request: Request) {
  let payload: PlaybackFeedbackInput | null = null;

  try {
    payload = (await request.json()) as PlaybackFeedbackInput;
  } catch {
    const response = NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  if (!payload?.sourceKey || !payload.playbackMode) {
    const response = NextResponse.json(
      { error: 'Missing playback feedback fields' },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  const rankingEnv = resolveSourceRankingEnv();
  const runtimeState = getSourceRankingRuntime(
    rankingEnv || (process.env as unknown as RuntimeSource)
  );

  if (!runtimeState.enabled || !runtimeState.hasD1) {
    const response = NextResponse.json(
      {
        saved: false,
        skipped: true,
      },
      { status: 202 }
    );
    return addCorsHeaders(response);
  }

  try {
    const saved = await savePlaybackFeedback(
      rankingEnv || (process.env as unknown as RuntimeSource),
      payload
    );
    const response = NextResponse.json(
      { saved },
      { status: saved ? 200 : 202 }
    );
    return addCorsHeaders(response);
  } catch {
    // Missing D1 migrations (e.g. platform column) must not 500 the play page.
    const response = NextResponse.json(
      { saved: false, skipped: true, error: 'feedback-persist-failed' },
      { status: 202 }
    );
    return addCorsHeaders(response);
  }
}
