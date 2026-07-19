# React improve-react plans

Audit commit baseline: **ea3113d**. All plans status **TODO** until executed.

These plans were produced by `/improve-react` for every vetted finding. Execute with any agent via `improve-react execute <plan>` or by following each file’s Steps literally.

## Recommended order

| Order | Plan | Depends on | Notes |
|------:|------|------------|-------|
| 1 | [001](001-escape-runtime-config-json-in-html.md) | — | XSS; ship first |
| 2 | [003](003-harden-image-proxy-redirects.md) | — | Public SSRF surface |
| 3 | [008](008-harden-hls-proxy-redirects.md) | 003 (shared URL policy helper) | Authenticated proxy |
| 4 | [004](004-play-init-effect-abort-cleanup.md) | — | Play init race |
| 5 | [006](006-skip-controller-pure-countdown-updater.md) | — | Double next-episode risk |
| 6 | [016](016-search-fetch-abort-race.md) | — | Search race |
| 7 | [017](017-aifind-guard-main-request-race.md) | — | Before AiFind split |
| 8 | [021](021-async-race-favorite-skip-continue.md) | — | Favorite/skip/continue races |
| 9 | [005](005-play-beforeunload-stable-deps.md) | 011 optional | Progress save bindings |
| 10 | [011](011-play-ref-writes-outside-render.md) | — | Concurrent-safe refs |
| 11 | [019](019-play-lazy-ref-init.md) | — | Cheap perf win on play |
| 12 | [018](018-play-timeupdate-decouple-react-state.md) | — | Highest play perf leverage |
| 13 | [012](012-appshell-pure-sidebar-toggle.md) | — | Tiny |
| 14 | [013](013-siteprovider-memo-context-value.md) | — | Tiny |
| 15 | [009](009-usermenu-accessible-dismiss-overlay.md) | — | Global a11y |
| 16 | [010](010-skip-controller-a11y-labels.md) | 006, 020 if parallel | Same file as skip fixes |
| 17 | [020](020-skip-segments-stable-keys.md) | — | Segment list identity |
| 18 | [014](014-split-episode-selector-and-aifind.md) | 017 preferred first | Maintainability |
| 19 | [007](007-split-play-page-add-error-boundary.md) | 004, 005, 011, 018, 019 preferred | Large; after play bugfixes |
| 20 | [015](015-admin-hydration-storage-branch.md) | — | Cold path |
| 21 | [002](002-upgrade-next-rsc-security-line.md) | Prefer after 001–008 | Major upgrade; own PR |

## Status board

| Plan | Status | Severity |
|------|--------|----------|
| 001-escape-runtime-config-json-in-html | TODO | HIGH |
| 002-upgrade-next-rsc-security-line | TODO | HIGH |
| 003-harden-image-proxy-redirects | TODO | HIGH |
| 004-play-init-effect-abort-cleanup | TODO | HIGH |
| 005-play-beforeunload-stable-deps | TODO | HIGH |
| 006-skip-controller-pure-countdown-updater | TODO | HIGH |
| 007-split-play-page-add-error-boundary | TODO | HIGH |
| 008-harden-hls-proxy-redirects | TODO | MEDIUM |
| 009-usermenu-accessible-dismiss-overlay | TODO | MEDIUM |
| 010-skip-controller-a11y-labels | TODO | MEDIUM |
| 011-play-ref-writes-outside-render | TODO | MEDIUM |
| 012-appshell-pure-sidebar-toggle | TODO | MEDIUM |
| 013-siteprovider-memo-context-value | TODO | MEDIUM |
| 014-split-episode-selector-and-aifind | TODO | MEDIUM |
| 015-admin-hydration-storage-branch | TODO | LOW |
| 016-search-fetch-abort-race | TODO | HIGH |
| 017-aifind-guard-main-request-race | TODO | HIGH |
| 018-play-timeupdate-decouple-react-state | TODO | HIGH |
| 019-play-lazy-ref-init | TODO | HIGH |
| 020-skip-segments-stable-keys | TODO | MEDIUM |
| 021-async-race-favorite-skip-continue | TODO | MEDIUM |

## Execution notes

- Plans are self-contained; executors should not need this chat.
- For rule-backed items, re-fetch canonical recipes if the codebase drifted: `npx react-doctor@latest rules explain <rule>`.
- After each plan: `npx react-doctor@latest --scope changed` plus the plan’s Verification section.
- `002` is intentionally last among security items that need product scheduling — it is still required to fully clear the RSC advisory finding.
