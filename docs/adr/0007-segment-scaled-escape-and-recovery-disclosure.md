# ADR 0007: Scale R2 escape to one media segment; disclose only expectation-changing recovery

## Status

Accepted

## Context

Mid-stall recovery aimed at Continuous Viewing. The previous same-source bad-point escape used a fixed forward jump of about twenty seconds after a larger edge rewind. That quantum treated the hazard as a long timeline hole.

On the Apple CMS V10 collection sources this product plays, HLS media segments are typically a few seconds each, and real stuck faults are usually frame-, GOP-, or single-segment-scale — not twenty seconds of unusable content. The oversized escape burned plot, encouraged forward ratcheting inside one Stall Episode, and forced Recovery Disclosure to treat almost every R2 as expectation-changing.

Mainstream players (YouTube-style buffering, hls.js hole nudge) keep sub-second to low-single-digit self-heals silent and only surface failures or actions that change what the user is watching.

## Decision

1. **Segment-Scaled Escape for R2.** Forward bad-point escape advances approximately one nearby media segment from the playlist (`#EXTINF` when known). When segment duration is unavailable, use a typical mid-segment fallback (about 6–8s) and mark that path in telemetry so fallback is not mistaken for playlist-true success.

2. **One forward escape, then R3.** Inside one Stall Episode, attempt a single forward Segment-Scaled Escape; if the stall continues, escalate to automatic source switch rather than widening same-source jumps. Existing escape-count / cumulative-span caps remain safety valves, not the primary ladder.

3. **Small edge rewind only.** A reduced edge rewind (about 1–2s or a fraction of segment duration) may clear a segment boundary before the forward escape. It does not consume the one-forward-escape quota. Do not keep a large multi-second rewind as the default first motion.

4. **Recovery Disclosure.** R0–R1 and that single Segment-Scaled Escape stay silent by default (player buffering chrome is fine). R3 must disclose in-player with a short undo window and with the source list always reflecting the current source — same recoverable short-bar pattern as Ad Skip undo, but heavier and longer-lived. When the ladder is exhausted, show an In-Player Failure State (blocking error on the video surface, stay on the play page) with retry, manual source switch, and leave — not a separate error route.

5. **Playback Intent wins.** Explicit pause, scrub, or manual source switch cancels in-flight automatic recovery; manual source switch ends the Stall Episode and starts a user-chosen Source Attempt.

This ADR adjusts R2 quantum, disclosure, and exhaustion UX. It does not replace the Playback Recovery Stage ladder (R0–R3) or the command-driven Playback Session module (ADR 0001).

## Consequences

- Same-source recovery should lose less content per escape and ratchet less aggressively toward the end of an episode.
- R3 becomes the main user-visible recovery moment; R2 tips should become rare unless a safety-valve jump is abnormally large.
- Playlist-dependent escape distance needs a reliable segment-duration signal (or honest fallback telemetry) in the recovery adapter.
- Golden tests and constants that assume a fixed +20s skip / +5s rewind must be updated with the Segment-Scaled Escape model.
- Open-start, ad-skip product work, and pure chrome polish remain out of this decision's delivery slice unless they share the recoverable short-bar pattern already required for R3.
