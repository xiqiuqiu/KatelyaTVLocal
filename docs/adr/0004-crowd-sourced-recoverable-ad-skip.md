# ADR 0004: Shift ad filtering from manifest heuristics to crowd-sourced, recoverable ad-skip windows

## Status

Accepted

## Context

Ad handling was built as a manifest-text heuristic filter (`hls-ad-filter.ts` / `hls-ad-rules.ts`): CUE/SCTE-35/DATERANGE markers, URL keywords, alternate-host blocks, same-host foreign-path short runs, plus hand-written known rules. The external collection sources (采集源) this project plays are low-grade Apple CMS V10 feeds that rarely emit standard ad markers and splice ads with no fixed duration or insertion pattern. On these sources, advertising is often statistically indistinguishable from content at the manifest level — the code itself admits this (the `ruyi-ryplay12-jjk-s3-ep1` rule matches by exact per-episode `.ts` filenames because same-source normal content also uses short segments). The result is a hard method ceiling: heuristics cannot cover all sources, and known rules do not scale (roughly one rule per episode).

Two runtime paths had also diverged: desktop/Android physically deleted ad segment lines from the playlist (`client-filter`), while iOS seeked past detected windows (`ios-skip`).

## Decision

Treat manifest heuristics as a **candidate generator**, not the source of truth, and move the identification authority to **persisted, crowd-sourced Ad Skip Windows** confirmed by real user behavior.

- **Zero false positive over recall.** Never cut content or mis-seek; missing an ad is acceptable, damaging playback is not.
- **Recoverable auto-skip + tiered trust.** Any candidate (analyzer high-confidence seed, known rule, or user mark) is skipped with a one-tap undo. Undo/confirm behavior (Ad Window Confirmation) drives an Ad Window Trust Tier: observe → recoverable auto-skip → silent auto-skip. This makes an imperfect candidate *safe to ship*, which is what rehabilitates the existing heuristic engine as a cold-start seed rather than a filter that must be perfect.
- **Stable per episode.** We rely on Ad Placement Stability: for a given `(source, id, episodeIndex)` the ad sits at the same timeline position, so one confirmation is reusable for later viewers.
- **Identity anchored on the timeline.** A persisted window's identity is `(source, id, episodeIndex)` + time range, anchored on the logical episode timeline (mirroring the existing `Bad Point` model) so it is immune to segment URL / host rotation (e.g. `ryplay1` → `ryplay12`).
- **Manual capture snaps to structure.** A user's single "skip ad" tap is snapped to the enclosing discontinuity/segment-run block boundary via the existing block parser, yielding a content-aligned range without asking the user to mark endpoints.
- **Unify runtimes on seek.** Retire physical segment deletion as the default; all runtimes use the recoverable seek-based Ad Skip Window. Physical removal, if kept at all, is reserved for high-trust confirmed windows.
- **Per-deployment sharing.** Windows persist through the active `IStorage` backend and are shared within one deployment; `localstorage` mode degrades to self-only. No cross-deployment global cloud (untrusted instances would spread bad data and violate the zero-false-positive goal).

## Consequences

- The existing heuristic/known-rule engine is demoted to a cold-start candidate seed and regression-test anchor; it no longer needs to grow per-episode rules to be considered "working".
- A new persisted store of Ad Skip Windows (with trust score and undo/confirm counts) is introduced through `IStorage`, and the player gains an undo affordance plus a manual "mark ad" entry point.
- Physical manifest rewriting (`client-filter`) stops being the default desktop/Android path; the seek path becomes universal. Users may briefly glimpse an ad's first frames on skip — accepted for VOD in exchange for one unified, recoverable, lower-crash mechanism (and it sidesteps the PTS-hole / `BUFFER_STALLED` risks of physical removal).
- Abuse resistance rests on the trust tier and undo-driven demotion rather than on trusting any single report.
