# ADR 0005: Play-page recommendations become content-based Related Recommendation

## Status

Accepted

## Context

The play-page "猜你喜欢" row (`play-recommendations.ts` / `PlayRecommendations.tsx`) had no relationship to what the user is watching. It fetched three Douban hot lists (movie/tv/variety) and merely pushed the current title's category pool to the front and excluded the current title — effectively a "hot poster wall" mislabeled as a recommendation. ADR 0003 named this row a Structural Alignment Target but scoped that work to visual/structural changes; CONTEXT explicitly requires a behavioral/data-contract change like this to be its own decision. This ADR is that decision.

Signals actually available in this project constrain the options: the currently-playing title carries genre tags in `detail.class` (`vod_class`, e.g. "喜剧,爱情") and an often-missing `detail.douban_id` (many Apple CMS sources emit `0`); Douban is reachable only through the existing proxy, whose `search_subjects?tag=` supports genre-tag queries and whose subject page can be HTML-scraped (precedent: `handleTop250`). `DoubanItem` cards themselves have no genre field.

## Decision

Make the row a **content-based Related Recommendation** anchored on the title currently being watched, sourced from Douban's "喜欢这部的人也喜欢" (also-liked) for that title.

- **Resolution chain (new server endpoint, e.g. `/api/douban/recommends`).** Use `detail.douban_id`; if missing, resolve the Douban subject id from the title via `subject_suggest(q=title)`; then scrape the subject page's also-liked block. Keep the scrape/fallback logic server-side so the client calls one endpoint.
- **Two-tier fill, relevance first, no hot fallback.** Also-liked items first, topped up by a genre-tag query derived from `vod_class`, ordered most-relevant-first. If both tiers are empty the row renders nothing (the component already returns `null`). We would rather show nothing than pass off generic popularity as a recommendation.
- **Discovery-first, not playability-guaranteed.** Cards keep `from='douban'` routing (click → search → match a source), with no pre-verification of playability — consistent with home cards, and avoiding per-item search cost on Edge.
- **Light de-duplication, not personalization.** Exclude the current title and heavily-watched titles (from `PlayRecord`); keep favorites (a favorite often signals intent to (re)watch). This is redundancy removal, not a taste model.
- **Cache like other Douban routes.** Key by `douban_id`/title and reuse `getCacheTime()` CDN/browser cache headers.
- **Rename the row to "相关推荐".** The content is now genuinely related, so the honest label replaces the generic "猜你喜欢".

## Considered Options

- **Genre-tag only (no also-liked scrape).** Cheaper and no subject-page/​`subject_suggest` coupling, but weaker relevance ("same genre" ≠ "similar title"). Kept as the fallback tier rather than the primary signal.
- **AI semantic similarity (Workers AI) over title+desc.** Better relevance but consumes the per-user/IP D1 quota and adds latency/cost on every play-page load. Rejected for the default row.
- **Playability-guaranteed pool** (pre-run aggregate search per candidate, or recommend only from our own source search results). Rejected: per-item search on Edge is too expensive, and "similar" is hard to express as a source keyword search.
- **Keep the hot-wall.** Rejected — it is the problem being fixed.

## Consequences

- A new Douban recommendation endpoint introduces a scraping dependency on Douban's subject-page also-liked block and `subject_suggest`; a Douban redesign can break the primary signal, so the genre-tag fallback and empty-state are load-bearing, not optional.
- Worst case (no resolvable `douban_id` and no usable `vod_class` genre) the row is absent — an accepted "nothing over irrelevant" trade-off.
- Discovery-first keeps the existing dead-end risk (a recommended title may match no source); accepted in exchange for zero pre-verification cost.
- Each play-page load adds one cached Douban round-trip.
