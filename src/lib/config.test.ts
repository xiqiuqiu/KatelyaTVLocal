import type { AdminConfig } from './admin.types';

const baseConfig = (): AdminConfig => ({
  SiteConfig: {
    SiteName: 'Database Site',
    Announcement: 'Database announcement',
    SearchDownstreamMaxPage: 3,
    SiteInterfaceCacheTime: 180,
    ImageProxy: '',
    DoubanProxy: '',
    PlaybackDebugEnabled: false,
  },
  UserConfig: {
    AllowRegister: false,
    Users: [{ username: 'owner', role: 'owner' }],
  },
  SourceConfig: [
    {
      key: 'db-source',
      name: 'DB Source',
      api: 'https://db.example.com/api.php',
      from: 'custom',
      disabled: false,
    },
  ],
});

describe('D1 admin config cache', () => {
  const getAdminConfig = jest.fn();
  const setAdminConfig = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1000);

    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
    process.env.USERNAME = 'owner';
    process.env.SITE_NAME = 'Env Site';
    process.env.ANNOUNCEMENT = 'Env announcement';

    jest.doMock('@/lib/db', () => ({
      getStorage: () => ({
        getAdminConfig,
        setAdminConfig,
      }),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    delete process.env.USERNAME;
    delete process.env.SITE_NAME;
    delete process.env.ANNOUNCEMENT;
  });

  it('reuses D1 admin config within the edge TTL and returns isolated copies', async () => {
    getAdminConfig.mockResolvedValue(baseConfig());

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getConfig } = require('./config');

    const first = await getConfig();
    first.SiteConfig.SiteName = 'Mutated locally';
    const second = await getConfig();

    expect(getAdminConfig).toHaveBeenCalledTimes(1);
    expect(second.SiteConfig.SiteName).toBe('Env Site');
  });

  it('reloads D1 admin config after explicit invalidation', async () => {
    getAdminConfig.mockResolvedValueOnce(baseConfig()).mockResolvedValueOnce({
      ...baseConfig(),
      SiteConfig: {
        ...baseConfig().SiteConfig,
        SearchDownstreamMaxPage: 8,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getConfig, invalidateAdminConfigCache } = require('./config');

    await getConfig();
    invalidateAdminConfigCache();
    const reloaded = await getConfig();

    expect(getAdminConfig).toHaveBeenCalledTimes(2);
    expect(reloaded.SiteConfig.SearchDownstreamMaxPage).toBe(8);
  });

  it('reloads D1 admin config after the edge TTL expires', async () => {
    getAdminConfig.mockResolvedValueOnce(baseConfig()).mockResolvedValueOnce({
      ...baseConfig(),
      SiteConfig: {
        ...baseConfig().SiteConfig,
        SearchDownstreamMaxPage: 6,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getConfig } = require('./config');

    await getConfig();
    jest.spyOn(Date, 'now').mockReturnValue(61001);
    const reloaded = await getConfig();

    expect(getAdminConfig).toHaveBeenCalledTimes(2);
    expect(reloaded.SiteConfig.SearchDownstreamMaxPage).toBe(6);
  });
});
