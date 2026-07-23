# 033 — Give TopSearchBar input an accessible name

- **Status**: DONE
- **Commit**: 411e0c2
- **Severity**: HIGH
- **Category**: Accessibility
- **Rule**: react-doctor/no-placeholder-only-field
- **Estimated scope**: 1 file (`src/components/TopSearchBar.tsx`), tiny

## Problem

Canonical (`no-placeholder-only-field`): add a visible (or programmatically
associated) label; keep placeholder for example hints only.

```tsx
// src/components/TopSearchBar.tsx:77-83 — current
<input
  type='text'
  placeholder='搜索影片、电视剧、综艺...'
  value={query}
  onChange={(e) => setQuery(e.target.value)}
  className='h-11 w-full rounded-full border-0 bg-transparent px-5 text-sm … focus:outline-none focus:ring-0'
/>
```

The submit button has `aria-label='提交搜索'` (`:87`) but the text field itself
has no `<label>`, `aria-label`, or `aria-labelledby`. This is the global search
control in `AppShell`.

While here, restore a keyboard focus affordance without a heavy redesign: the
form already uses `focus-within:border-[…]`; keep that, and prefer
`focus-visible:ring-2` (or drop `focus:ring-0` only) so focus is not fully
suppressed — optional secondary step if it stays behavior-preserving.

## Target

Minimal product-preserving fix (visible label optional in the compact bar):

```tsx
// target
<input
  type='text'
  aria-label='搜索影片、电视剧、综艺'
  placeholder='搜索影片、电视剧、综艺...'
  value={query}
  onChange={(e) => setQuery(e.target.value)}
  className='…'
/>
```

If adding a visually hidden label is preferred for consistency with login forms:

```tsx
<label htmlFor='top-search-query' className='sr-only'>
  搜索影片、电视剧、综艺
</label>
<input id='top-search-query' … />
```

Use whichever pattern already exists in the repo (`sr-only` appears in several
components — grep before inventing a new utility).

## Repo conventions to follow

- Chinese copy consistent with the placeholder.
- Do not introduce a permanent visible label that breaks the centered search
  chrome unless design already has room.

## Steps

1. Add `aria-label` **or** `sr-only` + `htmlFor`/`id` on the input at `:77`.
2. Keep placeholder text.
3. Optionally soften `focus:ring-0` to allow `focus-visible` ring if it does not
   fight the existing `focus-within` chrome.
4. Smoke with a screen reader or Accessibility tree: field name is non-empty.

## Boundaries

- Do NOT restyle the entire header.
- Do NOT touch `YouTubeSearchBar` (unused).
- STOP if the input already gained a name; report drift.

## Verification

- **Mechanical**: `npx react-doctor@latest --scope changed` clears
  `no-placeholder-only-field` for `TopSearchBar.tsx`.
- **Behavior check**: Tab to the search field — name announced / shown in
  Accessibility panel; submit still works; visual layout unchanged.
- **Done when**: control has an associated accessible name.
