# 022 — Restrict image proxy responses to inert image content

- **Status**: DONE
- **Commit**: 6e7374f
- **Severity**: HIGH
- **Category**: Security
- **Rule**: Beyond the scan
- **Estimated scope**: 2 files, small

## Problem

`src/app/api/image-proxy/route.ts:101` copies an arbitrary upstream
`Content-Type` and streams the body from the public proxy. A caller can point
the endpoint at public HTML and receive active content from the application's
own origin, where authenticated cookies and same-origin APIs are available.

```ts
// src/app/api/image-proxy/route.ts:101 — current
const contentType = imageResponse.headers.get('content-type');

const headers = new Headers();
if (contentType) {
  headers.set('Content-Type', contentType);
}

const response = new Response(imageResponse.body, {
  status: 200,
  headers,
});
```

Redirect validation in `fetchWithValidatedRedirects` does not make the returned
media type safe.

## Target

Accept only raster image types required by the product. Normalize parameters
before comparison and reject missing or active content types.

```ts
// target
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const contentType =
  imageResponse.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ||
  '';
if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
  const response = NextResponse.json(
    { error: 'Unsupported image content type' },
    { status: 415 }
  );
  return addCorsHeaders(response);
}

const headers = new Headers({
  'Content-Type': contentType,
  'X-Content-Type-Options': 'nosniff',
});
```

Keep the existing cache headers and stream the body only after this check.
Do not admit `text/html`, `application/xhtml+xml`, or `image/svg+xml`.

## Repo conventions to follow

- Preserve Edge runtime and `addCorsHeaders`.
- Imitate the request/response mocks in
  `src/app/api/image-proxy/route.test.ts:78`.
- Reuse the existing validated redirect helper; this plan does not replace it.

## Steps

1. Add the module-scope allowlist in `src/app/api/image-proxy/route.ts`.
2. Normalize and validate the upstream media type before creating the streamed
   response.
3. Return JSON status 415 for missing/disallowed types and add
   `X-Content-Type-Options: nosniff` to successful responses.
4. Extend `route.test.ts` with HTML, SVG, missing type, parameterized JPEG, and
   normal JPEG cases.
5. Re-read the diff and remove unrelated proxy-policy churn.

## Boundaries

- Do NOT weaken URL or redirect validation.
- Do NOT add SVG sanitization; reject SVG.
- Do NOT change the public endpoint URL, image resize parameters, or CORS API.
- STOP if production requires another raster MIME; add only that documented
  type with a focused test.
- STOP if code has drifted from commit `6e7374f`.

## Verification

- **Mechanical**:
  - `pnpm test --runInBand src/app/api/image-proxy/route.test.ts`
  - `pnpm typecheck`
  - `pnpm lint:strict` (record unrelated baseline warnings separately)
  - `npx react-doctor@latest --scope changed` must not lower the score.
- **Behavior check**: Posters on `/` and `/douban` still render. Navigating the
  proxy to an upstream `text/html` or SVG response returns 415 and never renders
  attacker markup under the application origin.
- **Done when**: only allowlisted raster types stream, tests cover active
  content rejection, and poster loading is unchanged.
