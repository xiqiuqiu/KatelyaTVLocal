export type SessionRole = 'owner' | 'admin' | 'user';

export interface SessionPayload {
  version: 2;
  username?: string;
  role: SessionRole;
  issuedAt: number;
}

interface SessionEnvelope {
  payload: SessionPayload;
  signature: string;
}

function getCrypto(): Crypto {
  return globalThis.crypto;
}

async function sign(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await getCrypto().subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await getCrypto().subtle.sign(
    'HMAC',
    key,
    encoder.encode(value)
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function verify(
  value: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await getCrypto().subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signatureBytes = new Uint8Array(
    signature.match(/.{1,2}/g)?.map((chunk) => parseInt(chunk, 16)) || []
  );

  return getCrypto().subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    encoder.encode(value)
  );
}

export async function createSessionCookieValue(
  input: { username?: string; role: SessionRole },
  secret: string
): Promise<string> {
  const payload: SessionPayload = {
    version: 2,
    username: input.username,
    role: input.role,
    issuedAt: Date.now(),
  };

  const body = JSON.stringify(payload);
  const signature = await sign(body, secret);
  const envelope: SessionEnvelope = { payload, signature };

  return encodeURIComponent(JSON.stringify(envelope));
}

export async function parseSessionCookieValue(
  cookieValue: string,
  secret: string
): Promise<SessionPayload | null> {
  try {
    const parsed = JSON.parse(
      decodeURIComponent(cookieValue)
    ) as Partial<SessionEnvelope>;
    if (!parsed.payload || !parsed.signature) {
      return null;
    }

    if (parsed.payload.version !== 2) {
      return null;
    }

    const body = JSON.stringify(parsed.payload);
    const isValid = await verify(body, parsed.signature, secret);
    return isValid ? parsed.payload : null;
  } catch (_error) {
    return null;
  }
}
