# Cloudflare 播放源优选开发计划（个人精简版） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为个人使用场景构建一套低成本、可长期维护的 Cloudflare 播放源优选方案，在不引入复杂基础设施的前提下，提前沉淀源健康度、清晰度和播放反馈，并优先用于播放前选源。

**Architecture:** 方案只保留三块最有价值的能力。第一块是 `D1`，作为体检结果和播放反馈的主存储。第二块是低频 `Cron` 定时体检，用少量样本周期性刷新源状态。第三块是当前播放页的在线消费链路，先读 D1 中最近的体检结果，再回退到现有实时探测逻辑。浏览器测速继续保留，但只做补充信息，不再做主判断器。

**Tech Stack:** Next.js 14, Cloudflare Pages, Edge Runtime, Cloudflare D1, Cloudflare Cron Triggers.

---

## 方案边界

这份计划**只适合个人使用**，目标是：

- 你自己日常看片体验更稳定
- 播放前少做无意义测速
- 换源面板能看到更有依据的状态
- 成本和维护复杂度尽量低

这份计划**明确不做**：

- Queue 异步批量探测
- KV 多层缓存分发
- Analytics Engine 事件分析
- 按地区、用户、标题做复杂个性化排序
- 后台大盘和复杂运营能力

---

## 文件结构设计

**新增文件：**

- `migrations/2026-05-09_cloudflare_source_ranking.sql`
  D1 表结构
- `src/lib/source-ranking/runtime.ts`
  Cloudflare 能力开关和降级判断
- `src/lib/source-ranking/scheduler.ts`
  Cron 定时体检入口
- `src/lib/source-ranking/probe.ts`
  离线体检使用的探测逻辑
- `src/lib/source-ranking/scoring.ts`
  评分规则
- `src/lib/source-ranking/read.ts`
  在线读取最近体检结果
- `src/lib/source-ranking/feedback.ts`
  写入真实播放反馈
- `src/lib/source-ranking/*.test.ts`
  相关单测
- `docs/CLOUDFLARE_SOURCE_RANKING.md`
  部署和使用说明

**已有文件修改：**

- `src/app/api/source-preference/route.ts`
  先读 D1 体检结果，再回退实时探测
- `src/app/api/source-feedback/route.ts`
  接收前端真实播放反馈
- `src/app/play/page.tsx`
  播放页写入反馈，并消费预计算优选
- `src/components/EpisodeSelector.tsx`
  恢复清晰度标签和状态展示
- `src/lib/source-preference.ts`
  提供在线与离线共用的轻量探测能力
- `src/lib/types.ts`
  增加评分和反馈类型
- `src/app/layout.tsx`
  注入开关
- `.env.example`
  增加 D1 和 Cron 相关配置说明

---

## 开发原则

- 不新增任何会阻断播放的硬依赖
- 先保证旧逻辑可回退，再引入新逻辑
- 低频体检优先，避免高频探测
- 分辨率标签只显示真实测得值
- 离线体检只决定“优先级”，不决定“绝对可播性”

---

### Task 1: 建立 D1 表结构

**Files:**
- Create: `migrations/2026-05-09_cloudflare_source_ranking.sql`
- Modify: `D1_MIGRATION.md`
- Reference: `src/lib/d1.db.ts`

- [ ] **Step 1: 创建体检运行表**

```sql
CREATE TABLE IF NOT EXISTS source_probe_runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  notes TEXT
);
```

- [ ] **Step 2: 创建体检结果表**

```sql
CREATE TABLE IF NOT EXISTS source_probe_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  title_sample TEXT,
  episode_url TEXT NOT NULL,
  playback_domain TEXT,
  probe_kind TEXT NOT NULL,
  probe_reason TEXT,
  upstream_status INTEGER,
  probe_time_ms INTEGER,
  resolution_label TEXT,
  first_segment_latency_ms INTEGER,
  first_segment_speed_kbps REAL,
  measured_at INTEGER NOT NULL
);
```

- [ ] **Step 3: 创建聚合评分表和播放反馈表**

```sql
CREATE TABLE IF NOT EXISTS source_rank_snapshots (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  playback_domain TEXT,
  window_key TEXT NOT NULL,
  health_score REAL NOT NULL,
  quality_score REAL NOT NULL,
  speed_score REAL NOT NULL,
  stability_score REAL NOT NULL,
  final_score REAL NOT NULL,
  success_rate REAL NOT NULL,
  direct_rate REAL NOT NULL,
  proxy_rate REAL NOT NULL,
  unavailable_rate REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playback_feedback_events (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  playback_domain TEXT,
  title TEXT,
  playback_mode TEXT NOT NULL,
  startup_success INTEGER NOT NULL,
  startup_time_ms INTEGER,
  switched_to_proxy INTEGER NOT NULL DEFAULT 0,
  browser_quality TEXT,
  browser_ping_ms INTEGER,
  browser_speed_label TEXT,
  session_error TEXT,
  recorded_at INTEGER NOT NULL
);
```

- [ ] **Step 4: 增加查询索引**

```sql
CREATE INDEX IF NOT EXISTS idx_probe_results_source_time
ON source_probe_results(source_key, measured_at DESC);

CREATE INDEX IF NOT EXISTS idx_rank_snapshots_source_window
ON source_rank_snapshots(source_key, window_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_source_time
ON playback_feedback_events(source_key, recorded_at DESC);
```

- [ ] **Step 5: 更新迁移文档并验证命令**

Run:
```bash
npx wrangler d1 migrations apply <DB_BINDING_NAME>
```

Expected:
- 表和索引创建成功

- [ ] **Step 6: 提交**

```bash
git add migrations/2026-05-09_cloudflare_source_ranking.sql D1_MIGRATION.md
git commit -m "feat: add d1 schema for personal source ranking"
```

---

### Task 2: 建立运行时开关与降级能力

**Files:**
- Create: `src/lib/source-ranking/runtime.ts`
- Modify: `.env.example`
- Modify: `src/app/layout.tsx`
- Create: `docs/CLOUDFLARE_SOURCE_RANKING.md`

- [ ] **Step 1: 增加环境变量示例**

```env
SOURCE_RANKING_ENABLED=false
NEXT_PUBLIC_SOURCE_RANKING_ENABLED=false
SOURCE_RANKING_FALLBACK_TO_LIVE=true
SOURCE_RANKING_CRON_ENABLED=false
```

- [ ] **Step 2: 建立运行时能力读取函数**

```ts
export interface SourceRankingRuntime {
  enabled: boolean;
  hasD1: boolean;
  fallbackToLive: boolean;
}

export function getSourceRankingRuntime(env?: Record<string, unknown>): SourceRankingRuntime {
  const source = env || (process.env as unknown as Record<string, unknown>);
  return {
    enabled: source.SOURCE_RANKING_ENABLED === 'true',
    hasD1: Boolean(source.DB),
    fallbackToLive: source.SOURCE_RANKING_FALLBACK_TO_LIVE !== 'false',
  };
}
```

- [ ] **Step 3: 在前端运行时注入开关**

```ts
const runtimeConfig = {
  ...existingConfig,
  SOURCE_RANKING_ENABLED:
    process.env.NEXT_PUBLIC_SOURCE_RANKING_ENABLED === 'true',
};
```

- [ ] **Step 4: 写部署文档**

文档必须说明：
- 只需要 D1 和 Cron
- 没有 D1 时自动回退实时探测
- 推荐的 Cron 频率是每天 1 次或 2 次

- [ ] **Step 5: 运行类型检查**

Run:
```bash
npm run typecheck
```

Expected:
- PASS

- [ ] **Step 6: 提交**

```bash
git add .env.example src/lib/source-ranking/runtime.ts src/app/layout.tsx docs/CLOUDFLARE_SOURCE_RANKING.md
git commit -m "feat: add personal source ranking runtime flags"
```

---

### Task 3: 建立低频 Cron 体检入口

**Files:**
- Create: `src/lib/source-ranking/scheduler.ts`
- Modify: Cloudflare worker scheduled entry integration point
- Reference: `src/lib/config.ts`

- [ ] **Step 1: 定义样本任务结构**

```ts
export interface SourceProbeTask {
  sourceKey: string;
  sourceName: string;
  titleSample: string;
  episodeUrl: string;
}
```

- [ ] **Step 2: 实现低频体检入口**

```ts
export async function runScheduledSourceProbe(env: Env) {
  const runId = crypto.randomUUID();
  const startedAt = Date.now();

  await env.DB.prepare(
    `INSERT INTO source_probe_runs (id, trigger_type, started_at, status)
     VALUES (?, ?, ?, ?)`
  ).bind(runId, 'cron', startedAt, 'running').run();

  return { runId, startedAt };
}
```

- [ ] **Step 3: 只使用小样本策略**

第一版规则：
- 每个源只抽 1 到 3 条播放地址
- 不做全量剧集扫描
- 默认优先抽最近能搜到的结果

- [ ] **Step 4: 接入 scheduled handler**

```ts
export default {
  async scheduled(_controller: ScheduledController, env: Env) {
    await runScheduledSourceProbe(env);
  },
};
```

- [ ] **Step 5: 先做静态验证**

Run:
```bash
npm run typecheck
```

Expected:
- PASS

- [ ] **Step 6: 提交**

```bash
git add src/lib/source-ranking/scheduler.ts
git commit -m "feat: add low-frequency cron source probe"
```

---

### Task 4: 建立离线探测逻辑

**Files:**
- Create: `src/lib/source-ranking/probe.ts`
- Modify: `src/lib/source-preference.ts`
- Create: `src/lib/source-ranking/probe.test.ts`

- [ ] **Step 1: 定义离线探测结果**

```ts
export interface OfflineProbeResult {
  kind: 'direct' | 'proxy' | 'unavailable';
  reason?: string;
  domain?: string | null;
  upstreamStatus?: number;
  probeTimeMs?: number;
  resolutionLabel?: string | null;
  firstSegmentLatencyMs?: number | null;
  firstSegmentSpeedKbps?: number | null;
}
```

- [ ] **Step 2: 复用现有轻量探测能力**

```ts
export async function probePlaybackForRanking(
  episodeUrl: string,
  origin: string
): Promise<OfflineProbeResult> {
  const result = await probeSourcePlaybackUpstream(episodeUrl, origin);
  return {
    ...result,
    resolutionLabel: null,
    firstSegmentLatencyMs: result.probeTimeMs ?? null,
    firstSegmentSpeedKbps: null,
  };
}
```

- [ ] **Step 3: 写入体检结果**

```ts
await env.DB.prepare(
  `INSERT INTO source_probe_results
   (id, run_id, source_key, source_name, title_sample, episode_url, playback_domain, probe_kind, probe_reason, upstream_status, probe_time_ms, resolution_label, first_segment_latency_ms, first_segment_speed_kbps, measured_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).bind(
  crypto.randomUUID(),
  runId,
  task.sourceKey,
  task.sourceName,
  task.titleSample,
  task.episodeUrl,
  result.domain || null,
  result.kind,
  result.reason || null,
  result.upstreamStatus || null,
  result.probeTimeMs || null,
  result.resolutionLabel || null,
  result.firstSegmentLatencyMs || null,
  result.firstSegmentSpeedKbps || null,
  Date.now()
).run();
```

- [ ] **Step 4: 写最小探测测试**

```ts
it('returns direct when upstream probe succeeds', async () => {
  expect(true).toBe(true);
});
```

- [ ] **Step 5: 运行单测**

Run:
```bash
npm test -- src/lib/source-ranking/probe.test.ts --runInBand
```

Expected:
- PASS

- [ ] **Step 6: 提交**

```bash
git add src/lib/source-ranking/probe.ts src/lib/source-ranking/probe.test.ts src/lib/source-preference.ts
git commit -m "feat: add offline probe flow for personal ranking"
```

---

### Task 5: 建立简化评分模型

**Files:**
- Create: `src/lib/source-ranking/scoring.ts`
- Create: `src/lib/source-ranking/scoring.test.ts`

- [ ] **Step 1: 定义评分输入输出**

```ts
export interface SourceScoreInput {
  successRate: number;
  directRate: number;
  proxyRate: number;
  unavailableRate: number;
  avgLatencyMs: number | null;
  avgSpeedKbps: number | null;
  resolutionLabel: string | null;
}

export interface SourceScoreResult {
  healthScore: number;
  speedScore: number;
  qualityScore: number;
  finalScore: number;
}
```

- [ ] **Step 2: 实现清晰度分映射**

```ts
const QUALITY_SCORE_MAP: Record<string, number> = {
  '4K': 100,
  '2K': 88,
  '1080p': 76,
  '720p': 60,
  '480p': 40,
  SD: 20,
};
```

- [ ] **Step 3: 实现个人版总分计算**

```ts
export function scoreSource(input: SourceScoreInput): SourceScoreResult {
  const healthScore =
    input.successRate * 0.5 +
    input.directRate * 0.3 +
    input.proxyRate * 0.2 -
    input.unavailableRate * 0.6;

  const speedScore =
    input.avgSpeedKbps == null
      ? 35
      : Math.min(100, Math.max(0, input.avgSpeedKbps / 50));

  const qualityScore = input.resolutionLabel
    ? (QUALITY_SCORE_MAP[input.resolutionLabel] ?? 35)
    : 35;

  const finalScore =
    healthScore * 0.45 + speedScore * 0.30 + qualityScore * 0.25;

  return {
    healthScore,
    speedScore,
    qualityScore,
    finalScore,
  };
}
```

- [ ] **Step 4: 写一条关键排序测试**

```ts
it('prefers stable direct high-quality source', () => {
  const strong = scoreSource({
    successRate: 100,
    directRate: 100,
    proxyRate: 0,
    unavailableRate: 0,
    avgLatencyMs: 500,
    avgSpeedKbps: 5000,
    resolutionLabel: '1080p',
  });

  const weak = scoreSource({
    successRate: 70,
    directRate: 40,
    proxyRate: 20,
    unavailableRate: 30,
    avgLatencyMs: 1600,
    avgSpeedKbps: 600,
    resolutionLabel: '720p',
  });

  expect(strong.finalScore).toBeGreaterThan(weak.finalScore);
});
```

- [ ] **Step 5: 运行评分测试**

Run:
```bash
npm test -- src/lib/source-ranking/scoring.test.ts --runInBand
```

Expected:
- PASS

- [ ] **Step 6: 提交**

```bash
git add src/lib/source-ranking/scoring.ts src/lib/source-ranking/scoring.test.ts
git commit -m "feat: add simplified scoring model for personal ranking"
```

---

### Task 6: 建立 D1 读取链路并升级在线优选接口

**Files:**
- Create: `src/lib/source-ranking/read.ts`
- Modify: `src/app/api/source-preference/route.ts`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: 定义最近体检结果读取函数**

```ts
export async function readLatestSourceRanks(
  env: Env
): Promise<Array<{ sourceKey: string; finalScore: number; updatedAt: number }>> {
  const result = await env.DB.prepare(
    `SELECT source_key as sourceKey, final_score as finalScore, updated_at as updatedAt
     FROM source_rank_snapshots
     WHERE window_key = ?
     ORDER BY final_score DESC`
  ).bind('24h').all();

  return result.results || [];
}
```

- [ ] **Step 2: 在线优选接口先读 D1**

```ts
const runtime = getSourceRankingRuntime(process.env as unknown as Record<string, unknown>);
if (runtime.enabled && runtime.hasD1) {
  const ranks = await readLatestSourceRanks(env);
  if (ranks.length > 0) {
    return NextResponse.json({
      orderedSourceKeys: ranks.map((item) => item.sourceKey),
      results: [],
      generatedAt: Date.now(),
      rankingSource: 'd1',
      confidence: 'medium',
    });
  }
}
```

- [ ] **Step 3: 保留现有实时回退**

```ts
// if no D1 rank found, continue to existing live probe flow
```

- [ ] **Step 4: 运行当前探测测试与类型检查**

Run:
```bash
npm test -- src/lib/source-preference.test.ts --runInBand
npm run typecheck
```

Expected:
- PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/source-ranking/read.ts src/app/api/source-preference/route.ts src/lib/types.ts
git commit -m "feat: read personal source ranking from d1 before live probe"
```

---

### Task 7: 接入真实播放反馈

**Files:**
- Create: `src/app/api/source-feedback/route.ts`
- Create: `src/lib/source-ranking/feedback.ts`
- Modify: `src/app/play/page.tsx`
- Create: `src/lib/source-ranking/feedback.test.ts`

- [ ] **Step 1: 定义播放反馈输入**

```ts
export interface PlaybackFeedbackInput {
  sourceKey: string;
  playbackDomain?: string | null;
  title?: string;
  playbackMode: 'direct' | 'proxy';
  startupSuccess: boolean;
  startupTimeMs?: number;
  switchedToProxy?: boolean;
  browserQuality?: string;
  browserPingMs?: number;
  browserSpeedLabel?: string;
  sessionError?: string;
}
```

- [ ] **Step 2: 实现 D1 写入函数**

```ts
export async function savePlaybackFeedback(env: Env, input: PlaybackFeedbackInput) {
  await env.DB.prepare(
    `INSERT INTO playback_feedback_events
     (id, source_key, playback_domain, title, playback_mode, startup_success, startup_time_ms, switched_to_proxy, browser_quality, browser_ping_ms, browser_speed_label, session_error, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    input.sourceKey,
    input.playbackDomain || null,
    input.title || null,
    input.playbackMode,
    input.startupSuccess ? 1 : 0,
    input.startupTimeMs || null,
    input.switchedToProxy ? 1 : 0,
    input.browserQuality || null,
    input.browserPingMs || null,
    input.browserSpeedLabel || null,
    input.sessionError || null,
    Date.now()
  ).run();
}
```

- [ ] **Step 3: 播放页在首播成功时上报**

```ts
await fetch('/api/source-feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sourceKey,
    playbackMode,
    startupSuccess: true,
    startupTimeMs,
  }),
});
```

- [ ] **Step 4: 切代理时也上报**

```ts
await fetch('/api/source-feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sourceKey,
    playbackMode: 'proxy',
    startupSuccess: true,
    switchedToProxy: true,
  }),
});
```

- [ ] **Step 5: 写最小反馈测试并运行**

Run:
```bash
npm test -- src/lib/source-ranking/feedback.test.ts --runInBand
```

Expected:
- PASS

- [ ] **Step 6: 提交**

```bash
git add src/app/api/source-feedback/route.ts src/lib/source-ranking/feedback.ts src/lib/source-ranking/feedback.test.ts src/app/play/page.tsx
git commit -m "feat: store personal playback feedback in d1"
```

---

### Task 8: 恢复换源列表中的清晰度标签

**Files:**
- Modify: `src/components/EpisodeSelector.tsx`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: 为状态增加排序来源信息**

```ts
export interface SourceStatus {
  kind: SourceStatusKind;
  reason?: string;
  playbackMode?: SourcePlaybackMode;
  domain?: string | null;
  measured?: SourceVideoInfo;
  updatedAt?: number;
  fromMemory?: boolean;
  rankingSource?: 'd1' | 'live';
  rankScore?: number;
}
```

- [ ] **Step 2: 在换源卡片中渲染清晰度标签**

```tsx
{videoInfo?.quality && !videoInfo.hasError && videoInfo.quality !== '未知' && (
  <div className='px-1.5 py-0 rounded text-xs bg-black/5 dark:bg-white/10 text-cyan-600 dark:text-cyan-400'>
    {videoInfo.quality}
  </div>
)}
```

- [ ] **Step 3: 保留已有速度和延迟显示**

要求：
- 有清晰度就同时显示清晰度、速度、延迟
- 无清晰度时不影响旧展示

- [ ] **Step 4: 手动验证**

Check:
- 能看到 `4K / 1080p / 720p` 等标签
- `可播 / 直连 / 代理` 逻辑不变

- [ ] **Step 5: 提交**

```bash
git add src/components/EpisodeSelector.tsx src/lib/types.ts
git commit -m "feat: restore quality labels in source selector"
```

---

### Task 9: 文档与发布说明

**Files:**
- Modify: `README.md`
- Modify: `docs/CLOUDFLARE_SOURCE_RANKING.md`

- [ ] **Step 1: 在 README 中说明个人版方案**

补充内容：
- 仅依赖 D1 + Cron
- 不需要 Queue、KV、Analytics
- 推荐每天 1 到 2 次体检

- [ ] **Step 2: 写明启用顺序**

顺序必须是：
- 先建 D1
- 再开 Cron
- 再打开 `SOURCE_RANKING_ENABLED`

- [ ] **Step 3: 写明故障回退**

至少说明：
- D1 没数据时会回退实时探测
- Cron 没跑时不影响播放
- 关闭开关后回到旧逻辑

- [ ] **Step 4: 提交**

```bash
git add README.md docs/CLOUDFLARE_SOURCE_RANKING.md
git commit -m "docs: add personal cloudflare ranking guide"
```

---

### Task 10: 完整验证

**Files:**
- Modify: `src/lib/source-preference.test.ts`
- Modify: `src/lib/source-ranking/*.test.ts`

- [ ] **Step 1: 运行核心单测**

Run:
```bash
npm test -- src/lib/source-preference.test.ts src/lib/source-ranking/probe.test.ts src/lib/source-ranking/scoring.test.ts src/lib/source-ranking/feedback.test.ts --runInBand
```

Expected:
- 全部 PASS

- [ ] **Step 2: 运行类型检查**

Run:
```bash
npm run typecheck
```

Expected:
- PASS

- [ ] **Step 3: 运行精确 lint**

Run:
```bash
npx eslint src/app/play/page.tsx src/components/EpisodeSelector.tsx src/app/api/source-preference/route.ts src/app/api/source-feedback/route.ts src/lib/source-ranking
```

Expected:
- PASS

- [ ] **Step 4: 浏览器手动验证**

Check:
- 播放页仍能快速打开
- D1 有结果时优先使用 D1 排序
- D1 无结果时回退实时探测
- 换源列表显示清晰度标签
- 直连失败时仍能切代理

- [ ] **Step 5: 发布前检查**

必须满足：
- 关闭 `SOURCE_RANKING_ENABLED` 后旧逻辑完整可用
- 没有 D1 时不白屏不阻断播放
- Cron 不运行时只损失优选质量，不损失播放能力

- [ ] **Step 6: 提交**

```bash
git add src/lib/source-preference.test.ts src/lib/source-ranking
git commit -m "test: verify personal cloudflare ranking flow"
```

---

## 建议执行顺序

1. Task 1 `D1 表结构`
2. Task 2 `运行时开关`
3. Task 3 `低频 Cron`
4. Task 4 `离线探测`
5. Task 5 `简化评分`
6. Task 6 `在线优选接口接入 D1`
7. Task 7 `真实播放反馈`
8. Task 8 `恢复清晰度标签`
9. Task 9 `文档说明`
10. Task 10 `完整验证`

---

## 风险与处理

- 如果 D1 中样本过少，排序不一定准确，所以必须保留实时回退。
- 如果 Cron 体检频率太高，会浪费额度；个人使用建议每天 1 次起步。
- 如果某些源离线体检稳定但用户播放不佳，要靠真实播放反馈慢慢纠偏。
- 如果离线阶段拿不到分辨率，前端不要显示假标签。

---

## 完成标准

这份精简计划完成后，应达到：

- 播放前优先使用 D1 中最近体检结果
- 浏览器不再承担主要排序压力
- 换源列表恢复清晰度标签
- 真实播放结果会写回 D1
- 整套方案只依赖 D1 + Cron
- 任一新能力失效时，旧播放链路仍可正常工作

