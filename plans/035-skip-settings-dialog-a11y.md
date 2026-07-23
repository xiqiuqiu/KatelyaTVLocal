# 035 — Make SkipController settings a real dialog

- **Status**: DONE
- **Commit**: 411e0c2
- **Severity**: HIGH
- **Category**: Accessibility
- **Rule**: Beyond the scan (dialog semantics / focus / Escape)
- **Estimated scope**: 1 file (`src/components/SkipController.tsx`), medium

## Problem

Plan 010 already labeled controls. The settings surface is still a plain overlay:

```tsx
// src/components/SkipController.tsx:847-849 — current
{isSettingMode && (
  <div className='fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4'>
    <div className='bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 w-full max-w-4xl max-h-[90vh] overflow-y-auto …'>
```

Gaps confirmed in code:

- No `role="dialog"` / `aria-modal="true"` / `aria-labelledby` pointing at the
  existing `<h3>` (“智能跳过设置”).
- No document `keydown` Escape → `onSettingModeChange?.(false)`.
- No initial focus move into the panel; no focus return to the control that
  opened settings (`:1615`, `:1803`).
- Backdrop is a non-interactive `div` (click-outside may or may not close —
  close is only on explicit buttons today).

This panel opens during playback — a high-frequency assistive path.

## Target

```tsx
// target shape
{isSettingMode && (
  <div
    className='fixed inset-0 … z-[9999] p-4'
    role='presentation'
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) onSettingModeChange?.(false);
    }}
  >
    <div
      ref={settingsDialogRef}
      role='dialog'
      aria-modal='true'
      aria-labelledby='skip-settings-title'
      className='bg-white dark:bg-gray-800 …'
      tabIndex={-1}
    >
      <h3 id='skip-settings-title' className='…'>
        智能跳过设置
      </h3>
      …
    </div>
  </div>
)}
```

Behavior to implement in a `useEffect` keyed on `isSettingMode`:

1. When `true`: store `document.activeElement` as restore target; `focus()` the
   dialog container or the close button (`aria-label='关闭跳过设置'` already at
   `:862`).
2. While open: `keydown` on `document` — if `key === 'Escape'`, call
   `onSettingModeChange?.(false)` and `preventDefault`.
3. When `false` / cleanup: remove listener; restore focus to the stored element
   if still in the document.
4. Optional light focus trap: Tab cycles within the dialog’s focusable elements
   (query `button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`).
   If a full trap is too large, Escape + initial focus + `aria-modal` are the
   minimum bar for this plan.

## Repo conventions to follow

- Imitate Escape wiring from plan 009’s UserMenu pattern (document listener
  while open).
- Keep existing close button handlers that reset `batchSettings`.
- Do not pull in Headless UI Dialog unless already a dependency on this path
  (`@headlessui/react` exists in the repo — optional; prefer minimal local
  effect to avoid restyling).

## Steps

1. Add `id='skip-settings-title'` to the settings `<h3>`.
2. Mark the panel `role='dialog' aria-modal='true' aria-labelledby=…`.
3. Add open/close focus + Escape effect as above.
4. Allow backdrop click-to-close if it does not break drag/select inside the
   panel (use `target === currentTarget`).
5. Add/extend a SkipController test if one exists for settings open; otherwise
   manual verification is enough.

## Boundaries

- Do NOT change skip timing / segment persistence logic.
- Do NOT merge numeric `parseFloat` hardening (finding #19) into this plan.
- Do NOT split the giant file here (separate maintainability work).
- STOP if settings already moved into a Dialog component; enhance that instead.

## Verification

- **Mechanical**: `pnpm typecheck`; focused SkipController tests if present.
- **Behavior check**: Open 智能跳过设置 — focus lands in dialog; Escape closes
  and returns focus to the opener; screen reader announces dialog name; mouse
  close button still works; playback skip runtime unchanged when panel closed.
- **Done when**: dialog semantics + Escape + focus return work on desktop and
  mobile browsers used by the app.
