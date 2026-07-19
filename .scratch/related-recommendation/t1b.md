## Parent

#41 — 播放页「相关推荐」：改为基于当前在播内容的同类推荐

## What to build

Ship the visible Related Recommendation row end-to-end using the genre-fallback signal. The play page's recommendation row stops being a generic Douban hot-poster wall and becomes a "相关推荐" row whose items are topically related to the title currently being watched, with the current title and heavily-watched titles filtered out and favorites kept.

## Acceptance criteria

- [ ] `PlayRecommendations` calls the single `/api/douban/recommends` endpoint instead of the three `getDoubanCategories` calls.
- [ ] User-specific filtering happens on the client: the component reads the user's play history (`PlayRecord` via the client data layer) to build the heavily-watched exclusion set, then delegates ordering/exclusion/capping to `selectPlayRecommendations`. Favorites are not excluded.
- [ ] The play page passes the current title's genre class (already available via `classifySearchResult(detail)` / `detail.class`) so the endpoint can produce genre candidates.
- [ ] The section title and `aria-label` change from "猜你喜欢" to "相关推荐".
- [ ] Cards keep `from='douban'` routing (discovery-first, no playability pre-verification); the existing horizontal-scroll card layout and loading skeleton are preserved; the row renders nothing when the selection result is empty.
- [ ] The play-page integration test is updated to mock the single new endpoint fetch (instead of `getDoubanCategories`) and asserts: the row renders with role/name "相关推荐", appears below the detail synopsis, shows a recommended card, and renders nothing when the endpoint returns an empty list.
- [ ] `pnpm typecheck` and `pnpm test` pass.

## Blocked by

- #42 — [相关推荐 T1a] 新端点(题材 tag) + 演进纯选择函数 selectPlayRecommendations
