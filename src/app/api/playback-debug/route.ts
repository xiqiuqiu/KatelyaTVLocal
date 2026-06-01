import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { addCorsHeaders, handleOptionsRequest } from '@/lib/cors';
import {
  hasPlaybackDebugD1,
  PlaybackDebugLogInput,
  savePlaybackDebugLog,
} from '@/lib/playback-debug/logs';

export const runtime = 'edge';

type RuntimeEnv = Record<string, unknown>;

function resolveEnv(): RuntimeEnv {
  try {
    const requestContext = getOptionalRequestContext();
    return (requestContext?.env || process.env) as RuntimeEnv;
  } catch {
    return process.env as unknown as RuntimeEnv;
  }
}

async function canUsePlaybackDebug(request: NextRequest | Request) {
  const config = await getConfig();
  if (!config.SiteConfig.PlaybackDebugEnabled) {
    return false;
  }

  const authInfo = await getAuthInfoFromCookie(request as NextRequest);
  if (!authInfo?.username) {
    return false;
  }

  if (authInfo.username === process.env.USERNAME) {
    return true;
  }

  const user = config.UserConfig.Users.find(
    (entry) => entry.username === authInfo.username
  );
  return user?.role === 'admin';
}

export async function OPTIONS() {
  return handleOptionsRequest();
}

export async function GET(request: NextRequest) {
  const enabled = await canUsePlaybackDebug(request);
  return addCorsHeaders(
    NextResponse.json(
      {
        enabled,
        canViewOverlay: enabled,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    )
  );
}

export async function POST(request: NextRequest) {
  let payload: PlaybackDebugLogInput | null = null;

  try {
    payload = (await request.json()) as PlaybackDebugLogInput;
  } catch {
    const response = NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  if (!payload?.sessionId || !payload.eventType) {
    const response = NextResponse.json(
      { error: 'Missing playback debug fields' },
      { status: 400 }
    );
    return addCorsHeaders(response);
  }

  const enabled = await canUsePlaybackDebug(request);
  if (!enabled) {
    return addCorsHeaders(
      NextResponse.json(
        {
          saved: false,
          skipped: true,
          reason: 'disabled',
        },
        { status: 202 }
      )
    );
  }

  const env = resolveEnv();
  if (!hasPlaybackDebugD1(env)) {
    return addCorsHeaders(
      NextResponse.json(
        {
          saved: false,
          skipped: true,
          reason: 'storage-unavailable',
        },
        { status: 202 }
      )
    );
  }

  try {
    const saved = await savePlaybackDebugLog(env, payload);
    return addCorsHeaders(
      NextResponse.json(
        saved
          ? { saved: true }
          : { saved: false, skipped: true, reason: 'invalid-payload' },
        { status: saved ? 200 : 202 }
      )
    );
  } catch {
    return addCorsHeaders(
      NextResponse.json(
        {
          saved: false,
          skipped: true,
          reason: 'write-failed',
        },
        { status: 202 }
      )
    );
  }
}
