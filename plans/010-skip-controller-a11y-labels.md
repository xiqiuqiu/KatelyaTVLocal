# 010 — Label SkipController icon-only controls and inputs

- **Status**: TODO
- **Commit**: ea3113d
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Rule**: react-doctor/control-has-associated-label / label-has-associated-control / no-static-element-interactions
- **Estimated scope**: 1 file (`SkipController.tsx`), small–medium

## Problem

Play-path SkipController has icon-only buttons without accessible names (e.g. `:707`, `:1162`, `:1183`, `:1200`, `:1310`) and detached labels on time inputs (`:840`, `:878`, `:935`, `:973`). Mobile backdrop at `:1267` is a clickable static element.

## Target

Canonical: every control needs a name — visible text, `aria-label`, or `aria-labelledby`. Labels must wrap controls or use `htmlFor`.

```tsx
// target examples
<button type="button" aria-label="关闭跳过设置" onClick={...}>...</button>
<label htmlFor="skip-opening-start">片头开始</label>
<input id="skip-opening-start" ... />
<button type="button" aria-label="关闭跳过面板" className="fixed inset-0 ..." onClick={...} />
```

## Repo conventions to follow

- Chinese `aria-label` copy consistent with TopSearchBar (`提交搜索`, sidebar labels).
- Do not alter skip timing math.

## Steps

1. Enumerate every React Doctor a11y hit in `SkipController.tsx` from a fresh `--scope changed` or file scan.
2. Add `aria-label` / `htmlFor` / convert backdrop to `button` as appropriate.
3. Ensure `type="button"` on non-submit buttons if missing.
4. Smoke the skip settings panel on desktop and mobile widths.

## Boundaries

- Do NOT merge with #006/#020 logic changes beyond labels/keys if those plans already edited the file — rebase carefully.
- Do NOT remove emoji/icons; only add accessible names.

## Verification

- **Mechanical**: SkipController a11y diagnostics clear; typecheck.
- **Behavior check**: Open skip settings with VoiceOver/Accessibility inspector — controls have names; Esc/backdrop still closes.
- **Done when**: labeled controls, diagnostics clear.
