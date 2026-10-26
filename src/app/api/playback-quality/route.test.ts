import type { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { savePlaybackQuality } from '@/lib/playback-quality.server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (payload: unknown, init?: { status?: number }) => ({
      status: init?.status || 200,
      json: async () => payload,
    }),
  },
}));
jest.mock(
  '@cloudflare/next-on-pages',
  () => ({
    getOptionalRequestContext: () => ({ env: { marker: 'env' } }),
  }),
  { virtual: true }
);
jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/playback-quality.server', () => ({
  savePlaybackQuality: jest.fn(),
}));

const record = {
  sessionId: 'watch-1',
  roundId: 1,
  rootRoundId: 1,
  rowKind: 'round',
  attemptId: 0,
  seq: 1,
  status: 'pending',
  outcome: null,
  contentKey: null,
  episodeIndex: 0,
  sourceKey: null,
  platform: 'desktop-hlsjs',
  runtime: 'hlsjs',
  entryKind: 'direct',
  roundReason: 'initial',
  sourceReason: null,
  releaseId: 'release-1',
  policyVersion: 'startup-baseline-v1',
  elapsedMs: 0,
  activeWaitMs: 0,
  clickToFrameMs: null,
  pageToFrameMs: null,
  sourceToFrameMs: null,
  frameEvidence: null,
  hadHidden: false,
  autoplayBlocked: false,
  promptChoice: null,
  nextRoundId: null,
};

function request(
  body = JSON.stringify({ schemaVersion: 1, records: [record] }),
  extraHeaders: Record<string, string | null> = {}
) {
  const headers: Record<string, string | null> = {
    origin: 'https://app.example.com',
    'content-type': 'application/json',
    ...extraHeaders,
  };
  const data = new TextEncoder().encode(body);
  let read = false;
  return {
    url: 'https://app.example.com/api/playback-quality',
    headers: { get: (name: string) => headers[name] || null },
    body: {
      getReader: () => ({
        read: async () =>
          read ? { done: true } : ((read = true), { done: false, value: data }),
        releaseLock: jest.fn(),
        cancel: async () => undefined,
      }),
    },
  } as unknown as NextRequest;
}

describe('playback quality POST', () => {
  let userNumber = 0;
  let POST: typeof import('./route')['POST'];
  const auth = jest.mocked(getAuthInfoFromCookie);
  const save = jest.mocked(savePlaybackQuality);
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ POST } = require('./route'));
  });
  beforeEach(() => {
    jest.clearAllMocks();
    auth.mockResolvedValue({
      version: 2,
      username: `user-${++userNumber}`,
      role: 'user',
      issuedAt: 1,
    });
    save.mockResolvedValue('saved');
  });
  it('accepts ordinary authenticated users and derives the owner from their cookie', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith(
      { marker: 'env' },
      expect.stringMatching(/^user-/),
      [record]
    );
  });
  it('rejects missing authentication', async () => {
    auth.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });
  it('compares Origin to the actual Host when Next uses an internal URL host', async () => {
    const req = request(undefined, {
      host: 'preview.example.com',
      origin: 'https://preview.example.com',
      'sec-fetch-site': 'same-origin',
    });
    expect((await POST(req)).status).toBe(200);
    expect(
      (
        await POST(
          request(undefined, {
            host: 'preview.example.com',
            origin: 'https://evil.example',
          })
        )
      ).status
    ).toBe(403);
  });
  it('accepts signed single-user local-storage sessions without a username', async () => {
    auth.mockResolvedValue({ version: 2, role: 'user', issuedAt: 1 });
    save.mockResolvedValue('no-d1');
    expect((await POST(request())).status).toBe(202);
    expect(save).toHaveBeenCalledWith({ marker: 'env' }, 'local-owner', [
      record,
    ]);
  });
  it('rejects cross-site and opaque origins even if the caller supplies a cookie', async () => {
    expect(
      (await POST(request(undefined, { origin: 'https://evil.example' })))
        .status
    ).toBe(403);
    expect((await POST(request(undefined, { origin: 'null' }))).status).toBe(
      403
    );
    expect(
      (await POST(request(undefined, { 'sec-fetch-site': 'cross-site' })))
        .status
    ).toBe(403);
    expect((await POST(request(undefined, { origin: null }))).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });
  it('accepts a same-origin fetch without Origin only with same-origin fetch metadata', async () => {
    expect(
      (
        await POST(
          request(undefined, { origin: null, 'sec-fetch-site': 'same-origin' })
        )
      ).status
    ).toBe(200);
  });
  it('checks the actual byte count rather than trusting Content-Length', async () => {
    expect(
      (
        await POST(
          request(' '.repeat(16 * 1024 + 1), { 'content-length': '1' })
        )
      ).status
    ).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON, unknown fields, inconsistent state and oversized batches', async () => {
    for (const body of [
      '{',
      JSON.stringify({
        schemaVersion: 1,
        records: [{ ...record, owner: 'someone' }],
      }),
      JSON.stringify({
        schemaVersion: 1,
        records: [{ ...record, status: 'terminal' }],
      }),
      JSON.stringify({ schemaVersion: 1, records: Array(5).fill(record) }),
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(save).not.toHaveBeenCalled();
  });
  it('does not accept media-ready as a first-frame outcome', async () => {
    const body = JSON.stringify({
      schemaVersion: 1,
      records: [{ ...record, status: 'terminal', outcome: 'frame-ready' }],
    });
    expect((await POST(request(body))).status).toBe(400);
  });
  it('keeps missing D1 and missing migrations nonblocking', async () => {
    save.mockResolvedValue('no-d1');
    const missing = await POST(request());
    expect(missing.status).toBe(202);
    expect(await missing.json()).toEqual({
      saved: false,
      skipped: true,
      reason: 'no-d1',
    });
    save.mockRejectedValue(new Error('no such table'));
    const failed = await POST(request());
    expect(failed.status).toBe(202);
    expect(await failed.json()).toEqual({
      saved: false,
      skipped: true,
      reason: 'storage-unavailable',
    });
  });
  it('returns 429 for atomic daily storage quotas', async () => {
    save.mockResolvedValue('quota');
    expect((await POST(request())).status).toBe(429);
  });
  it('bounds repeated requests for one account within a minute', async () => {
    auth.mockResolvedValue({
      version: 2,
      username: 'burst-user',
      role: 'user',
      issuedAt: 1,
    });
    for (let index = 0; index < 120; index += 1)
      expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(429);
    expect(save).toHaveBeenCalledTimes(120);
  });
});
