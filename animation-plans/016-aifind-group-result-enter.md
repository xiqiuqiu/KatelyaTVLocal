# 016 — Soft-enter AI Find group results when loading finishes

- **Status**: TODO
- **Commit**: 0094879
- **Severity**: LOW (missed opportunity)
- **Category**: Missed opportunities
- **Estimated scope**: 1 file (`AiFindResultGroups.tsx`), small

## Problem

Each candidate group jumps from spinner Surface to PosterGrid with no enter:

```tsx
/* src/components/AiFindResultGroups.tsx:146-153 — current */
) : loadingGroups.includes(group.query) ? (
  <Surface className='flex items-center ...' variant='plain'>
    <Loader2 className='h-4 w-4 animate-spin' />
    <span>正在查询这个候选片名的资源站结果</span>
  </Surface>
) : groupErrors[group.query] ? (
```

(Success branch renders `PosterGrid` just above this conditional.)

## Target

When a group transitions loading → results, wrap the successful `PosterGrid` (or its parent) with:

```tsx
<div className="ui-ai-group-enter">
  <PosterGrid>...</PosterGrid>
</div>
```

```css
/* ui-theme.css */
@keyframes ui-ai-group-enter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.ui-ai-group-enter {
  animation: ui-ai-group-enter 180ms cubic-bezier(0.23, 1, 0.32, 1) both;
}
@media (prefers-reduced-motion: reduce) {
  .ui-ai-group-enter { animation: none; }
}
```

Values: **180ms**, ease-out strong, translate **8px**, scale not required. Do not stagger every poster (plan 005 removed that).

## Repo conventions to follow

- Reuse tokenized ease/duration from plan 010 if present (`--ease-out`, `--ui-motion-base`).
- Keep Surface variants unchanged.

## Steps

1. Add `.ui-ai-group-enter` keyframes to `ui-theme.css` (or reuse a shared `.ui-view-enter` if plan 015 already added one — prefer one shared class).
2. Wrap the success `PosterGrid` branch in AiFindResultGroups.
3. Do not animate error/empty states beyond optional opacity (optional, not required).
4. Confirm remounts on data refresh are acceptable (occasional).

## Boundaries

- Do NOT change AI fetch/grouping logic.
- Do NOT re-enable per-card stagger on `ui-poster-grid`.
- Do NOT add dependencies.

## Verification

- **Mechanical**: `pnpm typecheck`.
- **Feel check**: run AI找片 — when a group finishes, grid fades/slides 8px in ≤180ms instead of popping. Reduced-motion: instant.
- **Done when**: success branch has ≤180ms enter; no per-item stagger.
