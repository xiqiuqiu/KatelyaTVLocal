# ADR 0008: Treat TV Mode as a playback interaction adapter

## Status

Accepted

TV Mode uses an explicit playback-page entry and owns television layout, focus, remote confirmation, and panel-dismiss behavior, while Web Mode keeps its existing interaction. Both modes call the same Playback Session and existing episode, source, recovery, favorite, and progress handlers; TV Mode must not introduce a second player, duplicate playback policy, or overlay a second fullscreen control surface. Instead, it makes the existing ArtPlayer controls focusable and preserves that focus through fullscreen transitions. This keeps the verified television-specific behavior replaceable without splitting playback truth across two implementations.
