# 017 — Animate ad-skip & R3 undo bars from the bottom edge

- **Status**: DONE
- **Commit**: 9ef3b24
- **Severity**: MEDIUM
- **Category**: Missed opportunities / Interruptibility
- **Estimated scope**: 2 files (`src/app/play/page.tsx`, `src/app/globals.css`), small–medium

## Problem

Ad Skip undo and R3 auto-source-switch undo are ArtPlayer layers toggled with instant `display: none` ↔ `display: flex`. They teleport into the bottom of the player with no spatial enter/exit — a jarring change for an occasional, high-stakes recoverable affordance (same short-bar language per ADR 0007).

```ts
/* src/app/play/page.tsx:771-780 — current sync (instant show/hide) */
const undoEl = art.layers?.adSkipUndo as HTMLElement | undefined;
if (undoEl) {
  undoEl.style.display = undoToastVisible ? 'flex' : 'none';
}
const autoSwitchUndoEl = art.layers?.autoSourceSwitchUndo as
  | HTMLElement
  | undefined;
if (autoSwitchUndoEl) {
  autoSwitchUndoEl.style.display = autoSwitchUndoVisible ? 'flex' : 'none';
}
```

```ts
/* src/app/play/page.tsx:5177-5213 — current layer chrome (no motion styles) */
{
  name: 'adSkipUndo',
  html: '<button type="button" aria-label="撤销广告跳过并恢复播放位置" style="pointer-events:auto;...">已为你跳过广告 · 点此恢复</button>',
  style: {
    display: 'none',
    position: 'absolute',
    left: '0',
    right: '0',
    bottom: '56px',
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
    zIndex: '50',
  },
  // ...
},
{
  name: 'autoSourceSwitchUndo',
  html: '<button ...>已自动切换线路 · 点此撤销</button>',
  style: {
    display: 'none',
    position: 'absolute',
    left: '0',
    right: '0',
    bottom: '64px',
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
    zIndex: '55',
  },
  // ...
},
```

`display` toggles cannot participate in CSS transitions, so any easing you add on opacity/transform will never run on exit (and often not on enter).

## Target

Both bars keep the same recoverable short-bar visual language. Drive visibility with **CSS transitions** (not `@keyframes`, not Framer Motion) so rapid show→hide retargets mid-flight.

Exact motion values (from AUDIT + repo tokens):

| Property | Closed | Open |
| --- | --- | --- |
| `opacity` | `0` | `1` |
| `transform` | `translateY(100%)` | `translateY(0)` |
| Duration | **180ms** (`--ui-motion-base`) | same |
| Easing | `cubic-bezier(0.23, 1, 0.32, 1)` (`--ease-out` / `easeOutStrong`) | same |

`translateY(100%)` = the bar’s **own height** (AUDIT: use percentages, no hardcoded px offsets). Bars sit at `bottom: 56px` / `64px`; rising from below reads as bottom-edge enter/exit.

```css
/* target — add to src/app/globals.css near play-page-player rules */
.player-undo-bar {
  display: flex !important; /* override ArtPlayer inline display; stay mounted */
  opacity: 0;
  transform: translateY(100%);
  transition:
    opacity 180ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
  pointer-events: none;
}

.player-undo-bar[data-open='true'] {
  opacity: 1;
  transform: translateY(0);
}

/* Parent pointer-events:none does NOT block children with pointer-events:auto */
.player-undo-bar button {
  pointer-events: none;
}

.player-undo-bar[data-open='true'] button {
  pointer-events: auto;
}

@media (prefers-reduced-motion: reduce) {
  .player-undo-bar {
    transform: none;
    transition: opacity 180ms cubic-bezier(0.23, 1, 0.32, 1);
  }

  .player-undo-bar[data-open='true'] {
    transform: none;
  }
}
```

Visibility API used by sync:

```ts
/* target helper — local to play/page.tsx (or tiny module if you prefer) */
function setPlayerUndoBarOpen(
  el: HTMLElement | undefined,
  open: boolean
): void {
  if (!el) return;
  el.classList.add('player-undo-bar');
  el.dataset.open = open ? 'true' : 'false';
  el.setAttribute('aria-hidden', open ? 'false' : 'true');
}
```

```ts
/* target syncAdSkipPlayerChrome — replace display toggles */
setPlayerUndoBarOpen(undoEl, undoToastVisible);
setPlayerUndoBarOpen(autoSwitchUndoEl, autoSwitchUndoVisible);
```

Initial ArtPlayer layer `style.display` for **both** undo layers: `'flex'` (not `'none'`), with `data-open` applied in `mounted` as `'false'` before first sync. Never flip these two layers with `style.display = 'none'` again — that kills the exit transition.

Enter guarantee: layers start closed (`data-open='false'`) in the DOM; when React state becomes non-null, sync sets `data-open='true'` on a subsequent frame so the transition runs. If a one-frame flash of the closed state is needed after ArtPlayer injects the node, use double `requestAnimationFrame` **only when opening from a freshly mounted closed bar** — do not use `@starting-style` unless you verify the deployed browser set for this app already relies on it elsewhere.

## Repo conventions to follow

- Motion tokens live in `src/styles/ui-theme.css`: `--ui-motion-base: 180ms`, `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`. Prefer those literal values in plain CSS (ArtPlayer layers are outside Tailwind class application).
- Interruptible toast/drawer pattern already shipped in SkipController (plan 008):

```css
/* exemplar — src/components/SkipController.tsx:1926-1936 */
.skip-toast {
  opacity: 0;
  transform: translateY(-8px);
  transition:
    opacity 180ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
}
.skip-toast[data-open='true'] {
  opacity: 1;
  transform: translateY(0);
}
```

  Undo bars mirror that pattern but use **bottom** travel (`translateY(100%)` → `0`) because they are bottom-anchored disclosure chips, not top toasts.
- Play-page ArtPlayer CSS already lives in `src/app/globals.css` under `.play-page-player` (~432+). Put `.player-undo-bar` in that file (global selector is fine — class is unique and must work in fullscreen where the layer is inside the player DOM).
- Personality: crisp consumer playback UI — 180ms ease-out, no bounce, no spring.

## Steps

1. **Add CSS** in `src/app/globals.css` exactly as in Target (including reduced-motion). Place it just above or below the existing `.play-page-player` mobile control rules (~432). Do not use `transition: all`. Do not add new `@keyframes` for this.

2. **Add `setPlayerUndoBarOpen`** in `src/app/play/page.tsx` near `syncAdSkipPlayerChrome` (same file, above the sync function is fine).

3. **Rewrite sync** in `syncAdSkipPlayerChrome` (~771–780): replace both `style.display` assignments for `adSkipUndo` and `autoSourceSwitchUndo` with `setPlayerUndoBarOpen(...)`. Leave `adSkipMarkFeedback` and `markAdSkip` display logic unchanged.

4. **Layer init** for `adSkipUndo` and `autoSourceSwitchUndo` (~5177–5220):
   - Change `style.display` from `'none'` to `'flex'`.
   - Keep position/bottom/zIndex/pointerEvents on the **container** as today (`pointerEvents: 'none'`).
   - In each `mounted` callback, before wiring the click handler:
     ```ts
     element.classList.add('player-undo-bar');
     element.dataset.open = 'false';
     element.setAttribute('aria-hidden', 'true');
     ```
   - Remove inline `pointer-events:auto` from the button HTML strings (CSS above owns open/closed hit-testing). Keep the rest of the button inline styles (radius, colors, copy, aria-label) unchanged.

5. **Do not delay Session dismiss / undo timers.** `dismissAfterMs` (5s ad-skip / 12s R3), `adSkipUndo.dismissed`, `autoSourceSwitchUndo.dismissed`, and `user.undo*` dispatch timing stay as they are. Visual exit is a consequence of React state → `data-open='false'`; a ~180ms fade-out after state clears is expected and must not block Session.

6. **Optional micro-guard (only if feel-check fails enter):** if opening sometimes snaps with no transition because ArtPlayer recreates the layer in the same frame as open, after `setPlayerUndoBarOpen(el, true)` path: if `el.dataset.open` was not already true, force `el.dataset.open = 'false'`, `void el.offsetWidth`, then `el.dataset.open = 'true'`. Do not add this unless the feel-check proves it is needed.

## Boundaries

- Do NOT change Playback Session reducer, dismiss durations, ADR 0007 disclosure rules, or undo click handlers’ business logic.
- Do NOT animate `adSkipMarkFeedback` in this plan (same bottom slot, but out of scope unless a follow-up asks).
- Do NOT use Framer Motion / `animate-*` keyframe utilities / `transition: all`.
- Do NOT change button copy, colors, blur, z-index stacking between the two bars, or bottom offsets (`56px` / `64px`).
- Do NOT add new dependencies.
- If line numbers drifted since commit `9ef3b24`, locate by symbol names (`syncAdSkipPlayerChrome`, `adSkipUndo`, `autoSourceSwitchUndo`) and STOP if the display-toggle pattern is already gone or replaced by a different motion system — report instead of inventing a second animation path.

## Verification

- **Mechanical**:
  - `rg "layers\\?\\.(adSkipUndo|autoSourceSwitchUndo).*display|adSkipUndo.*display.*none" src/app/play/page.tsx` — no remaining show/hide via `display` for these two layers.
  - `rg "player-undo-bar" src/app/globals.css src/app/play/page.tsx` — class defined and applied.
  - `pnpm typecheck`.
- **Feel check**:
  1. Trigger an auto ad-skip (non-silent window): bar rises from below over ~180ms; on timeout or “点此恢复”, it settles downward + fades (not an instant pop).
  2. Trigger R3 auto source switch: heavier bar uses the **same** bottom-edge motion (not a different curve/duration).
  3. Spam conditions that clear recoverable state (undo click, Playback Intent cancel if easy to hit): transition retargets; no keyframe restart from `translateY(100%)` mid-exit.
  4. DevTools Animations panel @ 10%: confirm only `opacity` + `transform`; no layout properties.
  5. Rendering → `prefers-reduced-motion: reduce`: opacity fade remains; **no** vertical travel.
  6. Enter fullscreen with a visible bar (or trigger skip while fullscreen): bar still animates and remains clickable — layers stay inside ArtPlayer.
- **Done when**: both undo bars open and close with 180ms ease-out bottom-edge motion, remain interruptible, honor reduced-motion (opacity only), and Session/undo behavior is unchanged.
