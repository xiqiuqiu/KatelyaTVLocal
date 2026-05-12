const PASSWORD_PREFIX = 'pbkdf2_sha256';
const PASSWORD_ITERATIONS = 100000;
const SALT_LENGTH = 16;

function getCrypto(): Crypto {
  return globalThis.crypto;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await getCrypto().subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await getCrypto().subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    key,
    256
  );

  return new Uint8Array(bits);
}

export function isLegacyPlaintextPassword(stored: string): boolean {
  return !stored.startsWith(`${PASSWORD_PREFIX}$`);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = getCrypto().getRandomValues(new Uint8Array(SALT_LENGTH));
  const derived = await deriveKey(password, salt, PASSWORD_ITERATIONS);

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

  const derived = await deriveKey(candidate, fromBase64(saltValue), iterations);
  return constantTimeEqual(derived, fromBase64(hashValue));
}
