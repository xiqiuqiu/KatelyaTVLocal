# KatelyaTVLocal Context

KatelyaTVLocal is a video discovery and playback application. This context defines project-specific playback and source terminology used when designing user-facing viewing behavior.

## Language

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

**Native Recovery Decision Tree**:
The single decision path that consumes all iOS Native recovery evidence — including watchdog stall severity and jitter — and emits Playback Recovery Stage actions. Jitter may strengthen a move into bad-point escape, but must not bypass Intent gates or run as a parallel seek/switch commander beside the watchdog path.
_Avoid_: native-jitter-skip-forward side effects that never enter the shared recovery decision

**Ad Skip Window**:
A time range in an HLS playback timeline that the system has identified as safe to skip automatically during a Playback Session. An Ad Skip Window is distinct from ordinary seeking because it represents a system decision to bypass detected advertising content, not a user navigation action or progress recovery.

**Source Availability**:
The system's current judgement of whether a candidate source can be shown, tried manually, or selected automatically during a Playback Session. Source Availability is derived from source status, playback evidence, remembered preferences, measured speed, and the current episode position. Source Availability is a decision model, not the probing or storage mechanism that gathers evidence.
