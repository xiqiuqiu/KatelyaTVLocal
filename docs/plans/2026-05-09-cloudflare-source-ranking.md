# Cloudflare Source Ranking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Cloudflare-native source ranking system that precomputes source health, quality, and playback preference before the user opens the play page.

**Architecture:** Use `Cron Triggers` to run scheduled source checks, `Queues` to fan out probe work, `D1` as the source-of-truth for structured health data, `KV` for fast online recommendation reads, and lightweight browser feedback to correct the ranking with real playback outcomes. The play page should read a precomputed recommendation first, then do only limited browser-side follow-up work.

**Tech Stack:** Next.js 14, Cloudflare Pages / Workers, Edge runtime routes, D1, KV, Queues, Cron Triggers, optional Workers Analytics Engine.

---

## Scope

This plan implements:

- Scheduled health checks for configured sources and playback domains
- Persistent scoring for source quality and stability
- Fast online recommendation reads for the play page
- Real-playback feedback collection to correct offline scores
- Cloudflare-friendly fallback behavior when some capabilities are not bound yet

This plan does **not** implement:

- Full per-user personalized ranking
- Region-specific routing by country or ASN
- Long-term BI dashboards
- Auto-disabling sources from admin UI in the first version

---

## High-Level Design

There are three layers:

1. **Offline probe layer**
   Cron starts a scheduled scan. The scan enumerates enabled sources, samples representative titles or episodes, and pushes probe jobs into a queue.

2. **Scoring layer**
   Queue consumers probe playback URLs, extract measurable properties, then write normalized results into D1. A scorer computes aggregate health per source, per playback domain, and optionally per title.

3. **Online serving layer**
   The play page reads a precomputed recommendation from KV first. If KV has no fresh ranking, it falls back to D1, then finally to the current live probe path.

The browser is no longer the main judge. It becomes a correction source.

---

## Data Model

### Task 1: Add D1 schema for source health snapshots

**Files:**
- Create: `migrations/2026-05-09_cloudflare_source_ranking.sql`
- Modify: `D1_MIGRATION.md`
- Reference: `src/lib/d1.db.ts`

**Step 1: Create a `source_probe_runs` table**

Columns:
- `id TEXT PRIMARY KEY`
- `trigger_type TEXT NOT NULL` (`cron`, `manual`, `fallback`)
- `started_at INTEGER NOT NULL`
- `finished_at INTEGER`
- `status TEXT NOT NULL` (`running`, `completed`, `failed`)
- `notes TEXT`

**Step 2: Create a `source_probe_results` table**

Columns:
- `id TEXT PRIMARY KEY`
- `run_id TEXT NOT NULL`
- `source_key TEXT NOT NULL`
- `source_name TEXT NOT NULL`
- `title_sample TEXT`
- `episode_url TEXT NOT NULL`
- `playback_domain TEXT`
- `probe_kind TEXT NOT NULL` (`direct`, `proxy`, `unavailable`)
- `probe_reason TEXT`
- `upstream_status INTEGER`
- `probe_time_ms INTEGER`
- `resolution_label TEXT`
- `first_segment_latency_ms INTEGER`
- `first_segment_bytes INTEGER`
- `first_segment_speed_kbps REAL`
- `playlist_ok INTEGER NOT NULL DEFAULT 0`
- `segment_ok INTEGER NOT NULL DEFAULT 0`
- `measured_at INTEGER NOT NULL`

**Step 3: Create a `source_rank_snapshots` table**

Columns:
- `id TEXT PRIMARY KEY`
- `source_key TEXT NOT NULL`
- `playback_domain TEXT`
- `window_key TEXT NOT NULL` (`1h`, `6h`, `24h`, `7d`)
- `health_score REAL NOT NULL`
- `quality_score REAL NOT NULL`
- `stability_score REAL NOT NULL`
- `speed_score REAL NOT NULL`
- `success_rate REAL NOT NULL`
- `direct_rate REAL NOT NULL`
- `proxy_rate REAL NOT NULL`
- `unavailable_rate REAL NOT NULL`
- `sample_count INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

**Step 4: Create a `playback_feedback_events` table**

Columns:
- `id TEXT PRIMARY KEY`
- `source_key TEXT NOT NULL`
- `playback_domain TEXT`
- `title TEXT`
- `playback_mode TEXT NOT NULL`
- `startup_success INTEGER NOT NULL`
- `startup_time_ms INTEGER`
- `switched_to_proxy INTEGER NOT NULL DEFAULT 0`
- `browser_quality TEXT`
- `browser_ping_ms INTEGER`
- `browser_speed_label TEXT`
- `session_error TEXT`
- `recorded_at INTEGER NOT NULL`

**Step 5: Create indexes**

Indexes:
- `source_probe_results(source_key, measured_at DESC)`
- `source_probe_results(playback_domain, measured_at DESC)`
- `source_rank_snapshots(source_key, window_key, updated_at DESC)`
- `playback_feedback_events(source_key, recorded_at DESC)`

**Step 6: Document migration command**

Run:
```bash
npx wrangler d1 migrations apply <DB_BINDING_NAME>
```

Expected:
- Tables created successfully
- Migration recorded in D1 metadata

---

## Runtime Bindings

### Task 2: Define Cloudflare bindings and runtime config

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `.env.example`
- Modify: `README.md`
- Create: `docs/CLOUDFLARE_SOURCE_RANKING.md`

**Step 1: Add env examples for new bindings**

Add:
- `NEXT_PUBLIC_SOURCE_PREFERENCE_CACHE_TTL`
- `SOURCE_RANK_KV_BINDING`
- `SOURCE_RANK_QUEUE_BINDING`
- `SOURCE_RANKING_ENABLED`
- `SOURCE_RANKING_FALLBACK_TO_LIVE`

**Step 2: Inject feature flag into `window.RUNTIME_CONFIG`**

Expose:
- `SOURCE_RANKING_ENABLED`

**Step 3: Document required bindings**

Document:
- D1 database binding
- KV namespace binding
- Queue producer and consumer binding
- Cron trigger schedule

**Step 4: Document safe fallback**

If bindings are absent:
- keep existing live probe flow
- do not break playback

---

## Probe Pipeline

### Task 3: Create scheduled source scan entrypoint

**Files:**
- Create: `src/lib/source-ranking/scheduler.ts`
- Create: `src/lib/source-ranking/runtime.ts`
- Modify: `proxy.worker.js` or Cloudflare worker entry integration point

**Step 1: Create a scheduler entry function**

Function responsibilities:
- load enabled sources from config
- create a `source_probe_runs` row
- enqueue one probe job per sampled source

**Step 2: Define a probe job payload**

Payload fields:
- `runId`
- `sourceKey`
- `sourceName`
- `titleSample`
- `episodeUrl`
- `sampleType` (`top-title`, `random-title`, `manual`)

**Step 3: Add sample selection policy**

First version:
- use a small representative sample count per source
- do not probe every episode
- prefer current playable titles and first episodes

**Step 4: Add a manual kick-off endpoint**

Create a protected admin-only endpoint to start a scan without waiting for Cron.

**Step 5: Verify scheduler in dry-run mode**

Run:
```bash
npm run typecheck
```

Expected:
- scheduler types compile
- no route breaks

---

### Task 4: Create queue consumer for playback probing

**Files:**
- Create: `src/lib/source-ranking/consumer.ts`
- Create: `src/lib/source-ranking/probe.ts`
- Modify: `src/lib/source-preference.ts`

**Step 1: Reuse the existing lightweight probe path**

The queue consumer should call shared lightweight probe logic, not duplicate browser logic.

**Step 2: Extend probing with offline-only measurements**

Add:
- first segment latency
- first segment throughput
- nested playlist success
- segment fetch success

**Step 3: Add resolution parsing**

Prefer:
- parse master playlist resolution if available
- fall back to variant width/height if present
- if unavailable, leave `resolution_label` null

Do **not** use browser `video` element in queue workers.

**Step 4: Persist one result row per probe**

Write result into `source_probe_results`.

**Step 5: Mark run progress**

Update `source_probe_runs` when all messages finish.

---

## Scoring

### Task 5: Build a scoring module

**Files:**
- Create: `src/lib/source-ranking/scoring.ts`
- Create: `src/lib/source-ranking/scoring.test.ts`

**Step 1: Define normalized component scores**

Initial weights:
- `health_score`: 35%
- `speed_score`: 25%
- `quality_score`: 20%
- `stability_score`: 20%

**Step 2: Define health score**

Inputs:
- success rate
- unavailable rate
- direct rate
- proxy rate

Rules:
- direct is best
- proxy is acceptable
- unavailable is heavily penalized

**Step 3: Define speed score**

Inputs:
- first segment latency
- first segment throughput

Rules:
- faster is better
- cap outliers to avoid single lucky sample distortion

**Step 4: Define quality score**

Inputs:
- `4K`, `2K`, `1080p`, `720p`, `480p`, `SD`

Suggested mapping:
- `4K = 100`
- `2K = 88`
- `1080p = 76`
- `720p = 60`
- `480p = 40`
- `SD = 20`
- `null = 35`

**Step 5: Define stability score**

Inputs:
- sample variance in latency
- variance in speed
- recent failure streak

**Step 6: Aggregate by time window**

Compute snapshots for:
- 1 hour
- 6 hours
- 24 hours
- 7 days

**Step 7: Write tests for ranking math**

Run:
```bash
npm test -- src/lib/source-ranking/scoring.test.ts --runInBand
```

Expected:
- better direct+fast+high-quality source ranks first
- proxy but stable beats unstable direct source when failures are high

---

## Online Recommendation Serving

### Task 6: Build KV-backed recommendation writer

**Files:**
- Create: `src/lib/source-ranking/publish.ts`
- Create: `src/lib/source-ranking/keys.ts`

**Step 1: Define KV keys**

Keys:
- `rank:global`
- `rank:source:<sourceKey>`
- `rank:title:<normalizedTitle>`
- `rank:domain:<playbackDomain>`

**Step 2: Publish compact ranking payload**

Payload fields:
- ordered source keys
- score summary
- freshness timestamp
- confidence indicator

**Step 3: Add TTL policy**

Suggested TTL:
- global rank: 10 minutes
- title-specific rank: 30 minutes
- domain rank: 10 minutes

**Step 4: Keep D1 as source of truth**

KV is a serving cache only.

---

### Task 7: Build online rank reader for play page

**Files:**
- Modify: `src/app/api/source-preference/route.ts`
- Create: `src/lib/source-ranking/read.ts`

**Step 1: Change source-preference lookup order**

Order:
1. title-specific KV rank
2. global or domain KV rank
3. D1 latest rank snapshot
4. live lightweight probe

**Step 2: Preserve current live fallback**

If rank data is missing or stale:
- keep the existing source-preference probe behavior

**Step 3: Return richer metadata**

Return:
- ranking source (`kv`, `d1`, `live`)
- freshness timestamp
- confidence level
- score summary per source

**Step 4: Verify route behavior**

Run:
```bash
npm run typecheck
```

Expected:
- route compiles
- no shape mismatch with existing play page callers

---

## Playback Feedback

### Task 8: Add real-playback feedback collection

**Files:**
- Modify: `src/app/play/page.tsx`
- Create: `src/app/api/source-feedback/route.ts`
- Create: `src/lib/source-ranking/feedback.ts`

**Step 1: Capture first-play success events**

On the play page, record:
- source key
- playback mode
- startup success
- startup time

**Step 2: Capture proxy-switch events**

If direct playback fails and the player switches to proxy:
- emit a feedback event

**Step 3: Capture browser-measured quality if available**

Only attach:
- browser quality label
- browser ping
- browser speed label

**Step 4: Persist feedback into D1**

Insert into `playback_feedback_events`.

**Step 5: Use feedback as score correction**

Rules:
- repeated startup failures reduce health score
- repeated successful direct play increases confidence
- proxy fallback success prevents over-penalizing proxy-only domains

---

## UI Integration

### Task 9: Show precomputed ranking confidence in the source list

**Files:**
- Modify: `src/components/EpisodeSelector.tsx`
- Modify: `src/lib/types.ts`

**Step 1: Add optional rank metadata to source status**

Fields:
- rank score
- ranking source
- freshness
- confidence

**Step 2: Reintroduce explicit quality labels**

If `quality` exists:
- display `4K`, `1080p`, `720p`, etc. in the source list

**Step 3: Keep quality display conditional**

If no resolution is known:
- do not show a fake label

**Step 4: Distinguish offline rank from browser live measurement**

UI copy examples:
- `预估优先`
- `离线体检`
- `浏览器实测`

---

## Admin and Operations

### Task 10: Add admin observability page

**Files:**
- Create: `src/app/admin/source-ranking/page.tsx`
- Create: `src/app/api/admin/source-ranking/route.ts`

**Step 1: Show last probe run**

Display:
- start time
- finish time
- success/failure
- sample count

**Step 2: Show current rank snapshot**

Display per source:
- health
- quality
- speed
- stability
- final score

**Step 3: Show reasons for penalties**

Examples:
- recent failures too high
- mostly proxy-only
- no high-quality samples

**Step 4: Add manual refresh button**

Button triggers:
- manual probe run endpoint

---

## Rollout Strategy

### Task 11: Ship in safe phases

**Files:**
- Modify: `README.md`
- Modify: `docs/CLOUDFLARE_SOURCE_RANKING.md`

**Step 1: Phase 1**

Ship:
- D1 schema
- live route fallback
- Cron + queue probe pipeline
- no UI change yet

**Step 2: Phase 2**

Ship:
- KV rank reads
- source-preference route upgrade
- play page rank-aware selection

**Step 3: Phase 3**

Ship:
- playback feedback
- rank correction
- admin observability page

**Step 4: Phase 4**

Optional:
- title-level ranking
- region-level ranking
- auto-disable bad sources

---

## Testing Plan

### Task 12: Add verification coverage

**Files:**
- Create: `src/lib/source-ranking/probe.test.ts`
- Create: `src/lib/source-ranking/read.test.ts`
- Create: `src/lib/source-ranking/feedback.test.ts`
- Modify: `src/lib/source-preference.test.ts`

**Step 1: Probe tests**

Cover:
- direct result
- proxy result
- unavailable result
- master playlist parsing
- segment failure handling

**Step 2: Score tests**

Cover:
- high-quality stable source beats fast but failing source
- proxy-only stable source beats unstable direct source

**Step 3: Read path tests**

Cover:
- KV hit
- D1 fallback
- live fallback

**Step 4: Feedback tests**

Cover:
- startup failure penalty
- proxy recovery correction

**Step 5: Manual browser verification**

Check:
- play page still opens quickly
- source list shows precomputed states
- quality labels appear only when known
- playback still falls back to proxy safely

Run:
```bash
npm test -- src/lib/source-preference.test.ts --runInBand
npm run typecheck
npx eslint src/app/play/page.tsx src/components/EpisodeSelector.tsx src/lib/source-ranking src/app/api/source-preference src/app/api/source-feedback
```

Expected:
- tests pass
- typecheck passes
- lint passes

---

## Recommended Execution Order

1. D1 schema and bindings
2. Scheduler and queue payload definition
3. Shared offline probe module
4. Scoring module
5. KV publisher and D1 reader
6. `source-preference` route upgrade
7. Playback feedback route
8. Play page integration
9. Source list quality tag restoration
10. Admin observability page

---

## Risks and Mitigations

- **Risk:** Cron probes do not reflect end-user network reality  
  **Mitigation:** Always combine offline rank with playback feedback.

- **Risk:** KV serves stale data  
  **Mitigation:** Keep TTL short and fall back to D1 or live probe.

- **Risk:** Probe volume gets too large  
  **Mitigation:** sample titles and episodes, use queues, avoid full scans.

- **Risk:** Some sources block worker fetches intermittently  
  **Mitigation:** store repeated sample history and penalize volatility, not single failures.

- **Risk:** Resolution cannot always be inferred offline  
  **Mitigation:** keep browser quality as a secondary correction source and display labels only when known.

---

## Success Criteria

The feature is done when:

- source-preference reads precomputed ranking before falling back to live probing
- D1 stores structured health and feedback data
- KV serves fresh ranked source lists
- Cron keeps rankings updated without user traffic
- source list shows real quality labels when available
- playback still works when Cloudflare bindings are unavailable
- browser-side heavy testing is no longer the main decision-maker

---

## Notes for This Repository

- Reuse the existing lightweight probe logic in `src/lib/source-preference.ts`
- Keep `src/lib/utils.ts` browser-only measurement logic as a supplement
- Preserve the current same-origin fallback behavior for `/api/source-probe`
- Do not block playback on offline-rank freshness; stale rank is acceptable if live fallback exists

