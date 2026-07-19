export type ProxyUrlValidationResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

export class ProxyRedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyRedirectError';
  }
}

const CLOUD_METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  '169.254.169.254',
]);

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return false;
  }

  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second] = parts;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  if (!normalized.includes(':')) {
    return false;
  }

  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  );
}

function isBlockedHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    CLOUD_METADATA_HOSTS.has(normalized) ||
    isPrivateIpv4(normalized) ||
    isPrivateIpv6(normalized)
  );
}

/** Validate absolute http(s) URL; reject non-http(s), localhost, private/link-local/metadata IPs, and weird hosts. */
export function validateProxyTargetUrl(
  raw: string,
  base?: string
): ProxyUrlValidationResult {
  let url: URL;

  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, reason: 'URL must use http or https' };
  }

  if (!url.hostname) {
    return { ok: false, reason: 'Missing hostname' };
  }

  if (url.username || url.password) {
    return { ok: false, reason: 'URL must not contain credentials' };
  }

  if (isBlockedHost(url.hostname)) {
    return { ok: false, reason: 'Blocked host' };
  }

  return { ok: true, url };
}

/**
 * Fetch with redirect:'manual', re-validating every Location with validateProxyTargetUrl.
 * Cap hops (default 2). On exceeding hops or invalid Location, throw or return a structured error.
 */
export async function fetchWithValidatedRedirects(
  input: string,
  init: RequestInit & { cf?: unknown },
  options?: { maxRedirects?: number }
): Promise<Response> {
  const maxRedirects = options?.maxRedirects ?? 2;
  let currentUrl = input;
  let redirectCount = 0;

  while (true) {
    const response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new ProxyRedirectError('Redirect response missing Location header');
      }

      redirectCount += 1;
      if (redirectCount > maxRedirects) {
        throw new ProxyRedirectError('Too many redirects');
      }

      const validation = validateProxyTargetUrl(location, currentUrl);
      if (!validation.ok) {
        throw new ProxyRedirectError(
          `Blocked redirect target: ${validation.reason}`
        );
      }

      currentUrl = validation.url.href;
      continue;
    }

    return response;
  }
}
