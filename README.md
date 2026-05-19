<div align="center">
  <img src="public/logo.png" alt="KatelyaTV Logo" width="128" />

  <h1>KatelyaTV</h1>
  <p><strong>Self-hosted streaming aggregator &mdash; cross-platform, multi-source search, play-and-go</strong></p>
  <p>Built with <code>Next.js 14</code> &middot; <code>TypeScript</code> &middot; <code>Tailwind CSS</code> &middot; ArtPlayer + HLS.js</p>
  <p>Continuation of MoonTV &middot; actively maintained</p>

  <p>
    <a href="#deployment">Deploy</a> &middot;
    <a href="#features">Features</a> &middot;
    <a href="#docker">Docker</a> &middot;
    <a href="#environment-variables">Config</a>
  </p>
</div>

## Project Source

This project evolved from MoonTV as a community continuation. Original authors and contributors are acknowledged. Goals: easier deployment, better UX, stable maintenance.

> **Notice:** Built-in video sources have been removed for long-term stability and compliance. Users configure their own source APIs. See the [config file format](#config-file) and recommended config links throughout this README.

## Features

### Playback

- **Multi-source aggregated search** &mdash; query all configured sources at once
- **AI Find Assistant** &mdash; optional OpenAI-compatible model turns natural-language descriptions into searchable titles (see [spec](specs/features/2026-05-16-ai-find-assistant.md))
- **HD playback** &mdash; ArtPlayer + HLS.js, multi-format support
- **Skip intro/outro** &mdash; auto-detect or manually set skip segments
- **Resume playback** &mdash; cross-device progress sync (with non-localstorage backends)
- **Responsive design** &mdash; mobile, tablet, desktop

### Data

- **Favorites** &mdash; cross-device sync
- **Watch history** &mdash; automatic recording
- **Multi-user** &mdash; independent per-user data
- **Multiple storage backends** &mdash; LocalStorage, Redis, Kvrocks, D1, Upstash

### Deployment & Integration

- **Docker** &mdash; one-command deployment, multi-arch images
- **Multi-platform** &mdash; Vercel, Cloudflare Pages, traditional servers
- **PWA** &mdash; installable as desktop/mobile app
- **TVBox compatible** &mdash; standard JSON config endpoint (see [spec](specs/features/2026-05-01-tvbox-integration.md))
- **OrionTV** &mdash; Android TV backend support
- **Dark mode** &mdash; light/dark theme toggle
- **Admin panel** &mdash; source management, user management, site config

## Tech Stack

| Category   | Dependencies                                          |
| ---------- | ----------------------------------------------------- |
| Framework  | Next.js 14 &middot; App Router                        |
| UI & Style | Tailwind CSS 3 &middot; Framer Motion                 |
| Language   | TypeScript 5                                          |
| Player     | ArtPlayer &middot; HLS.js                             |
| State      | React Hooks &middot; Context API                      |
| Quality    | ESLint &middot; Prettier &middot; Jest &middot; Husky |
| Deploy     | Docker &middot; Vercel &middot; Cloudflare Pages      |

## Deployment

### Deployment Comparison

| Method           | Difficulty | Multi-User | Data Reliability | Best For                        |
| ---------------- | ---------- | ---------- | ---------------- | ------------------------------- |
| Docker (single)  | Easy       | No         | Medium           | Personal, quickest              |
| Docker + Redis   | Medium     | Yes        | High             | Home/team                       |
| Docker + Kvrocks | Medium     | Yes        | Very High        | Production, zero data loss risk |
| Vercel           | Easy       | No         | Low              | Quick trial, no server          |
| Cloudflare Pages | Advanced   | Yes (D1)   | High             | Tech enthusiasts                |

---

### Docker (recommended)

#### Single container

```bash
docker pull ghcr.io/katelya77/katelyatv:latest

docker run -d \
  --name katelyatv \
  -p 3000:3000 \
  --env PASSWORD=your_password \
  --restart unless-stopped \
  ghcr.io/katelya77/katelyatv:latest
```

With custom config:

```bash
docker run -d \
  --name katelyatv \
  -p 3000:3000 \
  --env PASSWORD=your_password \
  -v /path/to/config.json:/app/config.json:ro \
  --restart unless-stopped \
  ghcr.io/katelya77/katelyatv:latest
```

**Windows:** use PowerShell. **Access:** `http://localhost:3000` or `http://your-server-ip:3000`.

#### Docker Compose (Redis)

```yaml
version: '3.8'

services:
  katelyatv:
    image: ghcr.io/katelya77/katelyatv:latest
    container_name: katelyatv
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=your_strong_password
      - NEXT_PUBLIC_STORAGE_TYPE=redis
      - REDIS_URL=redis://katelyatv-redis:6379
      - NEXT_PUBLIC_ENABLE_REGISTER=true
      - AUTH_SIGNING_SECRET=your_random_secret
    depends_on:
      katelyatv-redis:
        condition: service_healthy
    restart: unless-stopped

  katelyatv-redis:
    image: redis:7-alpine
    container_name: katelyatv-redis
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - katelyatv-redis-data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 3
    restart: unless-stopped

volumes:
  katelyatv-redis-data:
```

```bash
# Start
docker compose up -d

# Check
docker compose ps
docker compose logs -f
```

#### Docker Compose (Kvrocks)

For production environments requiring high data reliability (RocksDB-based persistent storage):

```bash
# Download config
curl -O https://raw.githubusercontent.com/katelya77/KatelyaTV/main/docker-compose.kvrocks.yml

# Configure env
cp .env.kvrocks.example .env
# Edit .env: set KVROCKS_PASSWORD, PASSWORD, AUTH_SIGNING_SECRET

# Start
docker compose -f docker-compose.kvrocks.yml up -d
```

See `docker-compose.kvrocks.local.yml` for local build variant.

#### Docker management commands

```bash
docker ps                          # status
docker logs katelyatv              # logs
docker restart katelyatv           # restart
docker stop katelyatv && docker rm katelyatv  # stop & remove

# Upgrade
docker pull ghcr.io/katelya77/katelyatv:latest
# then re-run the docker run command

# Compose upgrade
docker compose pull && docker compose up -d
```

---

### Vercel

1. Fork the repo on GitHub
2. In Vercel, import the forked repo
3. Add env var: `PASSWORD` = your password
4. Deploy

> Vercel deployment does not support multi-user. Data is stored in browser localStorage.

---

### Cloudflare Pages

1. Fork the repo
2. In Cloudflare Dashboard: Workers & Pages &rarr; Create &rarr; Pages &rarr; Connect to Git
3. Build settings:
   - **Build command:** `pnpm install && pnpm pages:build`
   - **Output directory:** `.vercel/output/static`
   - **Node.js:** 18
4. Add env var: `PASSWORD`
5. Add compatibility flag: `nodejs_compat`

**With D1 (multi-user):**

1. Create a D1 database in Cloudflare Dashboard
2. Run the initialization SQL from [D1 init](specs/notes/2026-01-01-d1-initialization.md)
3. Bind as `DB` in Pages project settings
4. Add env vars: `NEXT_PUBLIC_STORAGE_TYPE=d1`, `USERNAME`, `PASSWORD`, `AUTH_SIGNING_SECRET`
5. Redeploy

For incremental D1 migrations, see [D1 migration guide](specs/notes/2026-05-09-d1-migration.md).

---

## Source Configuration

KatelyaTV uses standard Apple CMS V10 API format. Create a `config.json` at the project root:

```json
{
  "cache_time": 7200,
  "api_site": {
    "example": {
      "api": "https://example.com/api.php/provide/vod",
      "name": "Example Source",
      "detail": "https://example.com"
    }
  }
}
```

- `cache_time`: API cache duration in seconds
- `api_site`: source definitions
  - `key`: unique lowercase identifier
  - `api`: VOD JSON API root URL (Apple CMS V10 format)
  - `name`: display name
  - `detail`: (optional) HTML detail page URL for sources that need scraping

For recommended config files, see the download links in the deployment sections above.

**Admin panel** (non-localstorage modes only): import/export configs, drag-to-reorder sources, enable/disable per source. Changes persist in the database without restart.

## Environment Variables

### Core

| Variable              | Description                                                                   | Default           |
| --------------------- | ----------------------------------------------------------------------------- | ----------------- |
| `PASSWORD`            | Site access password (required)                                               | (empty)           |
| `AUTH_SIGNING_SECRET` | HMAC-SHA256 secret for session cookie signing (required for non-localstorage) | (empty)           |
| `USERNAME`            | Admin username (non-localstorage modes)                                       | (empty)           |
| `SITE_NAME`           | Site display name                                                             | `KatelyaTV`       |
| `ANNOUNCEMENT`        | Site-wide announcement banner text                                            | (disclaimer text) |

### Storage

| Variable                      | Description                                     | Values                                              | Default        |
| ----------------------------- | ----------------------------------------------- | --------------------------------------------------- | -------------- |
| `NEXT_PUBLIC_STORAGE_TYPE`    | Storage backend                                 | `localstorage`, `redis`, `kvrocks`, `d1`, `upstash` | `localstorage` |
| `REDIS_URL`                   | Redis connection URL                            | connection URL                                      | (empty)        |
| `KVROCKS_URL`                 | Kvrocks connection URL                          | connection URL                                      | (empty)        |
| `KVROCKS_PASSWORD`            | Kvrocks password                                | string                                              | (empty)        |
| `UPSTASH_URL`                 | Upstash Redis URL                               | connection URL                                      | (empty)        |
| `UPSTASH_TOKEN`               | Upstash Redis token                             | token string                                        | (empty)        |
| `NEXT_PUBLIC_ENABLE_REGISTER` | Allow user registration (non-localstorage only) | `true` / `false`                                    | `false`        |

### Search & Proxies

| Variable                      | Description                              | Default |
| ----------------------------- | ---------------------------------------- | ------- |
| `NEXT_PUBLIC_SEARCH_MAX_PAGE` | Max search pages to fetch                | `5`     |
| `NEXT_PUBLIC_IMAGE_PROXY`     | Browser-side image proxy URL prefix      | (empty) |
| `NEXT_PUBLIC_DOUBAN_PROXY`    | Browser-side Douban API proxy URL prefix | (empty) |
| `NEXT_PUBLIC_SOURCE_PROBE`    | Browser-side source probe proxy          | (empty) |
| `NEXT_PUBLIC_HLS_PROXY`       | Browser-side HLS stream proxy            | (empty) |

### AI Find Assistant

| Variable                  | Description                                  | Default                     |
| ------------------------- | -------------------------------------------- | --------------------------- |
| `AI_FIND_ENABLED`         | Enable AI find assistant                     | `false`                     |
| `AI_BASE_URL`             | OpenAI-compatible API base URL               | `https://api.openai.com/v1` |
| `AI_API_KEY`              | Server-side API key                          | (empty)                     |
| `AI_MODEL`                | Model name                                   | (empty)                     |
| `AI_FIND_DEBUG`           | Enable debug logging                         | `false`                     |
| `AI_TEMPERATURE`          | Model temperature (0-2)                      | `0.2`                       |
| `AI_REQUEST_TIMEOUT_MS`   | Request timeout                              | `20000`                     |
| `AI_MAX_TOKENS`           | Max response tokens                          | `800`                       |
| `AI_THINKING_MODE`        | Thinking mode: `auto`, `enabled`, `disabled` | `auto`                      |
| `AI_MAX_RESULTS`          | Max candidate queries                        | `5`                         |
| `AI_DAILY_LIMIT_PER_USER` | Daily usage limit per user                   | `20`                        |
| `AI_CACHE_TTL_SECONDS`    | Search cache TTL                             | `1800`                      |

### Cloudflare Source Ranking

| Variable                             | Description                          | Default |
| ------------------------------------ | ------------------------------------ | ------- |
| `SOURCE_RANKING_ENABLED`             | Enable source ranking                | `false` |
| `NEXT_PUBLIC_SOURCE_RANKING_ENABLED` | Expose status to frontend            | `false` |
| `SOURCE_RANKING_FALLBACK_TO_LIVE`    | Fall back to live probe              | `true`  |
| `SOURCE_RANKING_CRON_ENABLED`        | Enable cron health checks            | `false` |
| `SOURCE_RANKING_HAS_D1`              | Override D1 availability (test only) | `false` |
| `CRON_API_TOKEN`                     | Auth token for `/api/cron`           | (empty) |

### Verification

After deployment, check `http://your-domain/api/server-config` for effective config, or view the admin panel at `/admin` (non-localstorage modes).

## Admin Panel

Available for non-localstorage deployments. Set `USERNAME` and `PASSWORD` to create the owner account. Owners can promote users to admin.

Visit `/admin` to:

- Manage video sources (add, edit, delete, reorder, enable/disable)
- Import/export source configs
- Manage users
- Configure site settings

## TVBox Compatibility

KatelyaTV exposes standard TVBox JSON config endpoints:

- `GET /api/tvbox?format=json` &mdash; JSON format
- `GET /api/tvbox?format=base64` &mdash; Base64-encoded format
- `GET /api/parse?url=<video_url>` &mdash; Video URL parsing

See [TVBox integration spec](specs/features/2026-05-01-tvbox-integration.md) for details.

## Android TV (OrionTV)

Use with [OrionTV](https://github.com/zimplexing/OrionTV) on Android TV. Configure OrionTV with your KatelyaTV deployment URL and password. CORS headers are enabled on all API routes.

## Documentation

Detailed specs, notes, and design docs are in the [`specs/`](specs/) directory:

```
specs/
  features/    Feature documentation (yyyy-mm-dd prefixed)
  notes/       Migration guides, troubleshooting, security reviews
  research/    Design specs and architectural decisions
```

Key docs:

- [AI Find Assistant](specs/features/2026-05-16-ai-find-assistant.md)
- [Cloudflare Source Ranking](specs/features/2026-05-09-cloudflare-source-ranking.md)
- [TVBox Integration](specs/features/2026-05-01-tvbox-integration.md)
- [D1 Migration Guide](specs/notes/2026-05-09-d1-migration.md)
- [D1 Initialization SQL](specs/notes/2026-01-01-d1-initialization.md)
- [Security Review (2026-05-11)](specs/notes/2026-05-11-security-review.md)
- [Auth Security Design](specs/research/2026-05-11-auth-security-hardening-design.md)

## Security

- **Set a password.** Instances without `PASSWORD` are publicly accessible.
- Use `AUTH_SIGNING_SECRET` for session signing in non-localstorage modes.
- Session cookies are `httpOnly`, signed with HMAC-SHA256.
- Passwords are stored as PBKDF2-SHA256 hashes (120,000 iterations).
- Keep your instance private. Do not share the URL publicly.

This project is for learning and personal use. Users are responsible for complying with local laws. The project developers assume no legal liability for users' actions.

## License

[MIT](LICENSE) &copy; 2025 KatelyaTV & Contributors

## Acknowledgments

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) &mdash; original scaffold
- [LibreTV](https://github.com/LibreSpark/LibreTV) &mdash; inspiration
- [LunaTV (MoonTV)](https://github.com/MoonTechLab/LunaTV) &mdash; original project and community
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) &mdash; web video player
- [HLS.js](https://github.com/video-dev/hls.js) &mdash; HLS playback in browsers
- All providers of free video APIs
