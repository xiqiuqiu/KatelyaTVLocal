# 034 — Label AiFind input and announce loading/errors

- **Status**: DONE
- **Commit**: 411e0c2
- **Severity**: HIGH
- **Category**: Accessibility
- **Rule**: react-doctor/no-placeholder-only-field (+ Beyond: live regions)
- **Estimated scope**: 1 file (`src/components/AiFindPanel.tsx`), small

## Problem

```tsx
// src/components/AiFindPanel.tsx:645-651 — current
<input
  className='…'
  disabled={loading}
  onChange={(event) => setQuery(event.target.value)}
  placeholder='例如：90年代经典港片动作片，想看节奏快一点'
  value={query}
/>
```

Canonical (`no-placeholder-only-field`): associate a persistent label; keep the
placeholder as an example.

Async status is plain text with no live region:

```tsx
// src/components/AiFindPanel.tsx:669-680 — current
{loading ? (
  <span className='ml-1 text-[rgb(var(--ui-success))]'>
    {loadingText}
  </span>
) : null}
{error ? (
  <div className='flex items-center gap-2 …'>
    <AlertCircle className='h-4 w-4' />
    <span>{error}</span>
  </div>
) : null}
```

Screen readers never hear progress or failures unless focus is already on the
status node.

## Target

1. Label the field (visible heading nearby can be wired with `aria-labelledby`,
   or use an explicit label):

```tsx
// target — pick one; prefer visible association if a heading/id already exists
<label htmlFor='ai-find-query' className='sr-only'>
  AI 找片描述
</label>
<input
  id='ai-find-query'
  aria-describedby={error ? 'ai-find-error' : undefined}
  placeholder='例如：90年代经典港片动作片，想看节奏快一点'
  …
/>
```

2. Live regions:

```tsx
// target
{loading ? (
  <span
    className='ml-1 text-[rgb(var(--ui-success))]'
    role='status'
    aria-live='polite'
  >
    {loadingText}
  </span>
) : null}

{error ? (
  <div
    id='ai-find-error'
    role='alert'
    className='flex items-center gap-2 …'
  >
    <AlertCircle className='h-4 w-4' />
    <span>{error}</span>
  </div>
) : null}
```

## Repo conventions to follow

- Match login page’s `role='alert'` error pattern (`src/app/login/page.tsx`).
- Keep existing AiFind submit / abort / saved-records behavior (plans 014/017).

## Steps

1. Add `id` + `sr-only` label (or `aria-label='AI 找片描述'`) on the query input.
2. Add `role='status'` + `aria-live='polite'` on the loading text.
3. Add `role='alert'` (and stable `id`) on the error container; wire
   `aria-describedby` when error is present.
4. Extend `src/components/AiFindPanel.test.tsx` if present: assert label / roles.

## Boundaries

- Do NOT redesign the AI panel layout or copy beyond a11y attributes.
- Do NOT change `/api/ai/find` contracts.
- STOP if labels/live regions already exist; report drift.

## Verification

- **Mechanical**: `no-placeholder-only-field` clears for this input;
  `pnpm test -- AiFindPanel` if applicable.
- **Behavior check**: Start a find — status updates are exposed to AT; trigger
  an error — alert announced; visual look unchanged.
- **Done when**: input named; loading/error announced via live regions.
