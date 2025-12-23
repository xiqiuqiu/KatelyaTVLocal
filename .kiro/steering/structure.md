# Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes (edge runtime)
│   │   ├── admin/         # Admin management endpoints
│   │   ├── detail/        # Video detail fetching
│   │   ├── search/        # Search endpoints
│   │   ├── favorites/     # User favorites
│   │   ├── playrecords/   # Watch history
│   │   ├── skip-configs/  # Intro/outro skip settings
│   │   └── ...
│   ├── admin/             # Admin dashboard page
│   ├── play/              # Video player page
│   ├── search/            # Search results page
│   ├── douban/            # Douban integration page
│   ├── tvbox/             # TVBox config page
│   ├── layout.tsx         # Root layout with providers
│   └── page.tsx           # Home page
├── components/            # React components
│   ├── *Provider.tsx      # Context providers
│   ├── VideoCard.tsx      # Video display cards
│   ├── EpisodeSelector.tsx # Episode picker
│   ├── SkipController.tsx # Skip intro/outro UI
│   └── ...
├── lib/                   # Shared utilities
│   ├── db.ts              # Storage abstraction layer
│   ├── db.client.ts       # Client-side storage
│   ├── redis.db.ts        # Redis implementation
│   ├── d1.db.ts           # Cloudflare D1 implementation
│   ├── upstash.db.ts      # Upstash implementation
│   ├── localstorage.db.ts # LocalStorage implementation
│   ├── config.ts          # Config loading
│   ├── types.ts           # TypeScript interfaces
│   ├── auth.ts            # Authentication helpers
│   ├── cors.ts            # CORS handling
│   └── downstream.ts      # External API fetching
└── styles/                # Global CSS
    ├── colors.css         # Color variables
    └── globals.css        # Global styles

config.json                # Video source configuration
scripts/                   # Build/utility scripts
docker/                    # Docker configurations
public/                    # Static assets + PWA files
```

## Key Patterns

### Storage Abstraction

All data storage goes through `IStorage` interface in `src/lib/types.ts`. Implementations:

- `localstorage.db.ts` - Browser storage
- `redis.db.ts` - Redis/Kvrocks
- `d1.db.ts` - Cloudflare D1
- `upstash.db.ts` - Upstash Redis

### API Routes

- All API routes use edge runtime
- CORS headers added via `src/lib/cors.ts`
- Config loaded via `src/lib/config.ts`

### Components

- Server components by default
- Client components marked with `'use client'`
- Providers wrap app in `layout.tsx`
