# Play-page Related Recommendation (content-based)

> Spec for ADR 0005. See `docs/adr/0005-content-based-related-recommendation.md` and the `Related Recommendation` term in `CONTEXT.md`.

## Problem Statement

When I'm watching a title, the play page shows a "猜你喜欢" row that has nothing to do with what I'm actually watching. It is just a wall of Douban hot posters — the only nod to context is pushing the current title's category to the front and hiding the exact title I'm on. As a viewer, it gives me no reason to believe these are "for me right now", so I ignore it.

## Solution

Replace the hot-poster wall with a **Related Recommendation** row that is derived from the title currently being watched: titles that people who liked this title also liked (Douban "喜欢这部的人也喜欢"), topped up by same-genre titles when needed, and never padded with generic popularity. The row is renamed to "相关推荐", stays discovery-first (a card still routes through search to become playable), and quietly drops titles I've already watched a lot. When nothing relevant can be found, the row shows nothing rather than faking relevance.

## User Stories

1. As a viewer on the play page, I want the recommendation row to be based on the title I'm currently watching, so that the suggestions feel relevant instead of random.
2. As a viewer, I want to see titles that "people who liked this also liked", so that I can discover things genuinely similar to what I chose.
3. As a viewer whose current title has no Douban id on the source, I want the system to still find its Douban entry from the title text, so that I don't lose relevant recommendations just because the source omitted the id.
4. As a viewer of an obscure title Douban can't resolve at all, I want the row to fall back to same-genre titles (from the title's genre tags), so that I still get topically-related suggestions.
5. As a viewer of a title with neither a resolvable Douban entry nor usable genre tags, I want the row to simply not appear, so that I'm never shown a generic hot list disguised as a recommendation.
6. As a viewer, I want the row labeled "相关推荐" (not "猜你喜欢"), so that the label honestly reflects that the content is related to what I'm watching.
7. As a viewer, I don't want the title I'm currently watching to appear in its own recommendation row, so that the row isn't wasted on a redundant card.
8. As a viewer, I don't want titles I've already watched a lot to clutter the row, so that recommendations lean toward things I haven't seen.
9. As a viewer, I want titles I've favorited to still be eligible to appear, so that "want to (re)watch" picks aren't filtered out.
10. As a viewer, I want the related row to fill a full row when possible (also-liked first, then same-genre), ordered most-relevant-first, so that the strongest matches are seen first.
11. As a viewer who taps a recommended card, I want it to behave like any Douban card elsewhere (go to search/detail and match a source), so that the interaction is consistent with the home page.
12. As a viewer, I accept that a recommended card may occasionally match no source, in exchange for recommendations loading instantly without per-item verification.
13. As a viewer, I want the row to load quickly and not re-hit Douban on every visit, so that navigating between episodes/titles stays snappy.
14. As a returning viewer, I want the recommendation for a given title to be consistent (cached), so that it doesn't reshuffle randomly each visit.
15. As a viewer on a slow or flaky network, I want a loading skeleton and a graceful empty state, so that a Douban hiccup never breaks the play page.
16. As a mobile viewer, I want the related row to keep the existing horizontal-scroll card layout, so that the experience is unchanged except for relevance.
17. As a viewer in `localstorage` mode, I want the "already watched a lot" filtering to use my local history, so that de-duplication still works without a server account.
18. As a maintainer, I want the also-liked scraping to be covered by parser tests, so that a Douban markup change surfaces as a failing test rather than a silently empty row.
19. As a maintainer, I want the merge/rank/exclude logic to be a pure, unit-tested function, so that recommendation behavior is verifiable without network or DOM.

## Implementation Decisions

Respecting ADR 0005 and the `Related Recommendation` term.

### Server: new Douban recommendation endpoint

- Add a server endpoint (working name `/api/douban/recommends`, `runtime = 'edge'`) that, given the current title's identity, returns ranked recommendation candidates in two labeled tiers: `alsoLiked` and `genreFallback`.
- **Resolution chain:**
  1. Use the current title's `douban_id` when the source provides it.
  2. If missing, resolve the Douban subject id from the title text via Douban `subject_suggest` (parsed by a pure helper).
  3. With a subject id, fetch and scrape the subject page's "喜欢这部的人也喜欢" block into `DoubanItem[]` (parsed by a pure helper).
  4. Independently, derive a genre tag from the title's `vod_class` (`detail.class`) and query the existing Douban `search_subjects?tag=` to produce `genreFallback` candidates.
- **No generic-popularity tier.** If both tiers are empty, the endpoint returns an empty list.
- **Caching:** key by `douban_id`/title; reuse the existing `getCacheTime()` CDN/browser cache headers, matching other `api/douban` routes. The endpoint returns only non-user-specific data so it is safe to share in CDN cache.
- **Parsing is pure and separable.** Douban HTML/JSON parsing lives in pure helpers (`parseDoubanAlsoLiked`, `parseDoubanSubjectSuggest` or equivalent) with no network, so the scrape-fragility risk is test-covered.

### Client: `PlayRecommendations` + pure selection

- `PlayRecommendations` calls the single new endpoint instead of the three `getDoubanCategories` calls.
- **User-specific filtering stays on the client** (the shared CDN cache must not hold per-user data): the component reads the user's play history (`PlayRecord` via the client data layer) to build the "heavily-watched titles" exclusion set, then delegates ordering/exclusion/capping to the pure selection function.
- The pure selection function (evolve `selectPlayRecommendations`) is the single ranking authority. New shape (conceptual):

  ```ts
  selectPlayRecommendations({
    alsoLiked: DoubanItem[];
    genreFallback: DoubanItem[];
    excludeTitle?: string;          // current title
    watchedTitles?: string[];       // heavily-watched, favorites NOT included
    limit?: number;
  }): PlayRecommendation[]
  ```

  Behavior: concatenate `alsoLiked` then `genreFallback`, drop items without a poster, drop the current title and heavily-watched titles (title-normalized match, reusing the existing `normalizeTitle`), de-duplicate by Douban id/normalized title, cap at `limit`, preserving relevance-first order. Favorites are never excluded.
- **"Heavily-watched"** is defined as titles in `PlayRecord` whose progress passes a watched-enough threshold (e.g. a meaningful fraction of `total_time`, or a finished episode); exact threshold is an implementation detail to pick a sensible default and note it.
- **Label:** section title and `aria-label` change from "猜你喜欢" to "相关推荐".
- **Discovery-first:** cards keep `from='douban'` routing; no playability pre-verification.
- **States:** keep the existing skeleton while loading; render nothing (`return null`) when the selection result is empty.

### Wiring

- The play page passes the current title's identity to `PlayRecommendations`: at minimum `videoTitle`, the classified category (already computed via `classifySearchResult(detail)`), and — newly — `detail.douban_id` and `detail.class` so the endpoint can run the resolution chain and genre fallback.

## Testing Decisions

Good tests here assert **external behavior** — the ordering/exclusion contract and the parsed output of real-ish Douban payloads — never internal call sequences or private helpers' wiring.

- **Pure selection (`selectPlayRecommendations`)** — extend the existing `src/lib/play-recommendations.test.ts`. Cover: also-liked ordered before genre fallback; current title excluded; heavily-watched titles excluded; favorites NOT excluded; poster-less items dropped; de-duplication across tiers; `limit` respected; empty input → empty output. Prior art: the existing tests in that file.
- **Douban parsers** — new pure unit tests for `parseDoubanAlsoLiked(html)` (representative subject-page HTML snippet → `DoubanItem[]`, plus a "block missing / markup changed" case → `[]`) and `parseDoubanSubjectSuggest(json)` (suggest payload → subject id, and empty/none → null). Prior art: the regex-parse style in `handleTop250` (`api/douban/route.ts`) and HTML parsing in `downstream.ts`.
- **Play-page integration** — update `src/app/play/page.test.tsx` to mock the single new client fetch (`/api/douban/recommends`) instead of `getDoubanCategories`, and assert: the row renders with role/name "相关推荐", appears below the detail synopsis (existing ordering assertion), shows a recommended card, and renders nothing when the endpoint returns an empty list. Prior art: the existing "shows Design Direction detail hierarchy and 猜你喜欢 below the side panel" test.

## Out of Scope

- Personalized taste modeling / collaborative filtering across the user's whole history (this feature is content-anchored on the current title; `PlayRecord` is used only for de-duplication).
- AI-powered semantic similarity (Workers AI) for this row — considered and rejected in ADR 0005 for cost/quota.
- Guaranteed-playable recommendations (per-item aggregate-search pre-verification) — rejected in ADR 0005; the row stays discovery-first.
- Recommendation rows on any surface other than the play page (home hot lists, search, Douban browsing are untouched).
- Server-side per-user recommendation storage / cross-user collaborative signals.
- Changing the same-title Source list (source switching sidebar) — unrelated to this row.

## Further Notes

- Accepted risks are recorded in ADR 0005: Douban scrape fragility (mitigated by the genre-tag fallback + empty state + parser tests), worst-case empty row, discovery-first dead-ends, and one extra cached Douban round-trip per play-page load.
- The genre-tag mapping from `vod_class` vocabulary to Douban's tag vocabulary is the main relevance risk in the fallback tier; start with a straightforward mapping and iterate.
