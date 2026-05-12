import {
  hashPassword,
  isLegacyPlaintextPassword,
  verifyPassword,
} from './password';

describe('password security helpers', () => {
  it('hashes and verifies a password', async () => {
    const hashed = await hashPassword('secret-123');

    expect(hashed).not.toBe('secret-123');
    expect(hashed.startsWith('pbkdf2_sha256$')).toBe(true);
    await expect(verifyPassword(hashed, 'secret-123')).resolves.toBe(true);
    await expect(verifyPassword(hashed, 'wrong')).resolves.toBe(false);
  });

  it('detects legacy plaintext values', () => {
    expect(isLegacyPlaintextPassword('plain-text')).toBe(true);
    expect(
      isLegacyPlaintextPassword(
        'pbkdf2_sha256$100000$c29tZXNhbHQ=$c29tZWhhc2g='
      )
    ).toBe(false);
  });
});
