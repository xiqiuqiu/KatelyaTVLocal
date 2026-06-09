import { isAdminRequest } from '@/lib/admin-auth';
import { getConfig } from '@/lib/config';
import { listPlaybackDebugLogs } from '@/lib/playback-debug/logs';

class MockResponse {
  status: number;
  headers: Record<string, string>;

  constructor(
    private readonly payload: unknown,
    init?: { status?: number; headers?: Record<string, string> }
  ) {
    this.status = init?.status ?? 200;
    this.headers = init?.headers || {};
  }

  async json(): Promise<unknown> {
    return this.payload;
  }
}

let GET: (request: { url: string }) => Promise<MockResponse>;

jest.mock('next/server', () => ({
  NextResponse: {
    json: (
      payload: unknown,
      init?: { status?: number; headers?: Record<string, string> }
    ) => new MockResponse(payload, init),
  },
}));

jest.mock('@/lib/admin-auth', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

jest.mock('@/lib/playback-debug/logs', () => ({
  listPlaybackDebugLogs: jest.fn(),
}));

jest.mock(
  '@cloudflare/next-on-pages',
  () => ({
    getOptionalRequestContext: jest.fn(() => ({
      env: { DB: { prepare: jest.fn() } },
    })),
  }),
  { virtual: true }
);

describe('admin playback debug route', () => {
  const mockedIsAdminRequest =
    isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
  const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
  const mockedListPlaybackDebugLogs =
    listPlaybackDebugLogs as jest.MockedFunction<typeof listPlaybackDebugLogs>;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET } = require('@/app/api/admin/playback-debug/route'));
  });

  beforeEach(() => {
    mockedIsAdminRequest.mockResolvedValue(true);
    mockedGetConfig.mockResolvedValue({
      SiteConfig: {
        PlaybackDebugEnabled: true,
      },
    } as Awaited<ReturnType<typeof getConfig>>);
    mockedListPlaybackDebugLogs.mockResolvedValue([
      {
        id: 'log-1',
        sessionId: 'session-1',
        eventType: 'native-stall',
        sourceKey: 'ruyi:38961',
        playbackUrl: 'https://example.com/video.m3u8',
        playbackDomain: 'example.com',
        title: '鬼泣',
        runtime: 'native-hls',
        playlistFilter: 'proxy-observe',
        segmentMode: 'direct',
        recoveryProfile: 'native-video',
        currentTime: 438.2,
        duration: null,
        readyState: 2,
        networkState: 2,
        paused: false,
        ended: false,
        details: { action: 'reload-source' },
        userAgent: 'iPad Chrome',
        createdAt: 1780066860058,
      },
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects non-admin users', async () => {
    mockedIsAdminRequest.mockResolvedValue(false);

    const response = await GET({
      url: 'https://app.example.com/api/admin/playback-debug',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mockedListPlaybackDebugLogs).not.toHaveBeenCalled();
  });

  it('returns latest playback debug logs for admins', async () => {
    const response = await GET({
      url: 'https://app.example.com/api/admin/playback-debug?limit=50',
    });

    expect(response.status).toBe(200);
    expect(mockedListPlaybackDebugLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        DB: expect.any(Object),
      }),
      50
    );
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      logs: [
        expect.objectContaining({
          id: 'log-1',
          eventType: 'native-stall',
          currentTime: 438.2,
        }),
      ],
    });
  });
});
