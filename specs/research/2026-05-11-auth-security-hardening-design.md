# KatelyaTV Auth Security Hardening Design

## Background

The project had basic login, role separation, and admin capabilities, but the auth system had several high-risk issues: committed auth keys in the repository, plaintext user passwords, login cookies readable by frontend scripts, no automatic session invalidation on ban/password change, and side-effect GET requests on admin endpoints.

This design uses a two-phase approach:
- **Phase 1:** Stop the bleeding — remove secrets, hash passwords, sign cookies, expire old sessions
- **Phase 2:** Structural hardening — session versioning, CSRF protection, audit logging

## Phase 1: Critical Fixes

Five changes:

1. **Remove committed secrets** — `USERNAME`, `PASSWORD`, `CRON_API_TOKEN` moved to env/secrets
2. **Password hashing** — PBKDF2-SHA256 with per-user random salt, 120,000 iterations, encoded metadata in hash string. Web Crypto API for Edge Runtime compatibility
3. **Signed session cookies** — `httpOnly`, `secure` in production, `sameSite=lax`, HMAC-SHA256 signature
4. **Reject old cookie format** — all users re-login after upgrade
5. **Separate signing secret** — `AUTH_SIGNING_SECRET` independent from `PASSWORD`

### Password Hash Format

```
pbkdf2_sha256$120000$<base64_salt>$<base64_hash>
```

Algorithm metadata encoded in the hash string itself, enabling future upgrades.

### Session Cookie Model

Minimal payload signed cookie:
- `version: 2`
- `username`
- `role` (owner/admin/user)
- `issuedAt` timestamp

Server validates signature via `AUTH_SIGNING_SECRET`. Frontend reads user info from `window.RUNTIME_CONFIG.CURRENT_USER` (injected at layout level), never from `document.cookie`.

`localstorage` mode: owner password compared against `PASSWORD` env var (plaintext, server-only). Architectural limitation accepted for single-user deployments.

## Phase 2: Structural Hardening

1. **Session versioning** — `session_version` per user; increment on password change, ban, role change. Middleware validates cookie version against DB before allowing requests.
2. **Admin endpoint hardening** — all state-mutating admin endpoints use POST. CSRF protection via token-based approach.
3. **Password change requires old password** — prevents session-only hijacking
4. **Rate limiting and audit** — failed login tracking, admin action logging, password change events

## Storage Backend Consistency

All 5 backends (LocalStorage, D1, Redis, Kvrocks, Upstash) implement:
- `registerUser` → writes PBKDF2 hash
- `verifyUser` → `verifyPassword()` against stored hash
- `changePassword` → writes new hash
- `upgradeLegacyPasswords` → batch-upgrade plaintext to hash

## Migration Strategy

1. Prepare new secrets in Cloudflare / local env (no stream switch)
2. Execute DB migration for hash/session fields
3. Deploy version that writes hashes, rejects old cookies
4. Verify login, playback, favorites, continue-watching, admin, password change
5. After Phase 1 stable, proceed to Phase 2

## Rollback

- Phase 1 failure → can temporarily accept both old and new cookies, but MUST NOT write plaintext passwords again
- Phase 2 failure → can disable CSRF or session version checks individually, but MUST NOT revert Phase 1 changes
