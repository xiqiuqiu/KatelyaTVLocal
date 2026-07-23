# 012 — Calm continuous logo / particle ambient motion

- **Status**: DONE
- **Commit**: 0094879
- **Severity**: LOW
- **Category**: Cohesion
- **Estimated scope**: 1 file (`globals.css`), small

## Problem

Home/login brand treatments run continuous rainbow and particle loops that fight the restrained glass UI:

```css
/* src/app/globals.css — current exemplars */
.katelya-logo { animation: rainbow-flow 4s ease-in-out infinite; } /* ~55 */
.main-katelya-logo { animation: rainbow-flow-main 6s ease-in-out infinite; } /* ~130 */
/* particle-float ~180; glow-pulse ~98; float ~345 */
```

AUDIT: mismatched decorative personality in a crisp app; ambient may stay only if extremely slow and non-attention-seeking.

## Target

Prefer static brand color using existing tokens:

```css
.katelya-logo,
.main-katelya-logo {
  background: linear-gradient(
    90deg,
    rgb(var(--ui-accent)),
    rgb(var(--ui-accent-warm))
  );
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: none;
}
```

If a hint of life is required, one ambient only — aligned with `.ui-breathing-canvas` pacing (~16s), opacity-only, never hue-cycling rainbow:

```css
@keyframes logo-ambient {
  from { filter: saturate(1); }
  to { filter: saturate(1.08); }
}
/* only if feel-check demands it; default is animation: none */
```

Disable or delete particle-float / glow-pulse / float loops on the logo container (`.logo-background-glow`, particle elements). Prefer removing particles from DOM only if a React component owns them — CSS-only: `animation: none; opacity: 0.5` static glow.

Respect plan 002 reduced-motion (already `animation: none`).

## Repo conventions to follow

- Accent tokens in `ui-theme.css`.
- `.ui-breathing-canvas` is the ambient exemplar — match its restraint, do not invent a louder loop.

## Steps

1. Locate all rainbow/particle/float animations in `src/app/globals.css` via grep.
2. Set logo text animations to `none` with static accent gradient.
3. Neutralize glow/particle infinite animations (none or delete unused keyframes if safe).
4. Grep JSX for particle markup; if purely CSS pseudo-elements, CSS change suffices.

## Boundaries

- Do NOT redesign logo typography/layout.
- Do NOT touch player chrome.
- Do NOT reintroduce hue-cycle "rainbow-flow".

## Verification

- **Mechanical**: `rg "rainbow-flow|particle-float|glow-pulse" src/app/globals.css` shows keyframes unused or removed. `pnpm typecheck`.
- **Feel check**: home hero brand feels premium/static; no competing shimmer vs content.
- **Done when**: no infinite rainbow/particle motion on brand marks.
