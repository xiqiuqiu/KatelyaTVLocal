function mockFavoritesResponse(favorites: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(favorites),
  });
}

function loadFavoritesClient(): {
  getAllFavorites: () => Promise<Record<string, unknown>>;
  isFavorited: (source: string, id: string) => Promise<boolean>;
} {
  return require('./db.client');
}

describe('db.client favorites cache', () => {
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

  it('dedupes concurrent favorite status reads while cache is empty', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        await mockFavoritesResponse({
          'source-a+1': {
            title: '示例影片',
            source_name: '测试源',
            year: '2026',
            cover: 'https://example.com/poster.jpg',
            total_episodes: 12,
            save_time: 1,
          },
        })
      );
    global.fetch = fetchMock;

    const { isFavorited } = loadFavoritesClient();

    const [first, second, third] = await Promise.all([
      isFavorited('source-a', '1'),
      isFavorited('source-a', '2'),
      isFavorited('source-a', '3'),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(third).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/favorites');
  });

  it('dedupes background refreshes when cached favorites are available', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        await mockFavoritesResponse({
          'source-a+1': {
            title: '示例影片',
            source_name: '测试源',
            year: '2026',
            cover: 'https://example.com/poster.jpg',
            total_episodes: 12,
            save_time: 1,
          },
        })
      )
      .mockResolvedValue(
        await mockFavoritesResponse({
          'source-a+1': {
            title: '示例影片',
            source_name: '测试源',
            year: '2026',
            cover: 'https://example.com/poster.jpg',
            total_episodes: 12,
            save_time: 1,
          },
        })
      );
    global.fetch = fetchMock;

    const { getAllFavorites, isFavorited } = loadFavoritesClient();
    await getAllFavorites();
    fetchMock.mockClear();

    const [first, second, third] = await Promise.all([
      isFavorited('source-a', '1'),
      isFavorited('source-a', '2'),
      isFavorited('source-a', '3'),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(third).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/favorites');
  });
});
