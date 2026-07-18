import type { EpisodeAdSkipConfig } from '@/lib/ad-skip-window';

function loadAdSkipClient(): {
  getAdSkipConfig: (
    source: string,
    id: string,
    episodeIndex: number
  ) => Promise<EpisodeAdSkipConfig | null>;
  saveAdSkipConfig: (
    source: string,
    id: string,
    episodeIndex: number,
    config: EpisodeAdSkipConfig
  ) => Promise<void>;
  recordAdSkipWindowConfirmation: (input: {
    source: string;
    id: string;
    episodeIndex: number;
    window: {
      startTimeSeconds: number;
      endTimeSeconds: number;
      ruleId?: string;
    };
    kind: 'confirm' | 'undo';
    nowMs?: number;
  }) => Promise<EpisodeAdSkipConfig | null>;
} {
  return require('./db.client');
}

const sampleConfig: EpisodeAdSkipConfig = {
  source: 'ruyi',
  id: '38961',
  episodeIndex: 0,
  updated_time: 1000,
  windows: [
    {
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      startTimeSeconds: 10,
      endTimeSeconds: 20,
      trustScore: 1,
      confirmCount: 1,
      undoCount: 0,
      updated_time: 1000,
      ruleId: 'user-mark',
      origin: 'persisted',
    },
  ],
};

describe('db.client ad skip windows', () => {
  beforeEach(() => {
    jest.resetModules();
    window.localStorage.clear();
    window.RUNTIME_CONFIG = undefined;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
    window.RUNTIME_CONFIG = undefined;
  });

  it('uses browser localStorage only in localstorage mode (self-only degradation)', async () => {
    window.RUNTIME_CONFIG = { STORAGE_TYPE: 'localstorage' };
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const { saveAdSkipConfig, getAdSkipConfig } = loadAdSkipClient();
    await saveAdSkipConfig('ruyi', '38961', 0, sampleConfig);
    const loaded = await getAdSkipConfig('ruyi', '38961', 0);

    expect(loaded).toEqual(sampleConfig);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem('katelyatv_ad_skip_configs')
    ).toContain('ruyi+38961+0');
  });

  it('reads and writes through the shared API in non-localstorage mode', async () => {
    window.RUNTIME_CONFIG = {
      STORAGE_TYPE: 'd1',
      CURRENT_USER: { username: 'alice', role: 'user' },
    };

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ config: sampleConfig }),
      });
    global.fetch = fetchMock;

    const { saveAdSkipConfig, getAdSkipConfig } = loadAdSkipClient();
    await saveAdSkipConfig('ruyi', '38961', 0, sampleConfig);
    const loaded = await getAdSkipConfig('ruyi', '38961', 0);

    expect(loaded).toEqual(sampleConfig);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ad-skip-windows',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'set',
          key: 'ruyi+38961+0',
          config: sampleConfig,
        }),
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ad-skip-windows',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'get',
          key: 'ruyi+38961+0',
        }),
      })
    );
  });

  it('records a confirm by merging into existing config without throwing on API failure', async () => {
    window.RUNTIME_CONFIG = {
      STORAGE_TYPE: 'd1',
      CURRENT_USER: { username: 'alice', role: 'user' },
    };

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ config: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });
    global.fetch = fetchMock;

    const { recordAdSkipWindowConfirmation } = loadAdSkipClient();
    const result = await recordAdSkipWindowConfirmation({
      source: 'ruyi',
      id: '38961',
      episodeIndex: 0,
      window: {
        startTimeSeconds: 10,
        endTimeSeconds: 20,
        ruleId: 'user-mark',
      },
      kind: 'confirm',
      nowMs: 5000,
    });

    // Optimistic local result still returned; save failure is swallowed.
    expect(result?.windows[0]).toMatchObject({
      confirmCount: 1,
      trustScore: 1,
    });
  });
});
