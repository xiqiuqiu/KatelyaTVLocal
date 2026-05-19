# Cloudflare Source Ranking (Personal Edition)

This feature does three things:

- Stores health check results and real playback feedback in D1
- Runs low-frequency Cron-triggered source health checks
- Prioritizes D1 results when available, falls back to existing real-time probing otherwise

The goal is to improve source switching stability at minimal cost for personal use.

## Dependencies

This edition depends only on:

- Cloudflare D1
- Cloudflare Cron Triggers

It explicitly does NOT depend on:

- Queue
- KV
- Analytics Engine

## Recommended Enable Order

1. Create and bind D1 first
2. Execute `migrations/2026-05-09_cloudflare_source_ranking.sql`
3. Confirm tables are created
4. Enable low-frequency Cron
5. Finally set `SOURCE_RANKING_ENABLED=true`

## Environment Variables

```env
SOURCE_RANKING_ENABLED=false
NEXT_PUBLIC_SOURCE_RANKING_ENABLED=false
SOURCE_RANKING_FALLBACK_TO_LIVE=true
SOURCE_RANKING_CRON_ENABLED=false
SOURCE_RANKING_HAS_D1=false
CRON_API_TOKEN=
```

- `SOURCE_RANKING_ENABLED`: Server-side toggle for source ranking
- `NEXT_PUBLIC_SOURCE_RANKING_ENABLED`: Exposes status to frontend
- `SOURCE_RANKING_FALLBACK_TO_LIVE`: Fall back to live probing when D1 has no results (keep `true`)
- `SOURCE_RANKING_CRON_ENABLED`: Enable scheduled health checks
- `SOURCE_RANKING_HAS_D1`: Local/test override to mark D1 as available
- `CRON_API_TOKEN`: Optional token for `/api/cron` access (`x-cron-token` or `Authorization: Bearer <token>`)

## D1 Binding

The code expects a D1 binding named `DB`. Set this up via:

- Cloudflare Pages project settings (add D1 binding with name `DB`)
- Or `wrangler.toml` with the same binding name

If the binding name is not `DB`, both source ranking and playback feedback paths treat it as "no D1 available".

## Cron Frequency

Recommended for personal use:

- 1-2 times per day

A separate lightweight Cloudflare Worker (`workers/source-ranking-cron/`) triggers `/api/cron` on schedule without modifying the Pages deployment structure.

## Behavior When D1 Is Unavailable

- No D1 → fall back to live probing
- D1 empty → fall back to live probing
- Cron not yet running → only affects ranking quality, not playback
- `SOURCE_RANKING_ENABLED=false` → system returns to old behavior

## Deployment Checklist

- D1 created and bound as `DB`
- Migration script executed successfully
- `SOURCE_RANKING_FALLBACK_TO_LIVE=true`
- `SOURCE_RANKING_CRON_ENABLED=true` on Pages side
- Separate cron worker deployed pointing to `https://your-domain/api/cron`
- If `CRON_API_TOKEN` is set, both Pages and cron worker share the same value
- Cron frequency: 1-2 times per day
