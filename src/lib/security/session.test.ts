import { createHmac } from 'crypto';

import { createSessionCookieValue, parseSessionCookieValue } from './session';

describe('session helpers', () => {
  it('creates and parses a signed session payload', async () => {
    const cookie = await createSessionCookieValue(
      { username: 'alice', role: 'admin' },
      'signing-secret'
    );

    const parsed = await parseSessionCookieValue(cookie, 'signing-secret');

    expect(parsed?.username).toBe('alice');
    expect(parsed?.role).toBe('admin');
    expect(parsed?.version).toBe(2);
  });

  it('rejects a tampered session payload', async () => {
    const cookie = await createSessionCookieValue(
      { username: 'alice', role: 'user' },
      'signing-secret'
    );

    const decoded = JSON.parse(decodeURIComponent(cookie));
    decoded.payload.role = 'owner';
    const tampered = encodeURIComponent(JSON.stringify(decoded));

    await expect(
      parseSessionCookieValue(tampered, 'signing-secret')
    ).resolves.toBeNull();
  });
});

describe('session expiry', () => {
  const day = 24 * 60 * 60 * 1000;
  afterEach(() => jest.restoreAllMocks());
  it.each([7, 30])(
    'accepts a %i-day session only before its signed expiry',
    async (days) => {
      const now = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
      const value = await createSessionCookieValue(
        { username: 'alice', role: 'user', expiresAt: now + days * day },
        'secret'
      );
      clock.mockReturnValue(now + days * day - 1);
      expect(await parseSessionCookieValue(value, 'secret')).not.toBeNull();
      clock.mockReturnValue(now + days * day);
      expect(await parseSessionCookieValue(value, 'secret')).toBeNull();
    }
  );
  it('keeps an existing signed login valid for its original seven days', async () => {
    const now = Date.now();
    const payload = {
      version: 2,
      username: 'alice',
      role: 'user',
      issuedAt: now,
    };
    const signature = createHmac('sha256', 'secret')
      .update(JSON.stringify(payload))
      .digest('hex');
    const cookie = encodeURIComponent(JSON.stringify({ payload, signature }));
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 7 * day - 1);
    expect(await parseSessionCookieValue(cookie, 'secret')).not.toBeNull();
    clock.mockReturnValue(now + 7 * day);
    expect(await parseSessionCookieValue(cookie, 'secret')).toBeNull();
  });
});
