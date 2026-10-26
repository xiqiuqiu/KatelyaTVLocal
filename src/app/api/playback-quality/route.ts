import { getOptionalRequestContext } from '@cloudflare/next-on-pages';
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  PLAYBACK_QUALITY_MAX_BODY_BYTES,
  playbackQualityPayloadSchema,
} from '@/lib/playback-quality';
import { savePlaybackQuality } from '@/lib/playback-quality.server';

export const runtime = 'edge';

// shortcut: instance-local burst control; atomic D1 day quotas bound persistent writes.
const bursts = new Map<string, { minute: number; count: number }>();

export async function POST(request: NextRequest) {
  const auth = await getAuthInfoFromCookie(request);
  if (!auth)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const owner = auth.username || 'local-owner';

  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  const requestOrigin = new URL(request.url);
  // Next's internal URL can use localhost while the actual request uses a preview host.
  requestOrigin.host = request.headers.get('host') || requestOrigin.host;
  if (
    (origin ? origin !== requestOrigin.origin : site !== 'same-origin') ||
    (site && site !== 'same-origin')
  )
    return NextResponse.json(
      { error: 'Cross-site request rejected' },
      { status: 403 }
    );
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  ) {
    return NextResponse.json(
      { error: 'Expected application/json' },
      { status: 400 }
    );
  }

  let payload: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader)
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    const decoder = new TextDecoder();
    let text = '';
    let length = 0;
    try {
      let chunk = await reader.read();
      while (!chunk.done) {
        const value = chunk.value;
        length += value.byteLength;
        if (length > PLAYBACK_QUALITY_MAX_BODY_BYTES) {
          void reader.cancel().catch(() => undefined);
          return NextResponse.json(
            { error: 'Payload too large' },
            { status: 413 }
          );
        }
        text += decoder.decode(value, { stream: true });
        chunk = await reader.read();
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 }
    );
  }
  const parsed = playbackQualityPayloadSchema.safeParse(payload);
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid playback quality' },
      { status: 400 }
    );

  const minute = Math.floor(Date.now() / 60_000);
  const burst = bursts.get(owner);
  if (burst?.minute === minute && burst.count >= 120) {
    return NextResponse.json(
      { error: 'Rate limited' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }
  if (!burst || burst.minute !== minute) {
    bursts.forEach((value, key) => {
      if (value.minute !== minute) bursts.delete(key);
    });
    if (bursts.size >= 1000)
      return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
    bursts.set(owner, { minute, count: 1 });
  } else burst.count += 1;

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
    const result = await savePlaybackQuality(env, owner, parsed.data.records);
    if (result === 'quota')
      return NextResponse.json(
        { error: 'Daily metric quota reached' },
        { status: 429 }
      );
    if (result === 'no-d1')
      return NextResponse.json(
        { saved: false, skipped: true, reason: 'no-d1' },
        { status: 202 }
      );
    return NextResponse.json(
      { saved: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      { saved: false, skipped: true, reason: 'storage-unavailable' },
      { status: 202 }
    );
  }
}
