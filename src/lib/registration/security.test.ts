import {
  recordSuccessfulRegistration,
  validateRegistrationSecurity,
} from './security';

interface Invite {
  code: string;
  max_uses: number;
  used_count: number;
  disabled: number;
  expires_at: number | null;
}

function createDb({
  invites = [],
  audit = [],
}: {
  invites?: Invite[];
  audit?: Array<{ username: string; ip: string; created_at: number }>;
}) {
  const state = {
    invites: new Map(invites.map((invite) => [invite.code, { ...invite }])),
    audit: [...audit],
  };

  return {
    state,
    prepare: jest.fn((query: string) => ({
      bind: (...values: unknown[]) => ({
        first: async () => {
          if (query.includes('FROM registration_invites')) {
            return state.invites.get(String(values[0])) || null;
          }

          if (query.includes('FROM registration_audit')) {
            const [ip, since] = values;
            return {
              count: state.audit.filter(
                (row) =>
                  row.ip === ip && row.created_at >= Number(since)
              ).length,
            };
          }

          return null;
        },
        run: async () => {
          if (query.includes('UPDATE registration_invites')) {
            const [updatedAt, code, now] = values;
            const invite = state.invites.get(String(code));
            if (
              !invite ||
              invite.disabled ||
              invite.used_count >= invite.max_uses ||
              (invite.expires_at && invite.expires_at <= Number(now))
            ) {
              return { meta: { changes: 0 } };
            }
            invite.used_count += 1;
            state.invites.set(String(code), {
              ...invite,
              used_count: invite.used_count,
            });
            void updatedAt;
            return { meta: { changes: 1 } };
          }

          if (query.includes('INSERT INTO registration_audit')) {
            const [username, ip, createdAt] = values;
            state.audit.push({
              username: String(username),
              ip: String(ip),
              created_at: Number(createdAt),
            });
            return { meta: { changes: 1 } };
          }

          return { meta: { changes: 1 } };
        },
      }),
    })),
  };
}

const baseEnv = {
  REGISTER_TURNSTILE_REQUIRED: 'true',
  TURNSTILE_SECRET_KEY: 'secret',
  REGISTER_INVITE_REQUIRED: 'true',
  REGISTER_PASSWORD_MIN_LENGTH: '8',
  REGISTER_IP_WINDOW_SECONDS: '3600',
  REGISTER_IP_WINDOW_LIMIT: '3',
};

describe('registration security', () => {
  it('rejects registration without Turnstile token', async () => {
    const db = createDb({
      invites: [
        {
          code: 'invite-1',
          max_uses: 1,
          used_count: 0,
          disabled: 0,
          expires_at: null,
        },
      ],
    });

    await expect(
      validateRegistrationSecurity({
        username: 'alice',
        password: 'password123',
        ip: '203.0.113.10',
        inviteCode: 'invite-1',
        env: { ...baseEnv, DB: db },
        fetchImpl: jest.fn(),
      })
    ).resolves.toEqual({
      ok: false,
      status: 400,
      error: '请先完成人机验证',
    });
  });

  it('rejects invalid invite code', async () => {
    const db = createDb({ invites: [] });
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await expect(
      validateRegistrationSecurity({
        username: 'alice',
        password: 'password123',
        ip: '203.0.113.10',
        inviteCode: 'bad-code',
        turnstileToken: 'token',
        env: { ...baseEnv, DB: db },
        fetchImpl,
      })
    ).resolves.toEqual({
      ok: false,
      status: 400,
      error: '邀请码无效',
    });
  });

  it('rejects repeated use of a one-time invite code', async () => {
    const db = createDb({
      invites: [
        {
          code: 'invite-1',
          max_uses: 1,
          used_count: 0,
          disabled: 0,
          expires_at: null,
        },
      ],
    });
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const firstValidation = await validateRegistrationSecurity({
      username: 'alice',
      password: 'password123',
      ip: '203.0.113.10',
      inviteCode: 'invite-1',
      turnstileToken: 'token',
      env: { ...baseEnv, DB: db },
      fetchImpl,
      now: 1000,
    });
    expect(firstValidation.ok).toBe(true);

    await expect(
      recordSuccessfulRegistration({
        username: 'alice',
        password: 'password123',
        ip: '203.0.113.10',
        inviteCode: 'invite-1',
        turnstileToken: 'token',
        env: { ...baseEnv, DB: db },
        now: 1000,
      })
    ).resolves.toEqual({ ok: true, status: 200 });

    await expect(
      validateRegistrationSecurity({
        username: 'bob',
        password: 'password123',
        ip: '203.0.113.11',
        inviteCode: 'invite-1',
        turnstileToken: 'token',
        env: { ...baseEnv, DB: db },
        fetchImpl,
        now: 2000,
      })
    ).resolves.toEqual({
      ok: false,
      status: 400,
      error: '邀请码已被使用',
    });
  });

  it('rejects high-frequency registration from the same IP', async () => {
    const db = createDb({
      invites: [
        {
          code: 'invite-1',
          max_uses: 5,
          used_count: 0,
          disabled: 0,
          expires_at: null,
        },
      ],
      audit: [
        { username: 'a', ip: '203.0.113.10', created_at: 1000 },
        { username: 'b', ip: '203.0.113.10', created_at: 1100 },
        { username: 'c', ip: '203.0.113.10', created_at: 1200 },
      ],
    });
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await expect(
      validateRegistrationSecurity({
        username: 'd',
        password: 'password123',
        ip: '203.0.113.10',
        inviteCode: 'invite-1',
        turnstileToken: 'token',
        env: { ...baseEnv, DB: db },
        fetchImpl,
        now: 2000,
      })
    ).resolves.toEqual({
      ok: false,
      status: 429,
      error: '该网络注册过于频繁，请稍后再试',
    });
  });
});
