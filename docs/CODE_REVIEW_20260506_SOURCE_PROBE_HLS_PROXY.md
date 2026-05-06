# Code Review: Source Probe & HLS Proxy System

**Date:** 2026-05-06
**Branch:** main (working tree)
**Scope:** proxy.worker.js, hls-proxy route, source-probe route, layout.tsx, play/page.tsx, EpisodeSelector.tsx, types.ts, utils.ts

---

## Architecture Overview

This change adds a **source probing + HLS proxy system** for handling CORS-restricted video sources:

- **Server-side APIs** (`source-probe` & `hls-proxy`) — implemented in both Cloudflare Worker (`proxy.worker.js`) and Next.js Edge API routes for production/dev parity
- **Domain preference memory** — localStorage cache (7-day TTL) remembering whether each domain supports direct playback or needs proxying
- **Smart source selection** — server-side probe first → browser probe second, filtering out unavailable and proxy-only sources early
- **Auto fallback** — seamless switch to proxy mode when direct playback fails at runtime

---

## Issues Found

### 1. `proxy.worker.js` — catch clauses use `error.message` unsafely (Medium)

Two catch blocks assume `error` has a `.message` property without guarding:

- Line 147: `reason: error.message || '探测失败'`
- Line 219: `error: error.message || 'Proxy request failed'`

In JavaScript, `catch` can receive any value (string, `null`, plain object). The Next.js API route implementations already handle this correctly with `error instanceof Error`.

**Fix:** Guard with `error instanceof Error ? error.message : '探测失败'`.

### 2. Triple code duplication across environments (Maintainability)

Identical logic, same signatures, in three files with no sharing:

- `PLAYLIST_CONTENT_TYPES` array
- `isPlaylistResponse()`
- `buildAbsoluteUrl()`
- `buildMediaHeaders()` / `buildUpstreamHeaders()`
- `rewritePlaylistContent()` / `rewritePlaylistAttributes()`
- `createPassthroughHeaders()` / `createHlsProxyHeaders()`

Files: `proxy.worker.js` ↔ `src/app/api/hls-proxy/route.ts` ↔ `src/app/api/source-probe/route.ts`

Cloudflare Workers can't import Next.js `src/` files directly, but consider a shared `scripts/` directory with a build-step injection to keep core proxy logic in one place.

### 3. `proxy.worker.js` — `handleSourceProbe` parameter naming (Minor)

Line 57: `async function handleSourceProbe(requestUrl)` — the name suggests a `Request`, but it receives a `URL` object (call site line 42: `handleSourceProbe(url)`). Works correctly, but misleading for future readers.

### 4. `play/page.tsx` — potential race condition on proxy fallback in ArtPlayer (Medium)

`trySwitchToProxyPlayback()` sets `videoUrl` via state, which triggers re-render. But in the HLS error handler (line 792):

```javascript
hls.destroy();
return;
```

The HLS instance is destroyed and the handler returns. Whether ArtPlayer correctly re-initializes with the new proxy URL depends on whether React processes the state update within the same render cycle or defers it. If ArtPlayer's effect watches `videoUrl` but its internal HLS reference is stale, the player may not recover.

**Verify:** Confirm ArtPlayer's initialization effect fully tears down and rebuilds its internal HLS instance on `videoUrl` change, rather than attempting to reuse a destroyed instance.

### 5. `EpisodeSelector.tsx` — `getAutoProbeCandidates` may skip re-probing (Low)

The filter `attemptedSourcesRef.current.has(sourceKey)` (line 1069) excludes any source that has ever been probed. If a probe failed (status = `unavailable`) and the user clicks the source card, `handleSourceCardClick` calls `probeSourceDirectPlayback` directly, which does re-probe. But passive auto-probing will never retry a previously attempted source within the same session.

### 6. `utils.ts` — `rememberSourceDomainPreference` resets failCount on direct (Info)

Line 1552-1554:
```typescript
failCount:
  mode === 'direct'
    ? 0
    : (previousPreference?.failCount || 0) + 1,
```

This means `failCount` is effectively binary (0 or 1). Not a bug, but precludes exponential backoff patterns if needed later.

---

## Architectural Observations

**Strengths:**
- Two-stage probing (server → browser) effectively filters dead sources before expensive client-side testing
- Domain-level localStorage memory avoids re-probing across sessions, improving perceived performance
- Auto fallback from direct to proxy at runtime is a major UX win — no manual intervention needed
- Source status visualization in EpisodeSelector (direct/proxy/unavailable/probing) provides clear user feedback
- Edge Runtime ensures low-latency proxy layer

**Watch items:**
- Triple code duplication is the highest ongoing maintenance cost
- New env vars `NEXT_PUBLIC_SOURCE_PROBE` and `NEXT_PUBLIC_HLS_PROXY` must be configured in deployment environments
- The `proxy.worker.js` and Next.js API routes have subtle behavioral differences (error.message handling, response status codes) that could lead to environment-specific bugs

---

## Verdict

**Core functionality: APPROVED.** The source probing and proxy fallback mechanism is well-designed and addresses the key problem of CORS-restricted video sources. Recommended fixes before merge:

1. Fix `error.message` guards in `proxy.worker.js` (Issue #1)
2. Verify ArtPlayer fallback flow end-to-end (Issue #4)
