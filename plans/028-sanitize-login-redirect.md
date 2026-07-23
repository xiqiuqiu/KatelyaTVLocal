# 028 — Sanitize post-login redirect target

- **Status**: DONE
- **Commit**: 411e0c2
- **Severity**: HIGH
- **Category**: Security
- **Rule**: Beyond the scan (open redirect)
- **Estimated scope**: 2–3 files, small

## Problem

Login and register success paths assign the raw query param to
`window.location.href` with no same-origin / relative-path check:

```ts
// src/app/login/page.tsx:154-156 — current
if (res.ok) {
  const redirect = searchParams.get('redirect') || '/';
  window.location.href = redirect;
}
```

```ts
// src/app/login/page.tsx:196-198 — current (register)
if (res.ok) {
  const redirect = searchParams.get('redirect') || '/';
  window.location.href = redirect;
}
```

Middleware legitimately sets a relative `redirect` (`src/middleware.ts:46-48`:
`${pathname}${search}`). An attacker can still send users to
`/login?redirect=https://evil.com` or `/login?redirect=//evil.com` and, after
credentials succeed, land them on a phishing site.

## Target

Add a pure helper (new file) and use it in both success paths:

```ts
// src/lib/safe-redirect.ts — target
/**
 * Allow only same-app relative paths. Reject protocol-relative and absolute URLs.
 */
export function getSafeRedirectPath(
  raw: string | null | undefined,
  fallback = '/'
): string {
  if (!raw) return fallback;
  const value = raw.trim();
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  if (value.includes('://')) return fallback;
  if (value.includes('\\')) return fallback;
  return value;
}
```

```ts
// src/app/login/page.tsx — target (login + register)
import { getSafeRedirectPath } from '@/lib/safe-redirect';

if (res.ok) {
  window.location.href = getSafeRedirectPath(searchParams.get('redirect'), '/');
}
```

## Repo conventions to follow

- Pure helper under `src/lib/` with a colocated unit test (imitate
  `src/lib/registration/invite-link` + tests pattern).
- Extend `src/app/login/page.test.tsx` with a success-path redirect case using
  the existing `fetch` mock style in that file.

## Steps

1. Create `src/lib/safe-redirect.ts` with `getSafeRedirectPath` as above.
2. Add `src/lib/safe-redirect.test.ts` covering: `/play?x=1` → keep;
   `https://evil.com` → `/`; `//evil.com` → `/`; `/\evil` → `/`; empty → `/`.
3. In `src/app/login/page.tsx`, replace both raw redirect assignments (login +
   register) with `getSafeRedirectPath(...)`.
4. Add one login-page test: mock `/api/login` 200 with
   `redirect=https://evil.com`, assert `window.location.href` ends on `/` (or
   assignable stub), not the absolute URL.

## Boundaries

- Do NOT change middleware’s relative `redirect` encoding.
- Do NOT add allow-lists of external domains.
- Do NOT change auth cookie issuance.
- STOP if redirects already go through a sanitizer; report drift.

## Verification

- **Mechanical**: `pnpm test -- -t "safe-redirect"` (or the new test names);
  `pnpm typecheck`.
- **Behavior check**: `/login?redirect=/search?q=test` after success → lands on
  search. `/login?redirect=https://example.com` after success → lands on `/`.
- **Done when**: absolute / protocol-relative redirects cannot win post-auth.
