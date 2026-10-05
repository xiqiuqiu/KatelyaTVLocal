import { NextRequest, NextResponse } from 'next/server';

interface TvRemoteDebugEvent {
  id: number;
  receivedAt: string;
  sessionId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  userAgent: string;
}

const debugGlobal = globalThis as typeof globalThis & {
  tvRemoteDebugEvents?: TvRemoteDebugEvent[];
  tvRemoteDebugSequence?: number;
};

function unavailable() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') return unavailable();

  const sessionId = request.nextUrl.searchParams.get('sessionId');
  const events = (debugGlobal.tvRemoteDebugEvents || []).filter(
    (event) => !sessionId || event.sessionId === sessionId
  );

  return NextResponse.json(
    { events },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') return unavailable();

  const body = (await request.json()) as {
    sessionId?: string;
    eventType?: string;
    payload?: Record<string, unknown>;
  };

  if (!body.sessionId || !body.eventType) {
    return NextResponse.json(
      { error: 'Missing sessionId or eventType' },
      { status: 400 }
    );
  }

  const events = (debugGlobal.tvRemoteDebugEvents ||= []);
  const id = (debugGlobal.tvRemoteDebugSequence =
    (debugGlobal.tvRemoteDebugSequence || 0) + 1);
  const event: TvRemoteDebugEvent = {
    id,
    receivedAt: new Date().toISOString(),
    sessionId: body.sessionId,
    eventType: body.eventType,
    payload: body.payload,
    userAgent: request.headers.get('user-agent') || '',
  };

  events.push(event);
  if (events.length > 300) events.splice(0, events.length - 300);

  // eslint-disable-next-line no-console
  console.log('[tv-remote]', JSON.stringify(event));
  return NextResponse.json({ saved: true, id });
}
