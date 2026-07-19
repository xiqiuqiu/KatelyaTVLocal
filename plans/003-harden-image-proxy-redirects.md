# 003 — Harden public image-proxy against redirect SSRF

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: HIGH
- **Category**: Security
- **Rule**: react-doctor/untrusted-redirect-following
- **Estimated scope**: 1–2 files, medium

## Problem

`src/app/api/image-proxy/route.ts:74` fetches caller-controlled `url` with default redirect following. Middleware whitelists `/api/image-proxy` (public). An attacker can bounce through open redirects to internal targets.

```ts
// src/app/api/image-proxy/route.ts:74 — current
const imageResponse = await fetch(imageUrl, fetchInit);
```

## Target

Canonical fix (`react-doctor/untrusted-redirect-following`): use `redirect: "manual"` (or equivalent) and re-validate every redirect target before following; prefer a host allowlist for first-hop and any follow.

```ts
// target sketch
const fetchInit = {
  ...existing,
  redirect: 'manual' as RequestRedirect,
};
const imageResponse = await fetch(imageUrl, fetchInit);
// If status 3xx: read Location, validate against allowlist (same rules as imageUrl), then fetch once more with redirect:'manual' or reject.
```

Also validate the initial `imageUrl` is `http:`/`https:` and host is allowed (Douban/CDN list already implied by Referer usage — make explicit).

## Repo conventions to follow

- Keep `export const runtime = 'edge'`.
- Preserve `addCorsHeaders` / OPTIONS behavior for OrionTV.
- Add or extend route tests beside `src/app/api/image-proxy/` if a test file exists; otherwise add `route.test.ts` mirroring other API tests.

## Steps

1. Parse and validate `imageUrl` before fetch (protocol + host allowlist).
2. Set `redirect: 'manual'` on the upstream fetch.
3. On 3xx: either reject, or follow only after re-validating `Location` with the same allowlist (cap hops ≤ 1–2).
4. Keep Cloudflare `cf.image` transform behavior when present.
5. Add tests: blocked host, blocked redirect Location, happy-path mock fetch.

## Boundaries

- Do NOT remove the public CORS surface without product approval.
- Do NOT change HLS proxy in this plan (see #008).
- STOP if allowlist would break known production poster hosts — expand allowlist with documented hosts rather than re-enabling open follow.

## Verification

- **Mechanical**: `untrusted-redirect-following` clear for `image-proxy`. Focused API tests + typecheck.
- **Behavior check**: Home/Douban posters still load via proxy. Attempt a `url` pointing at an open redirect to a non-allowlisted host — expect 4xx/reject.
- **Done when**: diagnostic clear, posters work, redirect bypass blocked.
