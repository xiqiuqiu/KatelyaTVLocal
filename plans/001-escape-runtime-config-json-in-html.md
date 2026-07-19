# 001 — Escape RUNTIME_CONFIG JSON before script injection

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: HIGH
- **Category**: Security
- **Rule**: react-doctor/unsafe-json-in-html
- **Estimated scope**: 1–2 files, small

## Problem

`src/app/layout.tsx:116` embeds `JSON.stringify(runtimeConfig)` into a `<script>` via `dangerouslySetInnerHTML` without HTML-escaping. `runtimeConfig` includes `CURRENT_USER.username` and other admin/env strings. A value containing `</script>` or `<` breaks out of the script tag (XSS).

```tsx
// src/app/layout.tsx:115-119 — current
<script
  dangerouslySetInnerHTML={{
    __html: `window.RUNTIME_CONFIG = ${JSON.stringify(runtimeConfig)};`,
  }}
/>
```

## Target

Canonical fix (`react-doctor/unsafe-json-in-html`): JSON.stringify does not HTML-escape. Escape `<`, `>`, `&` (and line separators), or use an HTML-safe serializer / JSON script tag + `JSON.parse`.

```ts
// src/lib/serialize-for-html-script.ts — target
export function serializeForHtmlScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
```

```tsx
// src/app/layout.tsx — target
<script
  dangerouslySetInnerHTML={{
    __html: `window.RUNTIME_CONFIG = ${serializeForHtmlScript(runtimeConfig)};`,
  }}
/>
```

## Repo conventions to follow

- Keep layout as a Server Component.
- Imitate existing head injection in `src/app/layout.tsx`.
- Colocate unit tests as `*.test.ts` next to the util.

## Steps

1. Add `src/lib/serialize-for-html-script.ts` with the helper above.
2. Import and use it in `src/app/layout.tsx:117` instead of raw `JSON.stringify`.
3. Add `src/lib/serialize-for-html-script.test.ts` asserting a payload with `</script>` does not emit the literal substring `</script>`.
4. Leave `runtimeConfig` field shape unchanged.

## Boundaries

- Do NOT add a new npm dependency for serialization.
- Do NOT change auth/session parsing.
- STOP if RUNTIME_CONFIG injection was already moved off `dangerouslySetInnerHTML`; report drift.

## Verification

- **Mechanical**: `npx react-doctor@latest --scope changed` clears `unsafe-json-in-html`; `pnpm test -- serialize-for-html-script`; `pnpm typecheck`.
- **Behavior check**: Load `/` while logged in; `window.RUNTIME_CONFIG` still parses in DevTools.
- **Done when**: diagnostic clear, tests pass, client still reads RUNTIME_CONFIG.
