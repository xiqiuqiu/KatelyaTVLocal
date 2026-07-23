const SENSITIVE_DETAIL_KEYS = new Set([
  'username',
  'password',
  'cookie',
  'cookies',
  'token',
  'accessToken',
  'idToken',
  'authorization',
  'credentials',
]);

export function createPlaybackAttemptSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `playback-attempt-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function sanitizePlaybackEvidenceUrl(playbackUrl: string | null | undefined): {
  playbackUrl: string | null;
  playbackDomain: string | null;
} {
  if (typeof playbackUrl !== 'string' || !playbackUrl.trim()) {
    return { playbackUrl: null, playbackDomain: null };
  }

  try {
    const url = new URL(playbackUrl.trim());

    // MediaSource / HLS.js blob URLs store a nested absolute URL in pathname.
    // Concatenating origin+pathname produces garbage like
    // `https://app.pages.devhttps://app.pages.dev/<uuid>` (and a second pass
    // yields hostname `*.pages.devhttps`). Blob ids are not useful CDN evidence.
    if (url.protocol === 'blob:' || url.protocol === 'data:') {
      return { playbackUrl: null, playbackDomain: null };
    }

    url.username = '';
    url.password = '';

    // Prefer host + path template; never keep query strings (signed URLs) in evidence.
    return {
      playbackUrl: `${url.origin}${url.pathname}`,
      playbackDomain: url.hostname.toLowerCase() || null,
    };
  } catch {
    return { playbackUrl: null, playbackDomain: null };
  }
}

/** Prefer a logical media URL over MediaSource blob:/data: currentSrc. */
export function preferLogicalPlaybackUrl(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
      continue;
    }
    return trimmed;
  }
  return null;
}

export function summarizeUserAgent(userAgent: string | null | undefined): string | null {
  if (typeof userAgent !== 'string' || !userAgent.trim()) {
    return null;
  }
  // Short non-fingerprint summary — not a 500-char raw UA.
  return userAgent.trim().slice(0, 80);
}

export function sanitizeEvidenceDetails(
  details: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!details) {
    return undefined;
  }

  const blocked = SENSITIVE_DETAIL_KEYS;

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (blocked.has(key)) {
      continue;
    }
    if (
      (key === 'playbackUrl' ||
        key === 'currentSrc' ||
        key === 'directUrl' ||
        key === 'observationUrl' ||
        key === 'url') &&
      typeof value === 'string'
    ) {
      next[key] = sanitizePlaybackEvidenceUrl(value).playbackUrl;
      continue;
    }
    next[key] = value;
  }
  return next;
}
