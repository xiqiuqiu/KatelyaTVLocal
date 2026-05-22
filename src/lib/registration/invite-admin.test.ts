import {
  createRegistrationInvite,
  disableRegistrationInvite,
  listRegistrationInvites,
} from './invite-admin';

function createDb() {
  const rows: Record<string, unknown>[] = [];

  return {
    rows,
    prepare: jest.fn((query: string) => ({
      bind: (...values: unknown[]) => ({
        all: async () => ({ results: rows }),
        first: async () => null,
        run: async () => {
          if (query.includes('INSERT INTO registration_invites')) {
            const [code, maxUses, expiresAt, createdAt, updatedAt] = values;
            rows.unshift({
              code,
              max_uses: maxUses,
              used_count: 0,
              disabled: 0,
              expires_at: expiresAt,
              created_at: createdAt,
              updated_at: updatedAt,
            });
          }

          if (query.includes('UPDATE registration_invites')) {
            const [updatedAt, code] = values;
            const row = rows.find((item) => item.code === code);
            if (row) {
              row.disabled = 1;
              row.updated_at = updatedAt;
            }
          }

          return { meta: { changes: 1 } };
        },
      }),
    })),
  };
}

describe('registration invite admin', () => {
  it('creates, lists, and disables invites', async () => {
    const db = createDb();
    const now = 1779400000000;

    const invite = await createRegistrationInvite({
      env: { DB: db },
      now,
      code: 'test-code',
      maxUses: 2,
    });

    expect(invite).toMatchObject({
      code: 'TEST-CODE',
      maxUses: 2,
      usedCount: 0,
      disabled: false,
    });

    await expect(listRegistrationInvites({ env: { DB: db } })).resolves.toEqual(
      [invite]
    );

    await disableRegistrationInvite({
      env: { DB: db },
      code: 'test-code',
      now: now + 1,
    });

    await expect(listRegistrationInvites({ env: { DB: db } })).resolves.toEqual(
      [
        {
          ...invite,
          disabled: true,
          updatedAt: now + 1,
        },
      ]
    );
  });
});
