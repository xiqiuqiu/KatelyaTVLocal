import { pbkdf2Sync } from 'node:crypto';

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
        'pbkdf2_sha256$120000$c29tZXNhbHQ=$c29tZWhhc2g='
      )
    ).toBe(false);
  });

  it('verifies hashes stored with 120000 iterations', async () => {
    const salt = Buffer.from('salt-for-120000!');
    const hash = pbkdf2Sync('secret-123', salt, 120000, 32, 'sha256');
    const stored = `pbkdf2_sha256$120000$${salt.toString('base64')}$${hash.toString('base64')}`;

    await expect(verifyPassword(stored, 'secret-123')).resolves.toBe(true);
    await expect(verifyPassword(stored, 'wrong')).resolves.toBe(false);
  });
});
