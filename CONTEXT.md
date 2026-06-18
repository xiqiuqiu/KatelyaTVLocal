# KatelyaTVLocal Context

KatelyaTVLocal is a video discovery and playback application. This context defines project-specific playback and source terminology used when designing user-facing viewing behavior.

## Language

**Playback Session**:
A user's active attempt to watch one selected title through one playable source and episode position. A Playback Session includes user playback actions, browser video events, source changes, recovery decisions, progress saving, and debug evidence for that active watch attempt.

**Ad Skip Window**:
A time range in an HLS playback timeline that the system has identified as safe to skip automatically during a Playback Session. An Ad Skip Window is distinct from ordinary seeking because it represents a system decision to bypass detected advertising content, not a user navigation action or progress recovery.
