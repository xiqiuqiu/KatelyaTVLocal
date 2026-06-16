# 分支代码审查报告

- 审查日期: 2026-06-16
- 分支: codex/playback-source-probe-platform-fix
- 基线: main@430c8a3760434bada649b852ea7c26bc8f94deff
- 审查方式: 静态审阅 + 相关测试执行

## 审查结论

本次改动整体方向清晰，新增了平台感知探测、历史记录恢复和测速信息分层展示，相关单测也有补齐。

发现 2 个需要优先修复的问题，按严重级别排序如下。

## Findings

### 1) High - 播放页回退到详情结果后未同步可切换源列表，可能导致线路切换异常

- 证据:
  - `fetchSourceDetail` 返回详情后不再更新 `availableSources`：`src/app/play/page.tsx:2641-2654`
  - `availableSources` 仅在搜索结果路径更新：`src/app/play/page.tsx:2686`, `src/app/play/page.tsx:2690`
  - 初始化时 `detailData/sourcesInfo` 可能被 `resolvePlaybackHistoryRecovery` 改写为详情回退结果：`src/app/play/page.tsx:2741-2763`
  - 换源逻辑依赖 `availableSourcesRef/availableSources` 查找目标源，找不到即报错：`src/app/play/page.tsx:2880-2889`
- 风险影响:
  - 当搜索结果为空或不含当前源，而详情接口仍返回可播数据时，页面可播放但侧边栏源列表可能为空或与当前源不一致。
  - 用户点击换源时会直接触发“未找到匹配结果”，属于可感知回归。
- 建议修复:
  - 在 `initAll` 产出最终 `sourcesInfo` 后统一执行一次 `setAvailableSources(sourcesInfo)`，确保展示/换源逻辑和最终选源一致。
  - 增加回归测试: `searchResults=[] + detailResults=[...]` 场景下，侧边栏仍应显示可切换源且可成功换源。

### 2) Medium - 二次 fresh metrics 请求在部分失败场景会把线路状态长期卡在“检测中”

- 证据:
  - 发起二次请求前，先把可见源状态设置为 `probing`：`src/components/EpisodeSelector.tsx:779-799`
  - 二次请求显式关闭 live fallback：`src/components/EpisodeSelector.tsx:805-810`
  - 服务端 fresh probe 对单源失败会吞掉错误并返回 `null`，随后被过滤掉：`src/app/api/source-preference/route.ts:267-273`
  - 结果合并仅覆盖“返回了结果的 sourceKey”，缺失项不会回退状态：`src/components/EpisodeSelector.tsx:695-723`
  - `sourcePreferenceFreshProbeKeyRef` 仅在请求抛异常时重置，HTTP 200 但返回缺失项不会重试：`src/components/EpisodeSelector.tsx:815-817`
- 风险影响:
  - 当某些源在 fresh probe 阶段没有返回结果（例如 D1 无快照且 fresh probe 失败），UI 会保留“检测中，可切换”状态，且后续不再重试。
  - 状态与真实可用性脱节，影响用户判断与切源体验。
- 建议修复:
  - 在 `requestFreshMetricsForVisibleSources` 合并结果后，对本轮请求但未返回的 `sourceKey` 做状态回退（恢复到发起前状态或触发一次轻量 fallback probe）。
  - 无论请求是否抛异常，只要存在缺失项都应重置 fresh probe key，允许后续重试。
  - 增加测试: `includeFreshProbeMetrics=true` 且返回结果缺失部分 key 时，源状态不应永久停留在 `probing`。

## 测试执行记录

已执行以下测试并全部通过:

`pnpm test -- src/app/api/source-preference/route.test.ts src/lib/playback-history-recovery.test.ts src/lib/source-preference-video-info.test.ts src/lib/hls-playback-policy.test.ts src/lib/source-ranking/read.test.ts src/components/__tests__/player-sidebar.test.tsx src/components/__tests__/video-card-actions.test.tsx`

- Test Suites: 7 passed, 7 total
- Tests: 52 passed, 52 total
