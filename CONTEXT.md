# KatelyaTVLocal Context

KatelyaTVLocal is a video discovery and playback application. This context defines project-specific playback and source terminology used when designing user-facing viewing behavior.

## Language

**Playback Session**:
A user's active attempt to watch one selected title through one playable source and episode position. A Playback Session includes user playback actions, browser video events, source changes, recovery decisions, progress saving, and debug evidence for that active watch attempt.

**Playback Intent**:
The single authoritative record, for the current Playback Session, of whether the user wants playback to continue, pause, scrub the timeline, or change source or episode. Playback Intent is stamped only by explicit user gestures; ambiguous media pause or stall events are not user intent.
_Avoid_: playIntent, userPausedAt, pauseReason (as parallel authorities)

**Ad Skip Window**:
A time range in an HLS playback timeline that the system has identified as safe to skip automatically during a Playback Session. An Ad Skip Window is distinct from ordinary seeking because it represents a system decision to bypass detected advertising content, not a user navigation action or progress recovery.

**Source Availability**:
The system's current judgement of whether a candidate source can be shown, tried manually, or selected automatically during a Playback Session. Source Availability is derived from source status, playback evidence, remembered preferences, measured speed, and the current episode position. Source Availability is a decision model, not the probing or storage mechanism that gathers evidence.
