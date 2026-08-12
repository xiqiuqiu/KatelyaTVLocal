# ADR 0008: Auth audit is append-only D1 events, separate from login rate limiting

## Status

Accepted

## Context

Operators need to answer who logged in or failed to log in, and when. The existing `login_security_events` design stores only `SHA-256(IP + username)` attempt keys for short-window rate limiting, cannot map back to usernames, and is skipped entirely when `LOGIN_RATE_WINDOW_LIMIT=0`. Login state is a signed browser Cookie with no server session table, so the system also cannot honestly report who is currently online. Product behavior analytics (search, play funnels, DAU) are a different problem from authentication auditing and must not share this store.

## Decision

1. **Auth Audit Event only (this slice).** Persist append-only `login_success`, `login_failure`, and explicit `logout` events for administrator review. Do not introduce an Auth Session, online presence, or Cookie-expiry-as-logout. Registration stays on `registration_audit`; password-change and product behavior event streams are out of scope.

2. **Separate table from rate limiting.** Use a new D1 table for Auth Audit Events. Do not extend or reuse `login_security_events` for audit history. Login rate limiting may keep its own store and switches; audit writes must not depend on `LOGIN_RATE_WINDOW_LIMIT`.

3. **Admin-visible username, constrained PII.** Owner/admin may read username plaintext. Store truncated/redacted IP and coarse device class only — never passwords, cookies, tokens, or full User-Agent strings. Invalid or missing usernames still produce failure rows with a placeholder identity so pre-credential rejects remain visible.

4. **D1-only, availability over audit completeness.** Write and query only when D1 is available. Audit insert failure must not block login or logout. Retain events for 90 days with periodic deletion. Expose a read-only admin API and admin list UI; no alerting in this slice.

`login_failure` covers authentication rejects including Turnstile failure, rate limiting, and invalid credentials (without splitting user-not-found vs wrong-password). Infrastructure 500s are not the primary audit failure path.

## Consequences

- Future readers must not treat rate-limit rows, Playback Attempt `sessionId`, or Watch Progress upserts as login history.
- Deployments without D1 have no queryable auth audit; the admin surface should say so rather than inventing a second backend.
- Adding “who is online” or session revocation later requires an explicit Auth Session decision — it is not a small extension of this event log.
- Product analytics, if pursued later, needs its own event model and retention policy; it must not overload Auth Audit Events.
