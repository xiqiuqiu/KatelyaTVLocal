---
name: SSRF Risk in Proxy/Probe Endpoints
description: All three proxy/probe endpoints (Worker + 2 Next.js Edge routes) accept arbitrary URLs via `url` query param with no validation before server-side fetch.
type: feedback
---

Accepting an arbitrary `url` query parameter and calling `fetch(targetUrl)` on the server side is an SSRF vector. The endpoints in `proxy.worker.js`, `src/app/api/source-probe/route.ts`, and `src/app/api/hls-proxy/route.ts` all do this with zero validation.

**Why:** Even though Cloudflare Workers provide some SSRF protection for metadata endpoints, the Next.js Edge routes do not. An attacker could target internal services (127.0.0.1, 10.x.x.x, 192.168.x.x, 169.254.169.254).

**How to apply:** When reviewing any new proxy/fetch endpoint, always verify URL validation is present before the fetch call. Add protocol allowlist (https only), private-IP blocklist, and consider domain allowlisting for production deployments.
