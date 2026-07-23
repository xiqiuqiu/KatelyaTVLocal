import { recordLoginResult, validateLoginSecurity } from './security';

interface LoginEvent {
  attempt_key: string;
  success: number;
  created_at: number;
}

function createDb(events: LoginEvent[] = []) {
  const state = { events: [...events] };

  return {
    state,
    prepare: jest.fn((query: string) => ({
      bind: (...values: unknown[]) => ({
        first: async () => {
          if (query.includes('COUNT(*)')) {
            const [attemptKey, since] = values;
            return {
              count: state.events.filter(
                (event) =>
                  event.attempt_key === attemptKey &&
                  event.success === 0 &&
                  event.created_at >= Number(since)
              ).length,
            };
          }

          return null;
        },
        run: async () => {
          if (query.includes('DELETE FROM login_security_events')) {
            const [attemptKey] = values;
            state.events = state.events.filter(
              (event) => event.attempt_key !== attemptKey
            );
          }

          if (query.includes('INSERT INTO login_security_events')) {
            const [attemptKey, success, createdAt] = values;
            state.events.push({
              attempt_key: String(attemptKey),
              success: Number(success),
              created_at: Number(createdAt),
            });
          }

          return { meta: { changes: 1 } };
        },
      }),
    })),
  };
}

const baseEnv = {
  LOGIN_TURNSTILE_REQUIRED: 'false',
  LOGIN_RATE_WINDOW_SECONDS: '900',
  LOGIN_RATE_WINDOW_LIMIT: '5',
};

describe('login security', () => {
  it('requires Turnstile before checking the distributed attempt budget', async () => {
    const db = createDb();

    await expect(
      validateLoginSecurity({
        username: 'alice',
        ip: '203.0.113.10',
        env: {
          ...baseEnv,
          LOGIN_TURNSTILE_REQUIRED: 'true',
          TURNSTILE_SECRET_KEY: 'secret',
          DB: db,
        },
        fetchImpl: jest.fn(),
      })
    ).resolves.toEqual({
      ok: false,
      status: 400,
      error: '请先完成人机验证',
    });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('allows optional Turnstile without a token', async () => {
    const db = createDb();

    await expect(
      validateLoginSecurity({
        username: 'alice',
        ip: '203.0.113.10',
        env: { ...baseEnv, DB: db },
      })
    ).resolves.toMatchObject({ ok: true, status: 200 });
  });

  it('blocks the sixth failed credential attempt in its configured window', async () => {
    const db = createDb();
    const input = {
      username: 'Alice',
      ip: '203.0.113.10',
      env: { ...baseEnv, DB: db },
      now: 1_000_000,
    };

    for (let index = 0; index < 5; index += 1) {
      const result = await validateLoginSecurity(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        await recordLoginResult({
          attemptKey: result.attemptKey,
          success: false,
          env: input.env,
          now: input.now + index,
        });
      }
    }

    await expect(validateLoginSecurity(input)).resolves.toEqual({
      ok: false,
      status: 429,
      error: '登录尝试过于频繁，请稍后再试',
    });
  });

  it('expires failures outside the configured window', async () => {
    const db = createDb([
      {
        attempt_key: 'unused',
        success: 0,
        created_at: 0,
      },
    ]);
    const input = {
      username: 'alice',
      ip: '203.0.113.10',
      env: {
        ...baseEnv,
        LOGIN_RATE_WINDOW_SECONDS: '60',
        LOGIN_RATE_WINDOW_LIMIT: '1',
        DB: db,
      },
      now: 61_000,
    };

    const first = await validateLoginSecurity(input);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    db.state.events[0].attempt_key = first.attemptKey;

    await expect(validateLoginSecurity(input)).resolves.toMatchObject({
      ok: true,
      status: 200,
    });
  });

  it('clears prior failures after a successful login', async () => {
    const db = createDb();
    const input = {
      username: 'alice',
      ip: '203.0.113.10',
      env: { ...baseEnv, LOGIN_RATE_WINDOW_LIMIT: '1', DB: db },
      now: 1_000_000,
    };
    const validated = await validateLoginSecurity(input);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }

    await recordLoginResult({
      attemptKey: validated.attemptKey,
      success: false,
      env: input.env,
      now: input.now,
    });
    await recordLoginResult({
      attemptKey: validated.attemptKey,
      success: true,
      env: input.env,
      now: input.now + 1,
    });

    await expect(
      validateLoginSecurity({ ...input, now: input.now + 2 })
    ).resolves.toMatchObject({ ok: true, status: 200 });
    expect(db.state.events).toEqual([
      expect.objectContaining({
        attempt_key: validated.attemptKey,
        success: 1,
      }),
    ]);
  });

  it('persists only a stable hash derived from normalized IP and username', async () => {
    const db = createDb();
    const input = {
      username: 'Alice',
      ip: ' 203.0.113.10 ',
      env: { ...baseEnv, DB: db },
      now: 1_000_000,
    };
    const first = await validateLoginSecurity(input);
    const second = await validateLoginSecurity({
      ...input,
      username: 'alice',
      ip: '203.0.113.10',
    });

    expect(first).toMatchObject({ ok: true, status: 200 });
    expect(second).toMatchObject({ ok: true, status: 200 });
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.attemptKey).toBe(second.attemptKey);
    expect(first.attemptKey).toMatch(/^[a-f0-9]{64}$/);

    await recordLoginResult({
      attemptKey: first.attemptKey,
      success: false,
      env: input.env,
      now: input.now,
    });
    expect(db.state.events).toEqual([
      expect.objectContaining({
        attempt_key: first.attemptKey,
        success: 0,
      }),
    ]);
    expect(JSON.stringify(db.state.events)).not.toContain('Alice');
    expect(JSON.stringify(db.state.events)).not.toContain('203.0.113.10');
  });

  it('fails closed when the configured rate limiter has no D1 database', async () => {
    await expect(
      validateLoginSecurity({
        username: 'alice',
        ip: '203.0.113.10',
        env: baseEnv,
      })
    ).resolves.toEqual({
      ok: false,
      status: 500,
      error: '登录安全存储未配置',
    });
  });
});
