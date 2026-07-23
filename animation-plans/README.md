# Animation improve-animations plans

Audit commit baseline: **0094879**.

Produced by `/improve-animations` for every vetted finding (01–12) plus missed opportunities (13–16). Execute with any agent via `improve-animations execute <plan>` or by following each file’s Steps literally. Plans are self-contained — do not rely on the audit chat.

> Note: `plans/` is reserved for improve-react / other work. Animation plans live here in `animation-plans/`.

## Recommended execution order

| Order | Plan | Severity | Depends on | Notes |
|------:|------|----------|------------|-------|
| 1 | [010](010-unify-motion-tokens.md) | MEDIUM | — | Land tokens/easing first so later plans can reference them |
| 2 | [002](002-fix-reduced-motion-nuke.md) | HIGH | — | A11y baseline before adding more motion |
| 3 | [001](001-replace-transition-all-high-traffic.md) | HIGH | 010 optional | Ban `transition-all`; coordinate with 003/004 property lists |
| 4 | [003](003-capsule-indicator-transform.md) | HIGH | 001 | Capsule/Douban indicator → `translateX` |
| 5 | [004](004-progress-bars-scalex.md) | HIGH | 001 | Progress `scaleX` ≤200ms |
| 6 | [005](005-remove-poster-grid-enter.md) | HIGH | 010 optional | Kill grid stagger; shorten `.ui-reveal` |
| 7 | [006](006-strip-videocard-hover-stack.md) | HIGH | 001 | Remove card hover decoration |
| 8 | [011](011-mobile-bottom-nav-no-decorative-motion.md) | MEDIUM | — | Bottom nav color-only selection |
| 9 | [009](009-gate-hover-transforms.md) | MEDIUM | 006, 011 | Gate remaining hover transforms |
| 10 | [007](007-skipcontroller-personality-align.md) | HIGH | — | SkipController visual/motion personality |
| 11 | [008](008-skipcontroller-interruptible-transitions.md) | MEDIUM | 007 | Toast/drawer transitions |
| 12 | [012](012-calm-logo-ambient.md) | LOW | 002 | Static/calm brand ambient |
| 13 | [014](014-sidebar-label-fade-with-width.md) | LOW | 001 | Sidebar label sync |
| 14 | [013](013-usermenu-enter-exit.md) | LOW | 002, 010 | UserMenu origin-aware enter/exit |
| 15 | [015](015-search-mode-results-crossfade.md) | LOW | 005, 010 | Search branch fade |
| 16 | [016](016-aifind-group-result-enter.md) | LOW | 005, 010, 015 optional | AI group result enter |

## Status board

| # | Plan | Severity | Status |
|--:|------|----------|--------|
| 001 | [Replace transition-all](001-replace-transition-all-high-traffic.md) | HIGH | TODO |
| 002 | [Fix reduced-motion nuke](002-fix-reduced-motion-nuke.md) | HIGH | TODO |
| 003 | [Capsule indicator transform](003-capsule-indicator-transform.md) | HIGH | TODO |
| 004 | [Progress bars scaleX](004-progress-bars-scalex.md) | HIGH | TODO |
| 005 | [Remove PosterGrid enter](005-remove-poster-grid-enter.md) | HIGH | TODO |
| 006 | [Strip VideoCard hover stack](006-strip-videocard-hover-stack.md) | HIGH | TODO |
| 007 | [SkipController personality](007-skipcontroller-personality-align.md) | HIGH | TODO |
| 008 | [SkipController interruptible](008-skipcontroller-interruptible-transitions.md) | MEDIUM | TODO |
| 009 | [Gate hover transforms](009-gate-hover-transforms.md) | MEDIUM | TODO |
| 010 | [Unify motion tokens](010-unify-motion-tokens.md) | MEDIUM | TODO |
| 011 | [MobileBottomNav no decorative motion](011-mobile-bottom-nav-no-decorative-motion.md) | MEDIUM | TODO |
| 012 | [Calm logo ambient](012-calm-logo-ambient.md) | LOW | TODO |
| 013 | [UserMenu enter/exit](013-usermenu-enter-exit.md) | LOW | TODO |
| 014 | [Sidebar label fade](014-sidebar-label-fade-with-width.md) | LOW | TODO |
| 015 | [Search crossfade](015-search-mode-results-crossfade.md) | LOW | TODO |
| 016 | [AI Find group enter](016-aifind-group-result-enter.md) | LOW | TODO |

## Dependencies (summary)

- **010 → many**: tokens/easing referenced by later plans; safe to hardcode AUDIT cubic-beziers if executing out of order.
- **001 → 003/004/014**: stop `transition-all` before specializing transform/width.
- **006/011 → 009**: remove intentional decoration before gating leftovers.
- **007 → 008**: personality cleanup before toast/drawer rewiring (same file).
- **005 → 015/016**: do not reintroduce long grid stagger when adding view enters.
