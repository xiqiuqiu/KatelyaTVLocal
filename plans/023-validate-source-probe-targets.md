# 023 — Validate every source-probe fetch target

- **Status**: DONE
- **Commit**: 6e7374f
- **Severity**: HIGH
- **Category**: Security
- **Rule**: Beyond the scan
- **Estimated scope**: 3 files, medium

## Problem

`src/app/api/source-probe/route.ts:12` accepts a caller-shaped URL and
`src/lib/source-preference.ts:190` fetches it with open redirect following.
Nested playlist targets repeat the same pattern. A logged-in caller can make
the server probe private, metadata, non-HTTP, or redirect-selected targets.

```ts
// src/lib/source-preference.ts:197 — current
const upstreamResponse = await fetchWithProbeTimeout(
  targetUrl,
  {
    headers: buildUpstreamHeaders(targetUrl),
    redirect: 'follow',
  },
  options
);

// src/lib/source-preference.ts:131 — current nested fetch
const response = await fetchWithProbeTimeout(targetUrl, {
  headers: buildUpstreamHeaders(targetUrl, range),
  redirect: 'follow',
}, options);
```

## Target

Route every initial, redirect, playlist, and segment target through the shared
policy already used by image/HLS proxies.

```ts
// target helper in src/lib/source-preference.ts
async function fetchValidatedProbeTarget(
  targetUrl: string,
  init: RequestInit,
  options?: SourceProbeOptions
): Promise<Response> {
  const validation = validateProxyTargetUrl(targetUrl);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    normalizeProbeTimeoutMs(options?.timeoutMs)
  );
  try {
    return await fetchWithValidatedRedirects(
      validation.url.href,
      { ...init, redirect: 'manual', signal: controller.signal },
      { maxRedirects: 2 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
```

Use this helper for both `probeSourcePlaybackUpstream` and
`probeNestedTarget`. Validate the first non-comment playlist URI before
fetching it. Return a structured `unavailable` result for rejected targets;
do not leak internal validation details beyond the existing reason field.

## Repo conventions to follow

- Reuse `validateProxyTargetUrl` and `fetchWithValidatedRedirects` from
  `src/lib/proxy-url-policy.ts`; do not create a second host policy.
- Imitate `src/lib/proxy-url-policy.test.ts` for blocked hosts and redirects.
- Preserve `SourceProbeOptions.timeoutMs`, cache keys, CORS classification, and
  the existing `SourceProbeMetrics` shape.

## Steps

1. Add failing source-preference tests for localhost, RFC1918 IP, metadata host,
   non-HTTP URL, redirect to private host, and private nested playlist target.
2. Add `fetchValidatedProbeTarget` with the exact timeout and bounded redirect
   behavior above.
3. Replace both `redirect: 'follow'` fetch sites.
4. Validate nested playlist URLs before building headers or issuing requests.
5. Add one route test confirming rejected input returns an unavailable result
   without an internal fetch.
6. Re-read the diff and retain successful public HLS and range probes.

## Boundaries

- Do NOT remove source probing, expand CORS permissions, or change ranking.
- Do NOT silently fall back to open `fetch` after validation failure.
- Do NOT weaken `proxy-url-policy` to accommodate a failing fixture.
- DNS rebinding cannot be fully resolved by string validation in Edge runtime;
  STOP and report if product requirements demand hostname-resolution checks.
- STOP if code has drifted from commit `6e7374f`.

## Verification

- **Mechanical**:
  - `pnpm test --runInBand src/lib/proxy-url-policy.test.ts src/lib/source-preference.test.ts src/app/api/source-probe/route.test.ts`
  - `pnpm typecheck`
  - `pnpm lint:strict` (separate unrelated baseline warnings)
  - `npx react-doctor@latest --scope changed` must not lower the score.
- **Behavior check**: Open `/play`, allow normal candidate probing, and confirm
  source statuses still settle. Requests to `127.0.0.1`, metadata hosts, and a
  public redirect whose Location is private must issue no private fetch.
- **Done when**: every probe hop uses one bounded validated fetch path and normal
  public media probes retain their current result semantics.
