# React improve-react plans

Latest audit commit baseline: **411e0c2**. Earlier plans retain their historical
execution context; plans **028–037** are based on this commit.

These plans were produced by `/improve-react` for vetted **HIGH** findings from
the 2026-07-23 audit. Execute with any agent via `improve-react execute <plan>`
or by following each file’s Steps literally.

## Current selected batch (HIGH risk @ 411e0c2)

| Order | Plan | Depends on | Notes |
|------:|------|------------|-------|
| 1 | [028](028-sanitize-login-redirect.md) | — | Open redirect after login/register |
| 2 | [029](029-play-resync-on-searchparams.md) | — | Soft-nav keeps stale play identity |
| 3 | [030](030-play-init-loading-finally.md) | 029 optional | Stuck full-page loading on init throw |
| 4 | [036](036-search-check-response-ok.md) | — | Search treats HTTP errors as empty hits |
| 5 | [031](031-cast-status-use-ref.md) | — | Cast state re-renders whole play page |
| 6 | [032](032-sidebar-compositor-transitions.md) | — | Sidebar width/padding layout jank |
| 7 | [033](033-topsearchbar-accessible-name.md) | — | Global search input unnamed |
| 8 | [034](034-aifind-label-and-live-regions.md) | — | AI find label + live regions |
| 9 | [035](035-skip-settings-dialog-a11y.md) | — | Skip settings dialog keyboard/focus |
| 10 | [037](037-episode-selector-single-source-owner.md) | — | Dual source-preference ownership |

**Still open / not in this batch**

| Item | Notes |
|------|-------|
| [002](002-upgrade-next-rsc-security-line.md) | **BLOCKED** — RSC advisory; needs `@opennextjs/cloudflare` migration before Next bump |
| PlayPageClient / SkipController giant split | Residual after 007; defer until 029/030/037 land |
| MEDIUM backlog from audit | douban loading finally, home async races, banned-session re-check, CapsuleSwitch tabs, ContinueWatching parallel delete |

## Historical execution order

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
| 22 | [022](022-restrict-image-proxy-content-types.md) | — | Public same-origin active-content injection |
| 23 | [023](023-validate-source-probe-targets.md) | Existing shared proxy URL policy | Authenticated SSRF / open redirects |
| 24 | [024](024-fail-closed-cron-auth.md) | — | Public cron fail-open |
| 25 | [025](025-protect-login-attempts.md) | D1 migration + Turnstile config | Brute-force protection |
| 26 | [026](026-isolate-playback-debug-clock.md) | — | Hot playback render path |
| 27 | [027](027-centralize-video-card-favorites.md) | — | Card-list subscription fan-out |

## Status board

| Plan | Status | Severity |
|------|--------|----------|
| 001-escape-runtime-config-json-in-html | DONE | HIGH |
| 002-upgrade-next-rsc-security-line | BLOCKED | HIGH |
| 003-harden-image-proxy-redirects | DONE | HIGH |
| 004-play-init-effect-abort-cleanup | DONE | HIGH |
| 005-play-beforeunload-stable-deps | DONE | HIGH |
| 006-skip-controller-pure-countdown-updater | DONE | HIGH |
| 007-split-play-page-add-error-boundary | DONE | HIGH |
| 008-harden-hls-proxy-redirects | DONE | MEDIUM |
| 009-usermenu-accessible-dismiss-overlay | DONE | MEDIUM |
| 010-skip-controller-a11y-labels | DONE | MEDIUM |
| 011-play-ref-writes-outside-render | DONE | MEDIUM |
| 012-appshell-pure-sidebar-toggle | DONE | MEDIUM |
| 013-siteprovider-memo-context-value | DONE | MEDIUM |
| 014-split-episode-selector-and-aifind | DONE | MEDIUM |
| 015-admin-hydration-storage-branch | DONE | LOW |
| 016-search-fetch-abort-race | DONE | HIGH |
| 017-aifind-guard-main-request-race | DONE | HIGH |
| 018-play-timeupdate-decouple-react-state | DONE | HIGH |
| 019-play-lazy-ref-init | DONE | HIGH |
| 020-skip-segments-stable-keys | DONE | MEDIUM |
| 021-async-race-favorite-skip-continue | DONE | MEDIUM |
| 022-restrict-image-proxy-content-types | DONE | HIGH |
| 023-validate-source-probe-targets | DONE | HIGH |
| 024-fail-closed-cron-auth | DONE | HIGH |
| 025-protect-login-attempts | DONE | HIGH |
| 026-isolate-playback-debug-clock | DONE | MEDIUM |
| 027-centralize-video-card-favorites | DONE | MEDIUM |
| 028-sanitize-login-redirect | DONE | HIGH |
| 029-play-resync-on-searchparams | DONE | HIGH |
| 030-play-init-loading-finally | DONE | HIGH |
| 031-cast-status-use-ref | DONE | HIGH |
| 032-sidebar-compositor-transitions | DONE | HIGH |
| 033-topsearchbar-accessible-name | DONE | HIGH |
| 034-aifind-label-and-live-regions | DONE | HIGH |
| 035-skip-settings-dialog-a11y | DONE | HIGH |
| 036-search-check-response-ok | DONE | HIGH |
| 037-episode-selector-single-source-owner | DONE | HIGH |

## Execution notes

- Plans are self-contained; executors should not need the audit chat.
- For rule-backed items, re-fetch canonical recipes if the codebase drifted:
  `npx react-doctor@latest rules explain <rule>`.
- After each plan: `npx react-doctor@latest --scope changed` plus the plan’s
  Verification section.
- **002 BLOCKED (2026-07-19):** Deploy path still uses `@cloudflare/next-on-pages`
  (Next 14 peer only; package deprecated). Patched Next ≥15.5.18 / 16.2.6
  requires migrating to `@opennextjs/cloudflare` first. Do not bump `next` without
  that adapter migration.
- **2026-07-23 selection:** user asked to process HIGH-risk findings first.
  Plans 028–037 cover those; MEDIUM backlog left unplanned until requested.
  Recommended order above: security/correctness → play perf → a11y → ownership.
