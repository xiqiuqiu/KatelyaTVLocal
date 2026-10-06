# ADR 0008: Treat TV Mode as a playback interaction adapter

## Status

Accepted

TV Mode supports explicit entry or conservative television User-Agent detection on supported pages; explicit choices and a saved Web preference override detection. It owns television layout, focus, remote confirmation, and panel-dismiss behavior, while Web Mode keeps its existing interaction. Both modes call the same Playback Session and existing episode, source, recovery, favorite, and progress handlers; TV Mode must not introduce a second player, duplicate playback policy, or overlay a second fullscreen control surface. Instead, it makes the existing ArtPlayer controls focusable and preserves that focus through fullscreen transitions. This keeps the verified television-specific behavior replaceable without splitting playback truth across two implementations.
