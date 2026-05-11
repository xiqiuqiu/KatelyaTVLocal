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
pnpm typecheck         # tsc --noEmit

# Testing
pnpm test              # jest (full suite)
pnpm test:watch        # jest --watch
pnpm test -- -t "test name pattern"  # run a single test

# Code generation (auto-run before dev/build)
pnpm gen:runtime       # converts config.json → src/lib/runtime.ts
pnpm gen:manifest      # generates public/manifest.json
```

**Pre-commit hook (husky + lint-staged):** `eslint --max-warnings=0` + `prettier -w` on staged `.ts/.tsx` files; `prettier -w` on `.json/.css/.md`.

**Package manager:** pnpm (v10). **Node version:** 18+.

## Architecture

### Stack

Next.js 14 App Router, TypeScript 5, Tailwind CSS 3, ArtPlayer + HLS.js for video playback, Framer Motion for animations.

### Storage: multi-backend `IStorage` interface

Defined in `src/lib/types.ts`. Five implementations selected via `NEXT_PUBLIC_STORAGE_TYPE` env var:

| Value | Class | File |
|-------|-------|------|
| `localstorage` (default) | `LocalStorage` | `src/lib/localstorage.db.ts` |
| `redis` | `RedisStorage` | `src/lib/redis.db.ts` |
| `kvrocks` | `KvrocksStorage` | `src/lib/kvrocks.db.ts` |
| `d1` | `D1Storage` | `src/lib/d1.db.ts` |
| `upstash` | `UpstashRedisStorage` | `src/lib/upstash.db.ts` |

The `IStorage` interface covers: play records, favorites, users (register/verify/delete), search history, skip configs (opening/ending), and admin config. All five implementations satisfy the same interface.

**Singleton access:** `getStorage()` in `src/lib/db.ts` returns the active instance. `DbManager` wraps it with convenience methods that auto-generate keys (`source+id`).

### Client vs server data layer split

`src/lib/db.ts` — server-side (imports all DB drivers, Node.js APIs).  
`src/lib/db.client.ts` — browser-only (`'use client'`, uses `fetch` + `localStorage`).

**Hybrid caching** (`HybridCacheManager` in `db.client.ts`): For non-localstorage modes, data is cached in browser `localStorage` with a 1-hour TTL. Writes use optimistic updates (cache first, then async API call). Reads return cached data immediately while background-fetching fresh data. Components subscribe to `CustomEvent` updates (`playRecordsUpdated`, `favoritesUpdated`, `searchHistoryUpdated`).

### Config flow

```
config.json  →  scripts/convert-config.js  →  src/lib/runtime.ts (auto-generated)
                                                       ↓
                                              src/lib/config.ts
                                              (merges runtime config with DB admin config)
```

- `config.json` — Apple CMS V10 API source definitions (`api_site` + `cache_time`).
- `runtime.ts` — auto-generated TypeScript file from `config.json`; imported at build time.
- `config.ts` — `getConfig()` reads runtime config, merges with database-stored admin config (for non-localstorage modes). `getAvailableApiSites()` returns only non-disabled sources.
- Docker environments (`DOCKER_ENV=true`) read `config.json` at runtime via `require('fs')` instead of the build-time `runtime.ts`.

### Auth & middleware

`src/middleware.ts` protects all routes except `/login`, `/warning`, `/api/login`, `/api/register`, and a whitelist of public API routes. Auth flow:

- **localstorage mode:** plain password comparison against `PASSWORD` env var, then the server signs a versioned session cookie.
- **Other modes (redis/d1/etc.):** owner login still checks `USERNAME` + `PASSWORD`, database users check stored passwords, and the server signs the resulting session cookie with `AUTH_SIGNING_SECRET`.

`src/lib/auth.ts` provides `getAuthInfoFromCookie()` (server) and `getRuntimeCurrentUser()` (client runtime fallback). Client UI can also call `/api/session` for the current minimal user info.

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
| `/api/hls-proxy` | HLS stream proxy |
| `/api/source-probe` | Probe source availability |
| `/api/tvbox` | TVBox-compatible config endpoint |
| `/api/server-config` | Public server status/config |
| `/api/login`, `/api/register`, `/api/logout` | Auth |
| `/api/change-password` | User password change |
| `/api/admin/*` | Admin config management (source CRUD, user management, site settings) |
| `/api/douban` | Douban integration proxy |
| `/api/cron` | Cron trigger for scheduled tasks |

### Pages (App Router)

- `/` — Home: Douban hot lists + continue watching + favorites
- `/search?q=` — Multi-source search results
- `/play?source=&id=&episode=` — Video player (ArtPlayer + HLS.js)
- `/douban?type=` — Douban category browsing
- `/tvbox` — TVBox config interface
- `/config` — Configuration viewer
- `/admin` — Admin panel (site config, source management, user management)
- `/login` — Login page
- `/warning` — Shown when no PASSWORD is set

### Key components (`src/components/`)

`VideoCard` — reusable card for search results, favorites, douban lists. Renders poster, title, episode count, rating, and favorite button.

`EpisodeSelector` — episode grid for video detail/play pages. Handles episode selection and playback state.

`SkipController` — UI for configuring opening/ending skip segments with time ranges.

`ContinueWatching` — horizontal scrollable row of in-progress videos from play records.

`CapsuleSwitch`, `Sidebar`, `MobileBottomNav`, `MobileHeader`, `PageLayout`, `TopSearchBar`, `YouTubeSearchBar` — layout and navigation.

`SiteProvider` / `ThemeProvider` — React Context providers for site name, announcement, and theme.

### Downstream search (`src/lib/downstream.ts`)

`searchFromApi()` queries a single source API (Apple CMS V10 format), parses `vod_play_url` for M3U8 episode links, and can paginate across multiple pages (configurable via `SearchDownstreamMaxPage`). `getDetailFromApi()` fetches episode detail. Some sources (like `ffzy`) use HTML scraping instead of the JSON API for detail pages.

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

See README for the full table. Key ones: `PASSWORD` (required), `NEXT_PUBLIC_STORAGE_TYPE`, `REDIS_URL`, `NEXT_PUBLIC_IMAGE_PROXY`, `NEXT_PUBLIC_ENABLE_REGISTER`, `USERNAME`, `NEXT_PUBLIC_SEARCH_MAX_PAGE`, `SITE_NAME`, `ANNOUNCEMENT`, `DOCKER_ENV`.
