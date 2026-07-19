# 009 — Make UserMenu overlays keyboard-accessible

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Rule**: react-doctor/no-static-element-interactions (+ click-events-have-key-events)
- **Estimated scope**: 1 file (`UserMenu.tsx`), small; also fix password labels if touching the panel

## Problem

```tsx
// src/components/UserMenu.tsx:196-199 — current
<div
  className='fixed inset-0 z-[1000] bg-transparent'
  onClick={handleCloseMenu}
/>
```

Same pattern at `:281` for change-password. Static `div` with click only — no role/keyboard. Password fields at `:306`/`:321` use `<label>` without `htmlFor`.

## Target

Canonical: use a native `button` (or add `role="button"` + key handlers). Prefer:

```tsx
<button
  type="button"
  aria-label="关闭菜单"
  className="fixed inset-0 z-[1000] bg-transparent"
  onClick={handleCloseMenu}
/>
```

Also wire `Escape` on `document` while open to call the same close handler. For password inputs: `htmlFor`/`id` pairs.

```tsx
<label htmlFor="user-menu-new-password" className="...">新密码</label>
<input id="user-menu-new-password" type="password" ... />
```

## Repo conventions to follow

- Match existing `aria-label` style on TopSearchBar sidebar button.
- Keep visual glass/blur classes unchanged.
- Extend `src/components/__tests__/user-menu.test.tsx` if present.

## Steps

1. Replace both overlay `div`s with `button type="button"` + Chinese `aria-label`.
2. Add Escape-to-close while menu / password panel open; remove listener on close/unmount.
3. Associate password labels with inputs via `htmlFor`/`id`.
4. Update tests for Escape / overlay button.

## Boundaries

- Do NOT change auth API calls.
- Do NOT restyle the menu.
- STOP if overlays already use Headless UI Dialog; integrate with that instead of duplicating.

## Verification

- **Mechanical**: a11y diagnostics on these lines clear; user-menu tests; typecheck.
- **Behavior check**: Tab to menu, open, press Escape — closes. Overlay activatable via keyboard. Screen reader announces dismiss control.
- **Done when**: diagnostics clear, keyboard path works.
