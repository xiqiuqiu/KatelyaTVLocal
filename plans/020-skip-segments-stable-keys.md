# 020 — Use stable keys for SkipController segment lists

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: MEDIUM
- **Category**: Bugs & correctness
- **Rule**: react-doctor/no-array-index-as-key
- **Estimated scope**: 1 file (+ types if needed), small

## Problem

```tsx
// src/components/SkipController.tsx:1335-1338 — current
{skipConfig.segments.map((segment, index) => (
  <div
    key={index}
```

Delete-by-index then reorders keys → wrong row state/focus. Same pattern around `:1523`.

## Target

Canonical: stable per-item id.

```ts
// when adding a segment
{ id: crypto.randomUUID(), type, start, end }
```

```tsx
key={segment.id}
```

If persisted configs lack `id`, migrate on read: map segments to add `id` when missing (content hash or uuid), persist back on next save. Never use index alone.

## Repo conventions to follow

- Align with `SkipSegment` type in `src/lib/types` (extend optionally).
- Keep opening/ending semantics.

## Steps

1. Extend `SkipSegment` with optional/required `id: string`.
2. Ensure create/edit paths assign ids.
3. Replace `key={index}` at both list sites with `key={segment.id}`.
4. Migrate loaded configs missing ids once in `loadSkipConfig`.

## Boundaries

- Do NOT change skip timing algorithm beyond identity.
- Coordinate with #006/#010 on the same file.

## Verification

- **Mechanical**: `no-array-index-as-key` clear; typecheck.
- **Behavior check**: Add three segments, delete the middle — remaining editors keep correct times.
- **Done when**: stable keys + migration works.
