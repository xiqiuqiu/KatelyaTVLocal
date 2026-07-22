# KatelyaTVLocal Context

KatelyaTVLocal is a video discovery and playback application. This context defines project-specific playback and source terminology used when designing user-facing viewing behavior.

## Language

**Design Direction**:
The role of `UI_1.0_web.png` in UI work: the authoritative visual and information-architecture direction for color, hierarchy, card language, and spacing rhythm — not a pixel-perfect acceptance checklist. Intentional deviations (capabilities the product has that the mock lacks, or mock structures that would change working playback interaction) are allowed when recorded explicitly.
_Avoid_: hard mock acceptance; inspiration-only moodboard; silent drift from the mock

**Primary Viewing Surface**:
The user-facing screens in scope for Design Direction alignment: home, search, playback, Douban category browsing, login, and the user menu. Admin, TVBox, and debug surfaces are outside that alignment scope.
_Avoid_: full-site redesign; treating admin or TVBox as Design Direction acceptance surfaces

**UI Alignment Slice**:
A Design Direction change that stays in visual-only or structural territory: tokens, spacing, hierarchy, section composition, and card information architecture — without changing playback probing/switching/resume, search aggregation meaning, favorites, or other user-facing behavior. Behavioral or data-contract changes are out of a UI Alignment Slice and need their own decision.
_Avoid_: mixing playback interaction redesign into a style pass; silent behavioral changes under a "UI polish" label

**Accepted Design Deviation**:
A deliberate, recorded departure from `UI_1.0_web.png` that stays in product: keep AI Find on search, keep the playback episode/source side panel (instead of below-player tabs), and keep the live brand name ReelFind rather than the mock's KatelyaTV.
_Avoid_: treating these as unfinished mock debt; closing them "for free" inside a UI Alignment Slice

**Structural Alignment Target**:
The composition gaps a UI Alignment Slice is meant to close on Primary Viewing Surfaces: home Hero, search category tabs and richer result cards, and the playback lower detail / "猜你喜欢" composition — without converting playback chrome into a behavioral redesign.
_Avoid_: counting side-panel-to-tabs migration as a Structural Alignment Target

**Desktop-First Alignment**:
Design Direction acceptance for a UI Alignment Slice is judged on desktop web against `UI_1.0_web.png`. Narrow viewports must keep the shared shell and tokens usable, but `UI_1.0_APP.png` is not an acceptance reference for that slice.
_Avoid_: dual web+app mock acceptance in one slice; freezing mobile token/shell updates entirely

**Secondary Surface Polish**:
On Douban browsing, login, and the user menu, a UI Alignment Slice only applies visual-only alignment to shared tokens, shell, and control language — not new structural compositions.
_Avoid_: treating Douban/login/menu structural redesign as part of the same slice as home/search/play Structural Alignment Targets

**Playback Session**:
A user's active attempt to watch one selected title through one playable source and episode position. A Playback Session includes user playback actions, browser video events, source changes, recovery decisions, progress saving, and debug evidence for that active watch attempt.

**Playback Attempt**:
The evidence-correlation unit for one Playback Session. All browser events, session decisions, source feedback, debug logs, and user actions for that watch are joined by a single `sessionId` from play-page entry until title change, leave, or session end. Same-title source switches and episode changes stay inside one Playback Attempt.
_Avoid_: minting a new correlation id on every source switch; using content or route keys alone as the attempt identity

**Source Attempt**:
One actual start or switch onto a playable source inside a Playback Attempt, correlated by `(sessionId, sourceChangeAttemptId)` and stamped with content, episode, source, and runtime dimensions.
_Avoid_: treating source preference probes that never start playback as Source Attempts

**Playback Intent**:
The single authoritative record, for the current Playback Session, of whether the user wants playback to continue, pause, scrub the timeline, or change source or episode. Playback Intent is stamped only by explicit user gestures; ambiguous media pause or stall events are not user intent.
_Avoid_: playIntent, userPausedAt, pauseReason (as parallel authorities)

**Playback Recovery Stage**:
The shared business-level escalation ladder for handling non-user stalls inside a Playback Session: observe (R0), same-source in-place recovery (R1), bad-point escape (R2), then automatic source switch (R3). R1 and R2 are both same-source recovery; R3 is automatic source switch. Every stage above observe may run only when Playback Intent allows automatic behavior. Runtime adapters may differ in how they detect stall candidates, but must not invent a private escalation ladder.
_Avoid_: separate HLS-only or Native-only recovery authorities; treating seek/buffer pauses as stalls

**Stall Episode**:
One continuous non-user stall incident inside a Playback Session, starting at the first Intent-eligible stall candidate and ending on healthy progress, user cancellation, episode/title change, session end, or an actual automatic source switch. Brief playing that does not meet the healthy-progress threshold does not start a new Stall Episode.
_Avoid_: counting seek-guard or user-paused waiting as a Stall Episode

**Bad Point**:
A remembered fault anchor for a playable source timeline inside a Playback Session, identified by `(sourceKey, anchorTimeSeconds)`. Each Bad Point projects to a Known Fault Interval used to plan resume times so recovery does not land back inside the same failure band.
_Avoid_: treating every transient waiting event as a Bad Point; using rewind into a Known Fault Interval as recovery

**Known Fault Interval**:
The time range projected from a Bad Point — roughly `[anchor - matchWindow, escapeEnd)` — that automatic recovery must not choose as a resume landing. Overlapping failures on the same source merge into one Bad Point by expanding `escapeEnd` rather than creating near-duplicate anchors.
_Avoid_: resume loops that repeatedly seek into a previously failed band

**Bad Point Scope**:
The visibility container for Bad Points: `(contentKey, episodeIndex)`. Same-episode cross-source recovery may treat other sources' fault times as timeline hazards; changing episode hides the previous scope; changing title or ending the Playback Session clears bad-point memory. Cancelling recovery does not erase Bad Points.
_Avoid_: a single tab-global bad-point list shared across unrelated titles; carrying episode A's fault times into episode B

**Recovery Resume Time**:
The single authoritative playhead the system intends to apply after reload, bad-point escape, or source switch inside a Playback Session. Automatic same-episode switches seed from an escape-adjusted time and re-plan against cross-source timeline hazards so resume does not land inside a Known Fault Interval.
_Avoid_: parallel per-runtime resume clocks; carrying a raw stuck timestamp inside a Known Fault Interval onto the next source unchanged; treating Recovery Resume Time as cross-session watch history

**Watch Progress**:
The cross-session authoritative record of where the user left off for one episode of one title. Its identity is `(contentKey, episodeIndex)`; `source` and `id` are resume-route preferences on that record, not the progress identity. Same-episode source changes keep one shared progress identity and adapt time onto the new route; episode changes seal the previous episode's progress as its own record.
_Avoid_: using `source+id` alone as the logical progress identity; one mutable record that overwrites episode index and drops prior-episode progress; equating Watch Progress with Recovery Resume Time

**Apple MMS Runtime**:
The single playback runtime on Apple mobile devices (iPhone/iPad): hls.js running via `ManagedMediaSource` on iOS/iPadOS 17.1+ (`'ManagedMediaSource' in window` and `Hls.isSupported()`), converged with Android on one engine and one Playback Recovery Stage. It is the only iPhone/iPad runtime — there is no native HLS fallback and no kill-switch; devices without MMS (iOS ≤ 16, iPhone X/8 and earlier) cannot play and land on a `device-unsupported` error prompting an upgrade. Requires `disableRemotePlayback = true`, so AirPlay is not available. Tagged `apple-hlsjs` in telemetry. See ADR 0006.
_Avoid_: reintroducing a native-HLS runtime as a co-equal or fallback engine; a separate Apple recovery ladder; treating AirPlay as still supported

**Native Recovery Decision Tree** _(retired — see ADR 0006)_:
Formerly the single decision path that consumed all iOS Native recovery evidence (watchdog stall severity and jitter) and emitted Playback Recovery Stage actions. Retired when the native HLS runtime was removed and Apple moved to the Apple MMS Runtime; iOS stall/error evidence now flows through the hls.js adapter into the shared Playback Recovery Stage, with no runtime-private ladder.
_Avoid_: resurrecting native watchdog/jitter/severity logic as a parallel commander beside the hls.js recovery path

**Ad Skip Window**:
A time range on one playable source's episode timeline that the system may bypass automatically during a Playback Session because it is judged to be advertising rather than content. Its identity is `(source, id, episodeIndex)` plus the time range, anchored on the logical episode timeline so it survives segment URL or host rotation, and it persists and is shared across users within one deployment. Distinct from ordinary seeking (a user navigation) and from Recovery Resume Time (progress recovery).
_Avoid_: keying a window by segment URL/host; sharing windows across sources for the same title; treating it as a per-session ephemeral analyzer output

**Ad Placement Stability**:
The working assumption that, for a given `(source, id, episodeIndex)`, advertising sits at the same timeline position for all users and across reloads — occasional host or directory rotation does not move it. This is what makes a persisted Ad Skip Window reusable rather than per-request guesswork.
_Avoid_: assuming stability for sources observed to insert ads randomly per request

**Ad Window Trust Tier**:
The escalation ladder deciding how forcefully an Ad Skip Window is applied during a Playback Session: observe only, recoverable auto-skip (skipped with a one-tap undo), or silent auto-skip. A window's tier is driven by accumulated Ad Window Confirmation evidence, not by a single report or by analyzer confidence alone.
_Avoid_: letting analyzer confidence authorize silent skipping; per-runtime private skip ladders

**Ad Window Confirmation**:
The ground-truth signal for an Ad Skip Window: a user's explicit mark that a range is advertising, or their undo/restore indicating a skip was wrong. Confirmations and undos accumulate to move a window up or down the Ad Window Trust Tier.
_Avoid_: treating one anonymous report as immediately authoritative for all users

**Source Availability**:
The system's current judgement of whether a candidate source can be shown, tried manually, or selected automatically during a Playback Session. Source Availability is derived from source status, playback evidence, remembered preferences, measured speed, and the current episode position. Source Availability is a decision model, not the probing or storage mechanism that gathers evidence.

**Related Recommendation (相关推荐)**:
The play-page row of same-kind titles derived from the title currently being watched — Douban "also-liked" for that title, with a genre-tag fallback drawn from its `vod_class`, excluding the current title and heavily-watched titles while keeping favorites. It is discovery-first (cards route through search to become playable and are not pre-verified) and never falls back to generic popularity; when no relevant items exist it shows nothing. Distinct from the home hot lists and from the same-title Source list.
_Avoid_: 猜你喜欢 (as the label for this now content-based row); treating it as a personalized taste model; treating it as a guaranteed-playable list.
