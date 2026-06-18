# 当前分支代码审查报告（2026-06-17）

## 审查范围

- 基线：`main...HEAD`
- 分支：`codex-优化历史记录回播的功能`
- 变更文件：19 个（核心涉及播放记录 API、客户端缓存、存储层、定时任务与测试）

## 结论摘要

- 发现 1 个高优先级正确性问题（会导致“继续观看”列表被错误清空）。
- 发现 1 个中优先级性能风险（部分存储后端 `limit` 查询仍会全量扫描）。
- 发现 1 个低优先级测试缺口（未覆盖高风险路径）。

## 详细问题（按严重级别排序）

### 1) 高：`getRecentPlayRecords` 在缓存为空时不回填缓存，后续乐观删除会把列表误清空

- 位置：`src/lib/db.client.ts:633`、`src/lib/db.client.ts:650`、`src/lib/db.client.ts:737`、`src/lib/db.client.ts:742`
- 关联调用：`src/components/ContinueWatching.tsx:46`、`src/components/ContinueWatching.tsx:61`

问题说明：

1. 首页“继续观看”现在优先调用 `getRecentPlayRecords(50)`（`ContinueWatching.tsx:46`）。
2. 非 `localstorage` 模式下，如果播放记录缓存为空，`getRecentPlayRecords` 会直接请求 `/api/playrecords?limit=...` 并返回（`db.client.ts:650`），但没有写回 `cacheManager`。
3. 用户随后删除任意一条记录时，`deletePlayRecord` 的乐观更新以 `cacheManager.getCachedPlayRecords() || {}` 为基准（`db.client.ts:737`），此时会得到空对象，并立即通过事件广播空结果（`db.client.ts:742`）。
4. `ContinueWatching` 订阅了 `playRecordsUpdated`（`ContinueWatching.tsx:61`），因此 UI 会被错误清空，而不是仅移除目标记录。

影响：

- 用户从首页首次进入（缓存为空）时，删除一条历史记录可能导致“继续观看”整块列表瞬时清空，属于可见行为回归。

建议修复：

- 方案 A（更稳）：在 `savePlayRecord` / `deletePlayRecord` / `clearAllPlayRecords` 的非本地存储分支里，如果主缓存为空，先拉取一次全量数据再做乐观变更。
- 方案 B（更轻）：`getRecentPlayRecords` 在缓存为空时写入“recent-only”缓存并打标；后续乐观更新检测到该标记时，避免直接用 `{}` 覆盖，并触发一次强制重拉。
- 同时补充回归测试（见问题 3）。

### 2) 中：`limit` 接口在 Redis/Kvrocks/Upstash/LocalStorage 后端仍走全量读取，性能优化未闭环

- 位置：`src/lib/redis.db.ts:136`、`src/lib/redis.db.ts:141`、`src/lib/kvrocks.db.ts:134`、`src/lib/kvrocks.db.ts:139`、`src/lib/upstash.db.ts:123`、`src/lib/upstash.db.ts:128`、`src/lib/localstorage.db.ts:98`、`src/lib/localstorage.db.ts:103`

问题说明：

- 各后端新增了 `getRecentPlayRecords`，但实现是 `await getAllPlayRecords(userName)` 后内存排序切片。
- 对大用户数据集，这仍是 $O(n)$ 全量加载，无法真正降低接口成本（尤其是定时任务与高频首页刷新场景）。

影响：

- 功能正确，但在非 D1 场景下，`/api/playrecords?limit=...` 的性能收益有限，和“最近记录优化”的目标不完全一致。

建议修复：

- 为这些后端增加按 `save_time` 可排序的数据结构（如 `sorted set` 或单独索引），支持真正的 Top-N 读取。

### 3) 低：测试未覆盖“仅 recent 读取后立刻删除/清空”的回归路径

- 已有覆盖：`src/lib/db.client-playrecords.test.ts:36`（并发去重）、`src/lib/db.client-playrecords.test.ts:68`（防止陈旧刷新覆盖）
- 缺口：当前测试在“有全量缓存”前提下验证（见 `src/lib/db.client-playrecords.test.ts:112`），未覆盖“recent-only + 空缓存 + delete/clear”的路径。

建议补充：

- 新增用例：先调用 `getRecentPlayRecords`（不调用 `getAllPlayRecords`），再调用 `deletePlayRecord`，断言不会广播空集合。
- 新增用例：同路径下调用 `clearAllPlayRecords`，断言行为与预期一致且不会污染后续拉取。

## 正向观察

- `parsePlayRecordKey` 抽取后复用于 API、Cron、Scheduler，修复了 `id` 包含 `+` 时的截断问题，方向正确。
- D1 新增 `ORDER BY save_time DESC LIMIT ?` 的最近记录查询实现，属于有效优化。

## 已执行验证

- 已运行测试：
  - `pnpm test -- src/lib/db.client-playrecords.test.ts src/app/api/playrecords/route.test.ts src/lib/play-record-key.test.ts src/lib/source-ranking/scheduler.test.ts`
- 结果：4 个测试套件全部通过（27/27）。
