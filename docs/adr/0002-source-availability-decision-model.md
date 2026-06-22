# ADR 0002: Use Source Availability as the source-switch decision model

## Status

Accepted

## Context

Source availability decisions currently live across the play page, the source panel, source probing helpers, remembered playback preferences, and recovery source selection.

The source panel decides whether a user can click a source. The play page decides which source automatic recovery should try. Browser probing, backend probing, local memory, source scores, current-source pinning, and current episode availability all affect those decisions.

This spreads source-switch knowledge across several modules. It makes the user-facing source panel and automatic recovery path easy to drift apart.

## Decision

Introduce Source Availability as the decision model for source-switch behaviour.

Source Availability is not the probing or storage mechanism. It does not fetch, write local storage, write D1, send feedback, or operate the video element. It receives existing evidence and returns source-switch decisions for adapters to execute.

The first implementation slice will focus on the source panel model. It should preserve current user-facing behaviour while moving the decision logic out of the source panel.

The Source Availability interface should provide at least two read models:

- `manualSwitch`, for user-initiated source switching in the source panel.
- `autoRecovery`, for future Playback Session recovery source selection.

These read models share the same underlying availability judgement, but they are not identical. Manual source switching may allow a user to try sources with incomplete evidence. Automatic recovery should be more conservative and should prefer sources with stronger playback evidence.

`currentEpisodeIndex` is a core input. A source is not available for switching when it lacks a playable URL for the current episode position, even if the source has other episodes.

The first slice must not change source ordering strategy, source scoring, current-source pinning, probe budgets, or the direct-first playback policy. Proxy-required sources should not be treated as automatically available in the first slice.

## Consequences

The source panel becomes an adapter that renders and executes decisions instead of owning source availability policy.

Playback Session can later consume the same Source Availability module for automatic recovery without copying panel-specific clickability rules.

Tests can exercise source-switch decisions through one interface: current source, current episode, remembered evidence, measured evidence, and source status in; manual and automatic availability decisions out.

Adapters remain responsible for performing side effects such as probing, remembering playback quality, emitting feedback, and switching the actual playback source.
