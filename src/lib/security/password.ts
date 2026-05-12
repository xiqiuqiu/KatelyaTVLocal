import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const PASSWORD_PREFIX = 'pbkdf2_sha256';
const PASSWORD_ITERATIONS = 120000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number
): Uint8Array {
  return pbkdf2Sync(password, salt, iterations, KEY_LENGTH, 'sha256');
}

export function isLegacyPlaintextPassword(stored: string): boolean {
  return !stored.startsWith(`${PASSWORD_PREFIX}$`);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = deriveKey(password, salt, PASSWORD_ITERATIONS);

  return [
    PASSWORD_PREFIX,
    String(PASSWORD_ITERATIONS),
    toBase64(salt),
    toBase64(derived),
  ].join('$');
}

export async function verifyPassword(
  stored: string,
  candidate: string
): Promise<boolean> {
  if (isLegacyPlaintextPassword(stored)) {
    return stored === candidate;
  }

  const [prefix, iterationsValue, saltValue, hashValue] = stored.split('$');
  if (
    prefix !== PASSWORD_PREFIX ||
    !iterationsValue ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }

  const iterations = Number(iterationsValue);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const derived = deriveKey(candidate, fromBase64(saltValue), iterations);
  const storedHash = Buffer.from(hashValue, 'base64');
  const candidateHash = Buffer.from(derived);

  if (storedHash.length !== candidateHash.length) {
    return false;
  }

  return timingSafeEqual(storedHash, candidateHash);
}
