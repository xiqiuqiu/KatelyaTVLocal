import {
  AUTH_AUDIT_UNKNOWN_USERNAME,
  listAuthAuditEvents,
  purgeExpiredAuthAuditEvents,
  recordAuthAuditEvent,
} from './events';

interface AuthAuditRow {
  id: number;
  event_type: string;
  username: string;
  failure_reason: string | null;
  ip_redacted: string | null;
  device_class: string | null;
  created_at: number;
}

function createDb(rows: AuthAuditRow[] = []) {
  const state = { rows: [...rows], nextId: rows.length + 1 };

  return {
    state,
    prepare: jest.fn((query: string) => ({
      bind: (...values: unknown[]) => ({
        all: async () => {
          if (!query.includes('FROM auth_audit_events')) {
            return { results: [] };
          }

          let filtered = [...state.rows];
          let valueIndex = 0;

          if (query.includes('username = ?')) {
            const username = String(values[valueIndex++]);
            filtered = filtered.filter((row) => row.username === username);
          }
          if (query.includes('event_type = ?')) {
            const eventType = String(values[valueIndex++]);
            filtered = filtered.filter((row) => row.event_type === eventType);
          }
          if (query.includes('created_at >= ?')) {
            const from = Number(values[valueIndex++]);
            filtered = filtered.filter((row) => row.created_at >= from);
          }
          if (query.includes('created_at <= ?')) {
            const to = Number(values[valueIndex++]);
            filtered = filtered.filter((row) => row.created_at <= to);
          }

          const limit = Number(values[valueIndex] ?? 100);
          filtered.sort((a, b) => b.created_at - a.created_at || b.id - a.id);

          return { results: filtered.slice(0, limit) };
        },
        run: async () => {
          if (query.includes('INSERT INTO auth_audit_events')) {
            const [
              eventType,
              username,
              failureReason,
              ipRedacted,
              deviceClass,
              createdAt,
            ] = values;
            state.rows.push({
              id: state.nextId++,
              event_type: String(eventType),
              username: String(username),
              failure_reason:
                failureReason == null ? null : String(failureReason),
              ip_redacted: ipRedacted == null ? null : String(ipRedacted),
              device_class: deviceClass == null ? null : String(deviceClass),
              created_at: Number(createdAt),
            });
            return { meta: { changes: 1 } };
          }

          if (query.includes('DELETE FROM auth_audit_events')) {
            const cutoff = Number(values[0]);
            const before = state.rows.length;
            state.rows = state.rows.filter((row) => row.created_at >= cutoff);
            return { meta: { changes: before - state.rows.length } };
          }

          return { meta: { changes: 0 } };
        },
      }),
    })),
  };
}

describe('auth audit events', () => {
  it('records a login_success with redacted IP and coarse device class', async () => {
    const db = createDb();

    await expect(
      recordAuthAuditEvent({
        eventType: 'login_success',
        username: 'alice',
        ip: '203.0.113.45',
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        now: 1_700_000_000_000,
        env: { DB: db },
      })
    ).resolves.toEqual({ recorded: true });

    expect(db.state.rows).toEqual([
      expect.objectContaining({
        event_type: 'login_success',
        username: 'alice',
        failure_reason: null,
        ip_redacted: '203.0.113.0/24',
        device_class: 'desktop',
        created_at: 1_700_000_000_000,
      }),
    ]);
    expect(JSON.stringify(db.state.rows)).not.toMatch(/203\.0\.113\.45/);
    expect(JSON.stringify(db.state.rows)).not.toMatch(/Mozilla\/5\.0/);
  });

  it('records login_failure reasons without splitting user-not-found vs wrong-password', async () => {
    const db = createDb();

    for (const reason of [
      'turnstile_failure',
      'rate_limited',
      'invalid_credentials',
      'invalid_username',
    ] as const) {
      await recordAuthAuditEvent({
        eventType: 'login_failure',
        username: 'bob',
        failureReason: reason,
        ip: '198.51.100.9',
        userAgent: 'curl/8.0',
        now: 1_700_000_000_100,
        env: { DB: db },
      });
    }

    expect(db.state.rows.map((row) => row.failure_reason)).toEqual([
      'turnstile_failure',
      'rate_limited',
      'invalid_credentials',
      'invalid_username',
    ]);
    expect(
      db.state.rows.every((row) => row.event_type === 'login_failure')
    ).toBe(true);
  });

  it('uses a documented placeholder username when identity is missing or blank', async () => {
    const db = createDb();

    await recordAuthAuditEvent({
      eventType: 'login_failure',
      username: '   ',
      failureReason: 'invalid_username',
      ip: '2001:db8::1',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      now: 1_700_000_000_200,
      env: { DB: db },
    });

    expect(db.state.rows[0]).toEqual(
      expect.objectContaining({
        username: AUTH_AUDIT_UNKNOWN_USERNAME,
        ip_redacted: '2001:db8::/64',
        device_class: 'mobile',
      })
    );
  });

  it('lists events with username, time range, and event type filters', async () => {
    const db = createDb([
      {
        id: 1,
        event_type: 'login_success',
        username: 'alice',
        failure_reason: null,
        ip_redacted: '203.0.113.0/24',
        device_class: 'desktop',
        created_at: 100,
      },
      {
        id: 2,
        event_type: 'login_failure',
        username: 'alice',
        failure_reason: 'invalid_credentials',
        ip_redacted: '203.0.113.0/24',
        device_class: 'desktop',
        created_at: 200,
      },
      {
        id: 3,
        event_type: 'login_failure',
        username: 'bob',
        failure_reason: 'rate_limited',
        ip_redacted: '198.51.100.0/24',
        device_class: 'unknown',
        created_at: 300,
      },
    ]);

    await expect(
      listAuthAuditEvents({
        username: 'alice',
        eventType: 'login_failure',
        from: 150,
        to: 250,
        env: { DB: db },
      })
    ).resolves.toEqual({
      available: true,
      events: [
        expect.objectContaining({
          id: 2,
          eventType: 'login_failure',
          username: 'alice',
          failureReason: 'invalid_credentials',
          createdAt: 200,
        }),
      ],
    });
  });

  it('does not throw when D1 is missing and reports list as unavailable', async () => {
    await expect(
      recordAuthAuditEvent({
        eventType: 'login_success',
        username: 'alice',
        ip: '203.0.113.1',
      })
    ).resolves.toEqual({ recorded: false });

    await expect(listAuthAuditEvents({ username: 'alice' })).resolves.toEqual({
      available: false,
      reason: 'd1_unavailable',
    });
  });

  it('does not throw when D1 insert fails', async () => {
    const db = {
      prepare: jest.fn(() => ({
        bind: () => ({
          run: async () => {
            throw new Error('D1 write failed');
          },
        }),
      })),
    };
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      recordAuthAuditEvent({
        eventType: 'login_success',
        username: 'alice',
        ip: '203.0.113.1',
        env: { DB: db },
      })
    ).resolves.toEqual({ recorded: false });

    consoleError.mockRestore();
  });

  it('purges events older than 90 days', async () => {
    const now = 1_700_000_000_000;
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const db = createDb([
      {
        id: 1,
        event_type: 'login_success',
        username: 'alice',
        failure_reason: null,
        ip_redacted: '203.0.113.0/24',
        device_class: 'desktop',
        created_at: now - ninetyDaysMs - 1,
      },
      {
        id: 2,
        event_type: 'login_success',
        username: 'bob',
        failure_reason: null,
        ip_redacted: '198.51.100.0/24',
        device_class: 'desktop',
        created_at: now - ninetyDaysMs + 10_000,
      },
    ]);

    await expect(
      purgeExpiredAuthAuditEvents({ now, env: { DB: db } })
    ).resolves.toEqual({ available: true, deleted: 1 });

    expect(db.state.rows.map((row) => row.id)).toEqual([2]);
  });
});
