import { checkAndConsumeAiFindQuota } from './usage-quota';

function createFakeD1() {
  const rows = new Map<string, number>();

  return {
    rows,
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];

        return {
          bind(...nextValues: unknown[]) {
            values = nextValues;
            return this;
          },
          async first<T>() {
            const [scope, subject, dayKey] = values as string[];
            const key = `${scope}|${subject}|${dayKey}`;
            const count = rows.get(key);
            return (count === undefined ? null : { count }) as T | null;
          },
          async run() {
            if (/UPDATE ai_find_usage_daily/.test(sql)) {
              const [, scope, subject, dayKey] = values as string[];
              const key = `${scope}|${subject}|${dayKey}`;
              rows.set(key, Math.max(0, (rows.get(key) || 0) - 1));
              return { meta: { changes: 1 } };
            }

            if (!/INSERT INTO ai_find_usage_daily/.test(sql)) {
              return { meta: { changes: 1 } };
            }

            const [scope, subject, dayKey, , limit] = values as [
              string,
              string,
              string,
              number,
              number
            ];
            const key = `${scope}|${subject}|${dayKey}`;
            const count = rows.get(key) || 0;
            if (count >= limit) {
              return { meta: { changes: 0 } };
            }
            rows.set(key, count + 1);
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  };
}

const quotaConfig = {
  dailyLimitPerUser: 2,
  dailyLimitPerIp: 3,
  dailyLimitGlobal: 10,
  groupDailyLimitPerUser: 4,
  groupDailyLimitPerIp: 6,
  groupDailyLimitGlobal: 20,
};

describe('AI find D1 usage quota', () => {
  it('allows and consumes per-user daily quota', async () => {
    const fake = createFakeD1();

    await expect(
      checkAndConsumeAiFindQuota({
        username: 'alice',
        ip: '203.0.113.10',
        endpoint: 'find',
        config: quotaConfig,
        now: Date.UTC(2026, 4, 21, 1),
        env: { DB: fake.DB },
      })
    ).resolves.toMatchObject({
      allowed: true,
      remaining: {
        user: 1,
      },
    });

    await expect(
      checkAndConsumeAiFindQuota({
        username: 'alice',
        ip: '203.0.113.10',
        endpoint: 'find',
        config: quotaConfig,
        now: Date.UTC(2026, 4, 21, 2),
        env: { DB: fake.DB },
      })
    ).resolves.toMatchObject({
      allowed: true,
      remaining: {
        user: 0,
      },
    });

    await expect(
      checkAndConsumeAiFindQuota({
        username: 'alice',
        ip: '203.0.113.10',
        endpoint: 'find',
        config: quotaConfig,
        now: Date.UTC(2026, 4, 21, 3),
        env: { DB: fake.DB },
      })
    ).resolves.toMatchObject({
      allowed: false,
      status: 429,
      reason: 'user-limit',
    });
  });

  it('keeps group endpoint quota separate from model endpoint quota', async () => {
    const fake = createFakeD1();

    for (let index = 0; index < quotaConfig.groupDailyLimitPerUser; index++) {
      await expect(
        checkAndConsumeAiFindQuota({
          username: 'alice',
          ip: '203.0.113.10',
          endpoint: 'group',
          config: quotaConfig,
          now: Date.UTC(2026, 4, 21, 1),
          env: { DB: fake.DB },
        })
      ).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(
      checkAndConsumeAiFindQuota({
        username: 'alice',
        ip: '203.0.113.10',
        endpoint: 'group',
        config: quotaConfig,
        now: Date.UTC(2026, 4, 21, 1),
        env: { DB: fake.DB },
      })
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'user-limit',
    });

    await expect(
      checkAndConsumeAiFindQuota({
        username: 'alice',
        ip: '203.0.113.10',
        endpoint: 'find',
        config: quotaConfig,
        now: Date.UTC(2026, 4, 21, 1),
        env: { DB: fake.DB },
      })
    ).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('fails closed when D1 is unavailable', async () => {
    await expect(
      checkAndConsumeAiFindQuota({
        username: 'alice',
        ip: '203.0.113.10',
        endpoint: 'find',
        config: quotaConfig,
      })
    ).resolves.toMatchObject({
      allowed: false,
      status: 503,
      reason: 'missing-d1',
    });
  });

  it('blocks concurrent requests when only one user quota remains', async () => {
    const fake = createFakeD1();
    const limitedConfig = {
      ...quotaConfig,
      dailyLimitPerUser: 1,
    };

    const [first, second] = await Promise.all([
      checkAndConsumeAiFindQuota({
        username: 'alice',
        ip: '203.0.113.10',
        endpoint: 'find',
        config: limitedConfig,
        now: Date.UTC(2026, 4, 21, 1),
        env: { DB: fake.DB },
      }),
      checkAndConsumeAiFindQuota({
        username: 'alice',
        ip: '203.0.113.10',
        endpoint: 'find',
        config: limitedConfig,
        now: Date.UTC(2026, 4, 21, 1),
        env: { DB: fake.DB },
      }),
    ]);

    expect([first.allowed, second.allowed].sort()).toEqual([false, true]);
    const rejected = [first, second].find((result) => !result.allowed);
    expect(rejected).toMatchObject({
      status: 429,
      reason: 'user-limit',
      remaining: {
        user: 0,
      },
    });
    expect(
      fake.rows.get('ai-find:find:user|alice|2026-05-21')
    ).toBe(1);
    expect(
      fake.rows.get('ai-find:find:ip|203.0.113.10|2026-05-21')
    ).toBe(1);
    expect(fake.rows.get('ai-find:find:global|global|2026-05-21')).toBe(1);
  });
});
