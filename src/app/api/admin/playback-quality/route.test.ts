import type { NextRequest } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { readPlaybackQualitySummary } from '@/lib/playback-quality.server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (
      payload: unknown,
      init?: { status?: number; headers?: Record<string, string> }
    ) => ({
      status: init?.status || 200,
      headers: init?.headers,
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
jest.mock('@/lib/admin-auth', () => ({ isAdminRequest: jest.fn() }));
jest.mock('@/lib/playback-quality.server', () => ({
  readPlaybackQualitySummary: jest.fn(),
}));

const request = (query = '') =>
  ({
    url: `https://app.example.com/api/admin/playback-quality${query}`,
  } as NextRequest);
describe('admin playback quality GET', () => {
  let GET: typeof import('./route')['GET'];
  const admin = jest.mocked(isAdminRequest);
  const read = jest.mocked(readPlaybackQualitySummary);
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET } = require('./route'));
  });
  beforeEach(() => {
    jest.clearAllMocks();
    admin.mockResolvedValue(true);
    read.mockResolvedValue({
      days: 7,
      timeZone: 'Asia/Taipei',
      groups: [],
      latency: [],
      sources: [],
    });
  });
  it('rejects ordinary users without querying D1', async () => {
    admin.mockResolvedValue(false);
    expect((await GET(request())).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });
  it('returns a no-store summary with explicit timezone', async () => {
    const response = await GET(request('?days=7'));
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledWith({ marker: 'env' }, 7);
    expect(await response.json()).toEqual({
      available: true,
      days: 7,
      timeZone: 'Asia/Taipei',
      groups: [],
      latency: [],
      sources: [],
    });
    expect(response.headers).toEqual({ 'Cache-Control': 'no-store' });
  });
  it.each(['0', '31', 'NaN', '1.5'])(
    'rejects unbounded or invalid day range %s',
    async (days) => {
      expect((await GET(request(`?days=${days}`))).status).toBe(400);
      expect(read).not.toHaveBeenCalled();
    }
  );
  it('reports unavailable storage without inventing a zero-success baseline', async () => {
    read.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      available: false,
      reason: 'no-d1',
    });
  });
  it('handles a deployment missing the migration', async () => {
    read.mockRejectedValue(new Error('missing table'));
    expect((await GET(request())).status).toBe(202);
  });
});
