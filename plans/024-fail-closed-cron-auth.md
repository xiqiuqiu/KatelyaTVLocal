# 024 — Fail closed when cron authentication is unconfigured

- **Status**: DONE
- **Commit**: 6e7374f
- **Severity**: HIGH
- **Category**: Security
- **Rule**: Beyond the scan
- **Estimated scope**: 2 files, small

## Problem

`/api/cron` is excluded from middleware authentication. Its only guard returns
`true` when `CRON_API_TOKEN` is absent, so a deployment typo turns the refresh
and source-probe job into a public endpoint.

```ts
// src/lib/source-ranking/cron-auth.ts:40 — current
export function isAuthorizedCronRequest(
  request: Pick<Request, 'headers'>,
  source?: RuntimeSource
): boolean {
  const expectedToken = readCronApiToken(source);
  if (!expectedToken) {
    return true;
  }

  const incomingToken = readCronRequestToken(request);
  return incomingToken === expectedToken;
}
```

The current test at `src/lib/source-ranking/cron-auth.test.ts:46` explicitly
locks in the unsafe fail-open behavior.

## Target

Missing configuration and missing/wrong request credentials must all deny.

```ts
// target
export function isAuthorizedCronRequest(
  request: Pick<Request, 'headers'>,
  source?: RuntimeSource
): boolean {
  const expectedToken = readCronApiToken(source);
  if (!expectedToken) {
    return false;
  }

  const incomingToken = readCronRequestToken(request);
  return incomingToken === expectedToken;
}
```

Keep `/api/cron` returning its existing unauthorized response. Log one
configuration error without printing either token.

## Repo conventions to follow

- Preserve `x-cron-token` and `Authorization: Bearer` support.
- Imitate the pure helper test style in
  `src/lib/source-ranking/cron-auth.test.ts:17`.
- Keep secrets server-only and never include them in logs or JSON responses.

## Steps

1. Rewrite the existing “allows requests when no cron token is configured”
   test to expect `false`.
2. Add explicit tests for absent request token and blank configured token.
3. Change `isAuthorizedCronRequest` to fail closed exactly as shown.
4. At `/api/cron`, distinguish an internal missing-config log from a normal
   credential mismatch while returning the same external unauthorized status.
5. Update deployment documentation/environment examples to mark
   `CRON_API_TOKEN` required whenever cron is enabled.

## Boundaries

- Do NOT add a local-development bypass.
- Do NOT accept a token in query parameters.
- Do NOT expose whether the configured token exists to callers.
- Do NOT alter cron work, scheduling, ranking, or probe behavior.
- STOP if code has drifted from commit `6e7374f`.

## Verification

- **Mechanical**:
  - `pnpm test --runInBand src/lib/source-ranking/cron-auth.test.ts src/app/api/cron/route.test.ts`
  - `pnpm typecheck`
  - `pnpm lint:strict` (separate unrelated baseline warnings)
  - `npx react-doctor@latest --scope changed` must not lower the score.
- **Behavior check**: Call `/api/cron` with no deployment token, no request
  token, a wrong token, and a correct token. Only the correctly configured,
  matching case may run the job.
- **Done when**: missing configuration cannot authorize work and no secret
  material appears in logs or responses.
