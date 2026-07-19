## Parent

#41 — 播放页「相关推荐」：改为基于当前在播内容的同类推荐

## What to build

The backend foundation for content-based Related Recommendation: a new Douban recommendation endpoint that, given the current title, returns ranked recommendation candidates for its **genre-fallback tier only** (same-genre titles derived from the title's `vod_class`), plus the evolved pure selection function that becomes the single ranking authority for the whole feature.

At the end of this ticket the endpoint is directly hittable and returns genre-relevant candidates, and the pure selection function fully encodes the two-tier merge / exclusion / de-dup / cap contract — even though the also-liked tier is not populated yet. No UI change ships here.

## Acceptance criteria

- [ ] A new server endpoint (working name `/api/douban/recommends`, `runtime = 'edge'`) accepts the current title's identity (at least title + genre class) and returns candidates in two labeled tiers, `alsoLiked` and `genreFallback`; in this ticket only `genreFallback` is populated (via the existing Douban `search_subjects?tag=` proxy using a genre tag derived from `vod_class`).
- [ ] The endpoint returns only non-user-specific data and sets the same `getCacheTime()` CDN/browser cache headers as other `api/douban` routes.
- [ ] When no genre tag can be derived and there are no candidates, the endpoint returns an empty list (no generic-popularity tier).
- [ ] `selectPlayRecommendations` is evolved to the shape `{ alsoLiked, genreFallback, excludeTitle, watchedTitles, limit }` and: concatenates `alsoLiked` before `genreFallback`, drops poster-less items, excludes the current title and heavily-watched titles (normalized-title match via the existing `normalizeTitle`), never excludes favorites, de-duplicates by Douban id / normalized title, caps at `limit`, and preserves relevance-first order.
- [ ] Unit tests extend the existing selection test file and cover: also-liked before genre fallback, current-title exclusion, heavily-watched exclusion, favorites-not-excluded, poster-less dropped, cross-tier de-dup, `limit` respected, empty input → empty output.
- [ ] `pnpm typecheck` and `pnpm test` pass; existing callers still compile.

## Blocked by

- None — can start immediately.
