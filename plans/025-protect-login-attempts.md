# 025 — Enforce Turnstile and distributed login throttling

- **Status**: DONE
- **Commit**: 6e7374f
- **Severity**: HIGH
- **Category**: Security
- **Rule**: Beyond the scan
- **Estimated scope**: 5–7 files plus D1 migration, medium

## Problem

`src/app/api/login/route.ts:34` reads credentials and immediately verifies
them. It never invokes the existing Turnstile helper and has no attempt budget.
`src/app/api/login/route.test.ts:93` is named “without Turnstile protection”
and explicitly proves that `LOGIN_TURNSTILE_REQUIRED=true` is ignored.

```ts
// src/app/api/login/route.ts:83 — current
const { username, password } = await req.json();

if (username === process.env.USERNAME && password === process.env.PASSWORD) {
  // issue session
}
```

This permits distributed password guessing against owner and user accounts.

## Target

Create `src/lib/login/security.ts` with one public pre-auth seam:

```ts
export interface LoginSecurityInput {
  username: string;
  turnstileToken?: string;
  ip: string;
  now?: number;
  env?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export type LoginSecurityResult =
  | { ok: true; status: 200; attemptKey: string }
  | { ok: false; status: 400 | 429 | 500; error: string };

export async function validateLoginSecurity(
  input: LoginSecurityInput
): Promise<LoginSecurityResult>;

export async function recordLoginResult(input: {
  attemptKey: string;
  success: boolean;
  now?: number;
  env?: Record<string, unknown>;
}): Promise<void>;
```

Use `getClientIp` and `verifyTurnstileToken` from `src/lib/turnstile.ts`.
When `LOGIN_TURNSTILE_REQUIRED=true`, missing/failed verification must return
before password work. Add D1 storage for failed attempts:

```sql
CREATE TABLE IF NOT EXISTS login_security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_key TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_security_attempt_window
  ON login_security_events(attempt_key, created_at);
```

`attempt_key` must be SHA-256 of normalized IP + lower-cased username; do not
store plaintext usernames, passwords, tokens, or raw IPs. Before credential
verification, count failed events within `LOGIN_RATE_WINDOW_SECONDS` (default
900); return 429 at `LOGIN_RATE_WINDOW_LIMIT` (default 5). Record every failed
credential attempt and a success marker; a success clears prior failures for
that key. If rate limiting is enabled but D1 is unavailable, fail with 500
rather than silently disabling the configured control.

Route body target:

```ts
const { username, password, turnstileToken } = await req.json();
const security = await validateLoginSecurity({
  username: typeof username === 'string' ? username : '',
  turnstileToken,
  ip: getClientIp(req.headers),
});
if (!security.ok) {
  return NextResponse.json({ error: security.error }, { status: security.status });
}
// verify credentials, then await recordLoginResult({ attemptKey, success })
```

Apply the same pre-auth path to localstorage owner login, using a stable
synthetic username such as `owner`.

## Repo conventions to follow

- Imitate `src/lib/registration/security.ts:231` for config parsing, Turnstile,
  D1 access, result unions, and tests.
- Imitate `src/app/api/login/route.test.ts` request/response mocks.
- Preserve generic “用户名或密码错误” responses and seven-day signed sessions.

## Steps

1. Add the D1 migration and `src/lib/login/security.ts` tests first: Turnstile
   required/optional, five failures, sixth 429, window expiry, success reset,
   hashed persistence, and missing D1 fail-closed behavior.
2. Implement config parsing and the two public functions exactly above.
3. Update login route body parsing to accept `turnstileToken`; run security
   checks before owner/database password verification.
4. Record failed and successful outcomes on every credential branch.
5. Replace tests that assert Turnstile is ignored with required-token tests;
   cover localstorage and D1 modes.
6. Ensure the login page sends the Turnstile token already produced by its
   widget; add the widget only if absent.
7. Document `LOGIN_TURNSTILE_REQUIRED`, `LOGIN_RATE_WINDOW_SECONDS`, and
   `LOGIN_RATE_WINDOW_LIMIT`, including D1 deployment order.

## Boundaries

- Do NOT reveal whether a username exists.
- Do NOT store passwords, Turnstile tokens, plaintext usernames, or plaintext
  IPs.
- Do NOT use a module-local Map as the production rate limiter.
- Do NOT issue a session if security result recording fails after a configured
  fail-closed requirement.
- Do NOT alter registration security in this plan.
- STOP if code has drifted from commit `6e7374f`.

## Verification

- **Mechanical**:
  - `pnpm test --runInBand src/lib/login/security.test.ts src/app/api/login/route.test.ts`
  - `pnpm typecheck`
  - `pnpm lint:strict` (separate unrelated baseline warnings)
  - Apply migration to a disposable D1 database.
  - `npx react-doctor@latest --scope changed` must not lower the score.
- **Behavior check**: In `/login`, verify valid Turnstile + credentials works;
  missing/failed Turnstile does not run password verification; repeated wrong
  credentials reach 429; a valid login clears that key's failure window.
- **Done when**: Turnstile configuration is honored, attempt budgets are shared
  across isolates through D1, and all credential responses remain
  non-enumerating.
