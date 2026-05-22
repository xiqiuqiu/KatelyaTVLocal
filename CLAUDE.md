# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (pre-generates config/manifest before starting)
pnpm dev

# Build for production
pnpm build

# Cloudflare Pages build
pnpm pages:build

# Linting & formatting
pnpm lint              # next lint
pnpm lint:fix          # eslint --fix + prettier
pnpm lint:strict       # eslint --max-warnings=0 (used by pre-commit)
pnpm format            # prettier -w .
pnpm format:check      # prettier -c .
pnpm typecheck         # tsc --noEmit --incremental false

# Testing
pnpm test              # jest (full suite)
pnpm test:watch        # jest --watch
pnpm test -- -t "test name pattern"  # run a single test

# Code generation (auto-run before dev/build)
pnpm gen:runtime       # converts config.json → src/lib/runtime.ts
pnpm gen:manifest      # generates public/manifest.json
pnpm gen:version       # generates version info
```

**Pre-commit hook (husky + lint-staged):** `eslint --max-warnings=0` + `prettier -w` on staged `.ts/.tsx` files; `prettier -w` on `.json/.css/.md`.

**Package manager:** pnpm (v10). **Node version:** 18+.

## Architecture

### Stack

Next.js 14 App Router, TypeScript 5, Tailwind CSS 3, ArtPlayer + HLS.js for video playback, Framer Motion for animations.

Key dependencies: `@dnd-kit/*` (drag-and-drop admin), `@headlessui/react` + `@heroicons/react` (UI primitives), `sweetalert2` (alert dialogs), `swiper` (touch carousels), `next-themes` (dark mode), `lucide-react` (icons), `tailwind-merge` + `clsx` (class merging), `@vidstack/react` (video player components).

### Storage: multi-backend `IStorage` interface

Defined in `src/lib/types.ts`. Five implementations selected via `NEXT_PUBLIC_STORAGE_TYPE` env var:

| Value | Class | File |
|-------|-------|------|
| `localstorage` (default) | `LocalStorage` | `src/lib/localstorage.db.ts` |
| `redis` | `RedisStorage` | `src/lib/redis.db.ts` |
| `kvrocks` | `KvrocksStorage` | `src/lib/kvrocks.db.ts` |
| `d1` | `D1Storage` | `src/lib/d1.db.ts` |
| `upstash` | `UpstashRedisStorage` | `src/lib/upstash.db.ts` |

The `IStorage` interface covers: play records, favorites, users (register/verify/delete/changePassword), search history, skip configs (opening/ending), and admin config. All five implementations satisfy the same interface.

**Singleton access:** `getStorage()` in `src/lib/db.ts` returns the active instance. `DbManager` wraps it with convenience methods that auto-generate keys (`source+id`).

### Client vs server data layer split

`src/lib/db.ts` — server-side (imports all DB drivers, Node.js APIs).  
`src/lib/db.client.ts` — browser-only (`'use client'`, uses `fetch` + `localStorage`).

**Hybrid caching** (`HybridCacheManager` in `db.client.ts`): For non-localstorage modes, data is cached in browser `localStorage` with a 1-hour TTL. Writes use optimistic updates (cache first, then async API call). Reads return cached data immediately while background-fetching fresh data. Components subscribe to `CustomEvent` updates (`playRecordsUpdated`, `favoritesUpdated`, `searchHistoryUpdated`).

### D1 database abstraction (`src/lib/d1.ts`)

`getD1Database()` retrieves a D1 instance from environment bindings (Cloudflare Pages) or `process.env`. The `D1DatabaseLike` / `D1PreparedStatementLike` interfaces abstract D1 operations (`prepare`, `bind`, `all`, `first`, `run`). Used by `D1Storage` for the main DB and by AI usage/registration invite APIs for quota tracking.

### Config flow

```
config.json  →  scripts/convert-config.js  →  src/lib/runtime.ts (auto-generated)
                                                       ↓
                                              src/lib/config.ts
                                              (merges runtime config with DB admin config)
```

- `config.json` — Apple CMS V10 API source definitions (`api_site` + `cache_time`).
- `runtime.ts` — auto-generated TypeScript file from `config.json`; imported at build time.
- `config.ts` — `getConfig()` reads runtime config, merges with database-stored admin config (for non-localstorage modes). Auto-completes missing sources and users. `getAvailableApiSites()` returns only non-disabled sources.
- Docker environments (`DOCKER_ENV=true`) read `config.json` at runtime via `require('fs')` instead of the build-time `runtime.ts`.
- `resetConfig()` rebuilds admin config from file + DB users, preserving sources and user list.

### Auth & middleware

`src/middleware.ts` protects all routes except static assets and a whitelist of public API routes (defined in the `config.matcher` regex). Auth flow:

- **localstorage mode:** plain password comparison against `PASSWORD` env var, then the server signs a versioned session cookie.
- **Other modes (redis/d1/etc.):** owner login checks `USERNAME` + `PASSWORD`, database users check stored passwords, and the server signs the resulting session cookie with `AUTH_SIGNING_SECRET`.

`src/lib/auth.ts` provides `getAuthInfoFromCookie()` (server) and `getRuntimeCurrentUser()` (client runtime fallback). Client UI can also call `/api/session` for the current minimal user info.

`src/lib/admin-auth.ts` — `isAdminRequest()` checks if the current user is owner or has `role: 'admin'` in `AdminConfig.UserConfig`.

**Turnstile verification** (`src/lib/turnstile.ts`): `verifyTurnstileToken()` validates Cloudflare Turnstile tokens for login/register endpoints. Controlled by `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` env vars and `LOGIN_TURNSTILE_REQUIRED` config.

**Registration invite system** (`/api/admin/registration-invites`): When `REGISTER_INVITE_REQUIRED=true`, registration requires a valid invite code. Invites are stored in D1 and managed by admins. Used alongside Turnstile for bot protection.

### API routes (App Router handlers in `src/app/api/`)

| Route | Purpose |
|-------|---------|
| `/api/search` | Aggregate search across all enabled sources |
| `/api/search/one` | Search a single source |
| `/api/search/resources` | List available sources |
| `/api/detail` | Get episode list for a video |
| `/api/parse` | Parse video URL |
| `/api/playrecords` | CRUD for play progress records |
| `/api/favorites` | CRUD for favorites |
| `/api/searchhistory` | Search history management |
| `/api/skip-configs` | Opening/ending skip configs |
| `/api/image-proxy` | Image proxy for cross-origin images |
| `/api/hls-proxy` | HLS stream proxy (also applies ad filtering) |
| `/api/source-probe` | Probe source availability and CORS accessibility |
| `/api/source-preference` | Rank sources by probe results for best playback |
| `/api/source-feedback` | Playback feedback for source ranking quality |
| `/api/tvbox` | TVBox-compatible config endpoint |
| `/api/server-config` | Public server status/config |
| `/api/session` | Current user session info |
| `/api/login`, `/api/register`, `/api/logout` | Auth |
| `/api/change-password` | User password change |
| `/api/admin/config` | Admin config CRUD (site, users, sources) |
| `/api/admin/site` | Site settings management |
| `/api/admin/source` | Source management |
| `/api/admin/user` | User management |
| `/api/admin/ai-usage` | AI usage quota monitoring |
| `/api/admin/registration-invites` | Registration invite code management |
| `/api/admin/reset` | Reset config to defaults |
| `/api/douban` | Douban integration proxy |
| `/api/douban/categories` | Douban category listing |
| `/api/ai/find` | AI-powered content search (single source) |
| `/api/ai/find/group` | AI-powered content search (multiple sources) |
| `/api/cron` | Cron trigger for scheduled tasks |

### Pages (App Router)

- `/` — Home: Douban hot lists + continue watching + favorites
- `/search?q=` — Multi-source search results (with AI Find assistant panel)
- `/play?source=&id=&episode=` — Video player (ArtPlayer + HLS.js) with source switching sidebar
- `/douban?type=` — Douban category browsing
- `/tvbox` — TVBox config interface
- `/tvbox-debug` — TVBox debugging page
- `/config` — Configuration viewer
- `/admin` — Admin panel (site config, source management, user management, AI usage, invites)
- `/login` — Login page
- `/warning` — Shown when no PASSWORD is set

### Key components (`src/components/`)

**Video playback:** `VideoCard` (reusable card with poster, title, episodes, rating, favorite), `EpisodeSelector` (episode grid with selection/playback state), `SkipController` (opening/ending skip segments), `ContinueWatching` (horizontal scrollable in-progress row).

**Player (`player/`):** `PlayerHeader` (top bar with back nav and source info), `PlayerSidebar` (source switching panel with quality/speed indicators).

**Layout:** `PageLayout`, `Sidebar`, `MobileBottomNav`, `MobileHeader`, `TopSearchBar`, `YouTubeSearchBar`, `BackButton`, `ScrollableRow`.

**UI primitives (`ui/`):** `AppShell`, `Surface`, `PosterGrid`, `PageHeader`, `SectionHeader`, `CardActions`, `ActionLink`, `LoadingPrimitives`.

**AI:** `AiFindPanel` — sidebar panel for AI-powered content discovery.

**Misc:** `CapsuleSwitch`, `DoubanSelector`, `DoubanCardSkeleton`, `ImagePlaceholder`, `UserMenu`, `ThemeToggle`, `SiteProvider`, `ThemeProvider`, `IOSCompatibility`.

### Downstream search (`src/lib/downstream.ts`)

`searchFromApi()` queries a single source API (Apple CMS V10 format), parses `vod_play_url` for M3U8 episode links, and can paginate across multiple pages (configurable via `SearchDownstreamMaxPage`). `getDetailFromApi()` fetches episode detail. Some sources (like `ffzy`) use HTML scraping instead of the JSON API for detail pages.

### AI Find (`src/components/AiFindPanel.tsx`, `/api/ai/find`)

AI-powered content search using Cloudflare Workers AI. Searches across sources and returns recommendations. Admin page (`/api/admin/ai-usage`) monitors per-user and per-IP quotas stored in D1.

### HLS ad filtering (`src/lib/hls-ad-filter.ts`, `src/lib/hls-ad-rules.ts`)

`filterAdsFromM3U()` removes ad segments from M3U8 playlists before they reach the player. Detects ads via: CUE-OUT/CUE-IN markers, SCTE-35 tags, DATERANGE ad markers, URL keyword patterns, alternate CDN host detection, and known ad rule matching. The HLS proxy (`/api/hls-proxy`) applies this filter transparently. Debug info is logged as `M3U8AdFilterDebugInfo` with detailed block removal summaries.

### Source preference & playback probing (`src/lib/source-preference.ts`, `src/lib/playback-source-switch.ts`)

**Probing:** `probeSourcePlaybackWithCache()` tests whether a source URL is reachable and CORS-accessible, categorizing as `direct`, `proxy`, or `unavailable`. Results cached in Cloudflare Cache when available. `sortSourcePreferenceResults()` ranks sources by status priority then probe speed.

**Source switching:** `getSourceSwitchResumePlan()` determines resume time when switching between sources for the same episode — preserves current playback position if switching same episode, resets to 0 for different episodes.

### CORS

`src/lib/cors.ts` provides permissive CORS headers (`Access-Control-Allow-Origin: *`) used by API routes for OrionTV / TVBox client compatibility.

### PWA

`next-pwa` plugin generates a service worker in `public/`. Disabled in development. Manifest generated by `scripts/generate-manifest.js`.

### Path aliases

- `@/*` → `./src/*`
- `~/*` → `./public/*`

## Testing

Jest 27 with `next/jest`, `@testing-library/react`, and `jest-environment-jsdom`. Tests live alongside source files (`*.test.ts`/`*.test.tsx`). SVG imports are mocked via `src/__mocks__/svg.tsx`.

## Environment variables

See README for the full table. Key ones: `PASSWORD` (required), `USERNAME`, `NEXT_PUBLIC_STORAGE_TYPE`, `REDIS_URL`, `NEXT_PUBLIC_IMAGE_PROXY`, `NEXT_PUBLIC_DOUBAN_PROXY`, `NEXT_PUBLIC_ENABLE_REGISTER`, `NEXT_PUBLIC_SEARCH_MAX_PAGE`, `SITE_NAME`, `ANNOUNCEMENT`, `DOCKER_ENV`, `AUTH_SIGNING_SECRET`, `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`, `LOGIN_TURNSTILE_REQUIRED`, `REGISTER_INVITE_REQUIRED`, `NEXT_PUBLIC_SOURCE_RANKING_ENABLED`.
