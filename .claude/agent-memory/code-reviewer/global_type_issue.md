---
name: Global Type for RUNTIME_CONFIG Not Used
description: `src/lib/types.ts` declares `window.RUNTIME_CONFIG?: RuntimeConfig` via global augmentation, but code casts to `(window as any)` instead of using the typed property.
type: feedback
---

Throughout `src/lib/utils.ts`, `(window as any).RUNTIME_CONFIG?.X` is used even though `types.ts` already augments `Window` with `RUNTIME_CONFIG?: RuntimeConfig`.

**Why:** The `as any` cast defeats TypeScript's ability to catch typos in property names. If a config property is renamed, the compiler won't flag the old references.

**How to apply:** Use `window.RUNTIME_CONFIG?.<property>` directly instead of `(window as any).RUNTIME_CONFIG?.<property>`. No extra type work is needed.
