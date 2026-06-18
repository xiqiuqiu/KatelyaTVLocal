import type { PlayRecord } from './types';

type FakeRedisClient = {
  store: Map<string, string>;
  sortedSets: Map<string, Map<string, number>>;
  connect: jest.Mock;
  del: jest.Mock;
  get: jest.Mock;
  keys: jest.Mock;
  mGet: jest.Mock;
  on: jest.Mock;
  set: jest.Mock;
  zAdd: jest.Mock;
  zRange: jest.Mock;
  zRem: jest.Mock;
  isOpen: boolean;
};

type FakeUpstashClient = {
  store: Map<string, unknown>;
  sortedSets: Map<string, Map<string, number>>;
  del: jest.Mock;
  get: jest.Mock;
  keys: jest.Mock;
  set: jest.Mock;
  zadd: jest.Mock;
  zrange: jest.Mock;
  zrem: jest.Mock;
};

function makeRecord(title: string, saveTime: number): PlayRecord {
  return {
    title,
    search_title: title,
    source_name: '测试源',
    year: '2026',
    cover: '',
    index: 1,
    total_episodes: 12,
    play_time: 60,
    total_time: 1800,
    save_time: saveTime,
  };
}

function matchPattern(key: string, pattern: string): boolean {
  return key.startsWith(pattern.replace('*', ''));
}

function createNodeRedisClient(): FakeRedisClient {
  const client: FakeRedisClient = {
    store: new Map(),
    sortedSets: new Map(),
    connect: jest.fn().mockResolvedValue(undefined),
    del: jest.fn(async (keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) {
        client.store.delete(key);
        client.sortedSets.delete(key);
      }
      return keyList.length;
    }),
    get: jest.fn(async (key: string) => client.store.get(key) ?? null),
    keys: jest.fn(async (pattern: string) =>
      Array.from(client.store.keys()).filter((key) =>
        matchPattern(key, pattern)
      )
    ),
    mGet: jest.fn(async (keys: string[]) =>
      keys.map((key) => client.store.get(key) ?? null)
    ),
    on: jest.fn(),
    set: jest.fn(async (key: string, value: string) => {
      client.store.set(key, value);
      return 'OK';
    }),
    zAdd: jest.fn(
      async (key: string, entry: { score: number; value: string }) => {
        const set = client.sortedSets.get(key) ?? new Map<string, number>();
        set.set(entry.value, entry.score);
        client.sortedSets.set(key, set);
        return 1;
      }
    ),
    zRange: jest.fn(async (key: string, start: number, stop: number) => {
      const set = client.sortedSets.get(key) ?? new Map<string, number>();
      const members = Array.from(set.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([member]) => member);
      return members.slice(start, stop + 1);
    }),
    zRem: jest.fn(async (key: string, member: string) => {
      client.sortedSets.get(key)?.delete(member);
      return 1;
    }),
    isOpen: true,
  };

  return client;
}

function createUpstashClient(): FakeUpstashClient {
  const client: FakeUpstashClient = {
    store: new Map(),
    sortedSets: new Map(),
    del: jest.fn(async (...keys: string[]) => {
      for (const key of keys) {
        client.store.delete(key);
        client.sortedSets.delete(key);
      }
      return keys.length;
    }),
    get: jest.fn(async (key: string) => client.store.get(key) ?? null),
    keys: jest.fn(async (pattern: string) =>
      Array.from(client.store.keys()).filter((key) =>
        matchPattern(key, pattern)
      )
    ),
    set: jest.fn(async (key: string, value: unknown) => {
      client.store.set(key, value);
      return 'OK';
    }),
    zadd: jest.fn(
      async (key: string, entry: { score: number; member: string }) => {
        const set = client.sortedSets.get(key) ?? new Map<string, number>();
        set.set(entry.member, entry.score);
        client.sortedSets.set(key, set);
        return 1;
      }
    ),
    zrange: jest.fn(async (key: string, start: number, stop: number) => {
      const set = client.sortedSets.get(key) ?? new Map<string, number>();
      const members = Array.from(set.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([member]) => member);
      return members.slice(start, stop + 1);
    }),
    zrem: jest.fn(async (key: string, member: string) => {
      client.sortedSets.get(key)?.delete(member);
      return 1;
    }),
  };

  return client;
}

function resetRedisGlobals(): void {
  const redisGlobal = global as Record<symbol, unknown>;
  delete redisGlobal[Symbol.for('__MOONTV_REDIS_CLIENT__')];
  delete redisGlobal[Symbol.for('__KATELYATV_REDIS_CLIENT__')];
}

describe('play record recent storage indexes', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    resetRedisGlobals();
    process.env.REDIS_URL = 'redis://example.test:6379';
  });

  afterEach(() => {
    resetRedisGlobals();
    jest.dontMock('redis');
    jest.dontMock('@upstash/redis');
  });

  it('uses Redis sorted-set index for recent play records without scanning every record', async () => {
    const client = createNodeRedisClient();
    jest.doMock('redis', () => ({
      createClient: jest.fn(() => client),
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RedisStorage } = require('./redis.db');
    const storage = new RedisStorage();

    await storage.setPlayRecord('alice', 'source-a+1', makeRecord('旧', 1));
    await storage.setPlayRecord('alice', 'source-b+2', makeRecord('新', 3));
    await storage.setPlayRecord('alice', 'source-c+3', makeRecord('中', 2));
    client.keys.mockClear();
    client.mGet.mockClear();

    await expect(storage.getRecentPlayRecords('alice', 2)).resolves.toEqual({
      'source-b+2': makeRecord('新', 3),
      'source-c+3': makeRecord('中', 2),
    });
    expect(client.zRange).toHaveBeenCalledWith(
      'u:alice:pr_recent_index',
      0,
      1,
      { REV: true }
    );
    expect(client.keys).not.toHaveBeenCalled();
    expect(client.mGet).toHaveBeenCalledWith([
      'u:alice:pr:source-b+2',
      'u:alice:pr:source-c+3',
    ]);
  });

  it('backfills Redis recent index when the index is empty', async () => {
    const client = createNodeRedisClient();
    jest.doMock('redis', () => ({
      createClient: jest.fn(() => client),
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RedisStorage } = require('./redis.db');
    const storage = new RedisStorage();
    client.store.set(
      'u:alice:pr:source-a+1',
      JSON.stringify(makeRecord('旧', 1))
    );
    client.store.set(
      'u:alice:pr:source-b+2',
      JSON.stringify(makeRecord('新', 3))
    );

    await expect(storage.getRecentPlayRecords('alice', 1)).resolves.toEqual({
      'source-b+2': makeRecord('新', 3),
    });
    expect(client.keys).toHaveBeenCalledWith('u:alice:pr:*');
    expect(client.zAdd).toHaveBeenCalledWith('u:alice:pr_recent_index', {
      score: 1,
      value: 'source-a+1',
    });
    expect(client.zAdd).toHaveBeenCalledWith('u:alice:pr_recent_index', {
      score: 3,
      value: 'source-b+2',
    });
    expect(client.set).toHaveBeenCalledWith(
      'u:alice:pr_recent_index_backfilled',
      '1'
    );
  });

  it('backfills Redis recent index when new writes created a partial index before migration', async () => {
    const client = createNodeRedisClient();
    jest.doMock('redis', () => ({
      createClient: jest.fn(() => client),
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RedisStorage } = require('./redis.db');
    const storage = new RedisStorage();
    client.store.set(
      'u:alice:pr:source-a+1',
      JSON.stringify(makeRecord('旧', 1))
    );
    await storage.setPlayRecord('alice', 'source-b+2', makeRecord('新', 3));
    client.keys.mockClear();

    await expect(storage.getRecentPlayRecords('alice', 2)).resolves.toEqual({
      'source-b+2': makeRecord('新', 3),
      'source-a+1': makeRecord('旧', 1),
    });
    expect(client.keys).toHaveBeenCalledWith('u:alice:pr:*');
  });

  it('uses Kvrocks sorted-set index for recent play records', async () => {
    const client = createNodeRedisClient();
    jest.doMock('redis', () => ({
      createClient: jest.fn(() => client),
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { KvrocksStorage } = require('./kvrocks.db');
    const storage = new KvrocksStorage();

    await storage.setPlayRecord('alice', 'source-a+1', makeRecord('旧', 1));
    await storage.setPlayRecord('alice', 'source-b+2', makeRecord('新', 3));
    client.keys.mockClear();

    await expect(storage.getRecentPlayRecords('alice', 1)).resolves.toEqual({
      'source-b+2': makeRecord('新', 3),
    });
    expect(client.zRange).toHaveBeenCalledWith(
      'u:alice:pr_recent_index',
      0,
      0,
      { REV: true }
    );
    expect(client.keys).not.toHaveBeenCalled();
  });

  it('uses Upstash sorted-set index for recent play records', async () => {
    const client = createUpstashClient();
    jest.doMock('@upstash/redis', () => ({
      Redis: jest.fn().mockImplementation(() => client),
    }));
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { UpstashRedisStorage } = require('./upstash.db');
    const storage = new UpstashRedisStorage();

    await storage.setPlayRecord('alice', 'source-a+1', makeRecord('旧', 1));
    await storage.setPlayRecord('alice', 'source-b+2', makeRecord('新', 3));
    client.keys.mockClear();

    await expect(storage.getRecentPlayRecords('alice', 1)).resolves.toEqual({
      'source-b+2': makeRecord('新', 3),
    });
    expect(client.zrange).toHaveBeenCalledWith(
      'u:alice:pr_recent_index',
      0,
      0,
      { rev: true }
    );
    expect(client.keys).not.toHaveBeenCalled();
  });
});
