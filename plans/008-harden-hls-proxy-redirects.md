# 008 — Harden authenticated HLS proxy redirect following

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: MEDIUM
- **Category**: Security
- **Rule**: react-doctor/untrusted-redirect-following
- **Estimated scope**: 1–2 files, medium

## Problem

```ts
// src/app/api/hls-proxy/route.ts:190-193 — current
const upstreamResponse = await fetch(targetUrl, {
  headers: buildUpstreamHeaders(request, targetUrl),
  redirect: 'follow',
});
```

Caller supplies `url`. Middleware requires auth (not public like image-proxy), but authenticated SSRF via redirect chain remains.

## Target

Canonical: `redirect: "manual"` and re-validate every redirect target before following.

Reuse the same URL/host validation helper introduced for #003 if present (extract shared `src/lib/proxy-url-policy.ts`). Allow CDN hosts required for playback; reject `localhost`, private IP literals, and non-http(s).

```ts
// target sketch
const upstreamResponse = await fetch(targetUrl, {
  headers: buildUpstreamHeaders(request, targetUrl),
  redirect: 'manual',
});
// handle 3xx via validated Location or return error
```

## Repo conventions to follow

- Preserve ad-filter / segmentMode behavior after the first successful body.
- Keep CORS helpers.
- Mirror test style of other `src/app/api/**/route.test.ts`.

## Steps

1. Land or import shared URL allow/validate helper (coordinate with #003).
2. Switch HLS fetch to `redirect: 'manual'`; validate Location on 3xx (cap hops).
3. Add tests for blocked redirect and allowed media URL happy path (mock fetch).
4. Confirm playlist rewriting still works with proxied segment URLs.

## Boundaries

- Do NOT weaken auth on hls-proxy.
- Do NOT disable ad filtering.
- STOP if real CDNs require multi-hop redirects — implement bounded validated follow, not open `follow`.

## Verification

- **Mechanical**: diagnostic clear on hls-proxy; API tests; typecheck.
- **Behavior check**: Play one HLS source through proxy mode; segments load. Malicious redirect Location rejected.
- **Done when**: playback OK + redirect policy enforced.
