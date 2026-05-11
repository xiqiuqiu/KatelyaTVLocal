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

    await expect(parseSessionCookieValue(tampered, 'signing-secret')).resolves.toBeNull();
  });
});
