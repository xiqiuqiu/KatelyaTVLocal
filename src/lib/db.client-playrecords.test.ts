function mockPlayRecordsResponse(records: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(records),
  });
}

function loadPlayRecordsClient(): {
  getAllPlayRecords: () => Promise<Record<string, unknown>>;
  getRecentPlayRecords: (limit: number) => Promise<Record<string, unknown>>;
  savePlayRecord: (
    source: string,
    id: string,
    record: import('./db.client').PlayRecord
  ) => Promise<void>;
} {
  return require('./db.client');
}

describe('db.client play records cache', () => {
  beforeEach(() => {
    jest.resetModules();
    window.localStorage.clear();
    window.RUNTIME_CONFIG = {
      STORAGE_TYPE: 'd1',
      CURRENT_USER: { username: 'admin', role: 'owner' },
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
    window.RUNTIME_CONFIG = undefined;
  });

  it('dedupes concurrent recent play record reads while cache is empty', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      await mockPlayRecordsResponse({
        'source-a+1': {
          title: '示例影片',
          source_name: '测试源',
          year: '2026',
          cover: 'https://example.com/poster.jpg',
          index: 1,
          total_episodes: 12,
          play_time: 60,
          total_time: 1800,
          save_time: 1,
        },
      })
    );
    global.fetch = fetchMock;

    const { getRecentPlayRecords } = loadPlayRecordsClient();

    const [first, second, third] = await Promise.all([
      getRecentPlayRecords(50),
      getRecentPlayRecords(50),
      getRecentPlayRecords(50),
    ]);

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/playrecords?limit=50');
  });

  it('does not let stale background refresh overwrite a play record mutation', async () => {
    const initialRecords = {
      'source-a+1': {
        title: '旧记录',
        source_name: '测试源',
        year: '2026',
        cover: '',
        index: 1,
        total_episodes: 12,
        play_time: 60,
        total_time: 1800,
        save_time: 1,
      },
    };
    const staleRecords = {
      'source-a+1': {
        ...initialRecords['source-a+1'],
        title: '旧记录',
        play_time: 60,
      },
    };
    let resolveRefresh: (value: unknown) => void = () => undefined;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(await mockPlayRecordsResponse(initialRecords))
      .mockReturnValueOnce(refreshPromise)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      .mockResolvedValue(
        await mockPlayRecordsResponse({
          'source-a+1': {
            ...initialRecords['source-a+1'],
            title: '新记录',
            play_time: 120,
            save_time: 2,
          },
        })
      );
    global.fetch = fetchMock;

    const { getAllPlayRecords, getRecentPlayRecords, savePlayRecord } =
      loadPlayRecordsClient();
    await getAllPlayRecords();

    const refresh = getRecentPlayRecords(50);
    await savePlayRecord('source-a', '1', {
      title: '新记录',
      source_name: '测试源',
      year: '2026',
      cover: '',
      index: 1,
      total_episodes: 12,
      play_time: 120,
      total_time: 1800,
      save_time: 2,
    });
    resolveRefresh(await mockPlayRecordsResponse(staleRecords));
    await refresh;

    expect(await getAllPlayRecords()).toMatchObject({
      'source-a+1': {
        title: '新记录',
        play_time: 120,
      },
    });
  });
});
