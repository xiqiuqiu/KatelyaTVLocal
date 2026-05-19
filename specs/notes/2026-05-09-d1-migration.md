# D1 Database Migration Guide

## Skip Configs Migration

If you have an existing D1 database, run the following SQL to add skip config support:

```sql
CREATE TABLE IF NOT EXISTS skip_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  source TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  segments TEXT NOT NULL,
  updated_time INTEGER NOT NULL,
  UNIQUE(username, key)
);

CREATE INDEX IF NOT EXISTS idx_skip_configs_username ON skip_configs(username);
CREATE INDEX IF NOT EXISTS idx_skip_configs_username_key ON skip_configs(username, key);
CREATE INDEX IF NOT EXISTS idx_skip_configs_username_updated_time ON skip_configs(username, updated_time DESC);
```

## Cloudflare Source Ranking Migration

For the source ranking feature, run the migration script:

```bash
npx wrangler d1 migrations apply DB
```

Or manually execute `migrations/2026-05-09_cloudflare_source_ranking.sql` in the D1 Console.

This migration adds 4 tables:

- `source_probe_runs` — cron job execution records
- `source_probe_results` — per-source probe results (status, latency, resolution, throughput)
- `source_rank_snapshots` — aggregated ranking scores for playback sorting
- `playback_feedback_events` — real playback feedback for score correction

### Verification

```sql
SELECT name FROM sqlite_master
WHERE type = 'table'
  AND name IN (
    'source_probe_runs',
    'source_probe_results',
    'source_rank_snapshots',
    'playback_feedback_events'
  );

SELECT name FROM sqlite_master
WHERE type = 'index'
  AND name IN (
    'idx_probe_results_source_time',
    'idx_rank_snapshots_source_window',
    'idx_feedback_source_time'
  );
```

## Execution Methods

### Cloudflare Dashboard (recommended)
1. Log in to Cloudflare Dashboard
2. Navigate to D1 > your database instance
3. Open the Console tab
4. Paste SQL and execute

### Wrangler CLI
```bash
wrangler d1 execute your-database-name --file=migration.sql
```

### Recommended Enable Order

1. Execute D1 migration
2. Confirm tables created
3. Configure or enable Cron
4. Enable `SOURCE_RANKING_ENABLED`

Do not enable source ranking before migration is complete.

## New Deployments

If deploying fresh, use the complete SQL from the D1 initialization script instead of incremental migrations.
