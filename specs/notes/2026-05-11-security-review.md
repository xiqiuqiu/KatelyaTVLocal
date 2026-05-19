# Security Review: Auth Hardening

**Date:** 2026-05-11
**Scope:** PBKDF2 password hashing, HMAC session signing, legacy password migration, middleware hardening

## Summary

29 files, +397 / -404 lines. Three core security upgrades:

- **PBKDF2-SHA256 password hashing** (120,000 iterations, 16-byte random salt) — across all 5 storage backends
- **HMAC-SHA256 signed session cookies** (version: 2) — replaces unsigned cookies
- **Progressive legacy password migration** — `upgradeLegacyPasswords()` silently upgrades during login/register flow

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/security/password.ts` | `hashPassword` / `verifyPassword` / `isLegacyPlaintextPassword` |
| `src/lib/security/session.ts` | `createSessionCookieValue` / `parseSessionCookieValue` |
| `src/lib/security/password.test.ts` | Hash and verify unit tests |
| `src/lib/security/session.test.ts` | Session signing and tamper-resistance tests |
| `src/app/api/session/route.ts` | Current user session info API endpoint |

## Before vs After

| Aspect | Before | After |
|--------|--------|-------|
| Password storage | Plaintext (all backends) | PBKDF2-SHA256, 120K iterations |
| Session integrity | No cryptographic signing | HMAC-SHA256 signed, version: 2 |
| Tamper protection | None | `parseSessionCookieValue` returns `null` on failure |
| Cookie attributes | No explicit constraints | `httpOnly`, `sameSite: lax`, conditional `secure` |
| Username enumeration | Inconsistent error messages | Uniform "invalid username or password" |
| Cross-account access | Client-provided `username` (skip-configs) | Enforced from signed cookie identity |

## Test Coverage

| Test | Status |
|------|--------|
| Hash and verify — correct password | Pass |
| Hash and verify — wrong password rejected | Pass |
| Legacy plaintext detection | Pass |
| Session sign and parse — roundtrip | Pass |
| Session sign — tampered rejected | Pass |

## Findings

### HIGH

1. **localstorage mode owner password still plaintext comparison** — `process.env.PASSWORD` is inherently plaintext server-side. Mitigation: ensure it's not bundled client-side.

2. **skip-configs route fixes username spoofing vulnerability** — previously allowed arbitrary `username` in request body. Now enforces identity from signed auth cookie.

3. **Multiple API routes had missing `await`** — all protected routes (admin, favorites, playrecords, searchhistory, skip-configs) now correctly await `getAuthInfoFromCookie`.

### MEDIUM

4. **Sessions have no server-side expiry check** — cookies have 7-day browser expiry but no server-side `maxAge` check on `issuedAt`.

5. **Legacy plaintext comparison not constant-time** — `stored === candidate` not timing-safe. Low practical risk (network timing noise).

6. **No password strength enforcement** — registration only checks non-empty string.

### LOW

7. **Dead field in change-password response** — `reauthRequired: true` unused by client.

8. **Client runtime exposes user info in HTML source** — `window.RUNTIME_CONFIG.CURRENT_USER` injects username/role into page source. Acceptable tradeoff since session cookie is `httpOnly`.

9. **All 5 storage backends implement consistently** — `hashPassword`/`verifyPassword` uniformly across LocalStorage, D1, Redis, Kvrocks, Upstash.

## Conclusion

No blocking issues. Changes can be merged. Recommended follow-ups:

1. Add configurable `maxAge` check based on `issuedAt` in `parseSessionCookieValue`
2. Add minimum password length requirement (e.g., 6 characters) in registration
