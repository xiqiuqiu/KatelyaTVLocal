# 首批：起播关键路径优化与最小质量指标

日期：2026-10-26。关联 [Issue #93](https://github.com/xiqiuqiu/KatelyaTVLocal/issues/93)。用户已确认方案；本次只交付任务 1 的观测基线，任务 2、3 的起播策略和 30 秒交互另行实施。

## 起播预算与交互

已确认的产品决定：累计等待 30 秒后停止自动尝试，让用户选择“继续尝试”或“手动换线”。以下暂停、续试和统计细则均已确认；预算策略尚未在任务 1 中启用。

### A. 30 秒具体怎么算

| 场景                  | 建议规则                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| 开始                  | 站内卡片入口有可关联的点击时间则从点击算；直链/刷新从本次入页算。包括搜索、详情、历史读取、优选与媒体加载 |
| 单条线路              | 沿用现有 10 秒媒体就绪超时；它在总体 30 秒内运行，自动换到下一条不会重开总体预算                          |
| 成功                  | 当前源、当前集已实际播放，并取得当前媒体代的首帧证据；仅 canplay 不结束总体预算                           |
| 手动暂停/自动播放受限 | 停止有效等待累计与自动恢复，等待用户明确播放；不算坏源、不算起播失败                                      |
| 切后台                | 暂停累计；回前台按剩余时间继续。另存包含后台停留的真实耗时，统计时区分                                    |
| 到 30 秒              | 进入选择态，停止继续自动切线及当前未成功的媒体加载；保留标题、候选、目标集数和续播点                      |
| 继续尝试              | 新开一轮 30 秒；优先恢复仅被预算中断而未判定失败的线路，再尝试剩余候选。保留已确认失败记录                |
| 手动换线              | 展开线路列表，用户选定后新开一轮 30 秒；同一集的续播点保留。仅打开面板不自动重新播放                      |
| 切集/换片             | 切集建立新的起播链；换片结束旧观看，创建新观看。旧请求、旧 timer、旧首帧回调全部失效                      |
| 正常播放后卡顿        | 本批不改变现有播放中恢复规则；该规则只约束本集实际开始播放之前的起播过程                                  |

30 秒是“前台、希望播放时的有效等待”，不是后台停留或用户决策时间。计时由单调时钟计算，不按 timer 回调次数累加；前台 timer 被主线程阻塞时，在恢复执行后的首次检查处理超时，不承诺浏览器停止执行时仍能准点弹窗。单源计时在起播阶段也服从暂停/后台边界。

建议超时文案：“这次连接已等待 30 秒，暂未开始播放。”操作为“继续尝试”“手动换线”“返回”。不显示“全部线路不可用”，除非发现流程确已结束且候选全部失败。候选提前用尽可以提前提示，无需硬等满 30 秒。

若超时时尚无播放器，初始加载视图也必须显示相同选择。若还没获取到候选，“手动换线”展示“暂未获取到线路”，提供用户主动“重新获取线路”和返回搜索；重新获取有独立的新 30 秒等待轮，仅补列表、不自动选择播放，不能留下无响应的空面板。

### B. 起播关键路径怎么改

当前 [initAll](../../src/app/play/page.tsx#L4937) 先等全源搜索，再读必要详情和历史；[搜索 API](../../src/app/api/search/route.ts#L46) 等所有来源返回。优化对象首先是有明确 source/id 且没有 `prefer=true` 的入口，包括继续观看和指定线路链接。

1. **并行启动三件事**：指定源详情、现有精确同剧候选搜索、现有历史读取；沿用 `/api/detail`、`/api/search` 和 `getAllPlayRecords`。详情或搜索中的同 source/id 结果任一先返回有效数据即可作为该指定源详情，另一支失败不提前终止整轮。
2. **指定源＋续播信息准备好即提交起播**：复用 `resolvePlaybackHistoryRecovery` 与 Watch Progress 规则，确定集数、恢复点、播放 URL 后挂载播放器。历史读取继续在关键路径内，避免为了快而先从 0 播、稍后又跳进度。
3. **其余候选后台补齐**：按 source+id 去重合并到列表，保留当前源和选中态，再同步 Session 来源证据。保持现有综合分、优选预算、直连与渐进测速策略；后台评分更新不主动打断播放。
4. **处理首源失败但候选仍在路上**：发现状态明确为 pending/complete/error；pending 时没有备用源不等于全部不可用。等待候选补齐后在剩余 30 秒内兜底，不能因先只有一条线路而提前错误终结。
5. **保留入口差异**：`prefer=true` 的聚合卡片及只有片名的豆瓣入口仍走现有选源，第一批只纳入整体预算与测量，不引入搜索流式返回或重写排序。关闭优选开关时也保留 30 秒选择能力。
6. **保留历史失效 fallback**：指定源详情失败、缺目标集或已知不可用时，历史入口按现有同剧搜索与可用性策略兜底；非历史指定源入口沿用其明确指定的含义，不能静默跳去另一部或另一个版本。

后台返回只能更新候选/状态/评分，不能再调用已提交的初始起播流程、重新应用历史 seek 或重写用户已经改过的 URL。用户主动换线、切集、离开、超时选择都会改变本轮 generation，旧异步结果不得写回。当前 [线路面板](../../src/components/player/EpisodeSelectorSources.tsx#L91) 在 sourceSearchLoading 时隐藏列表，需要允许“已有线路可见、其余正在获取”，保证早起播时当前线路可见且固定优先展示。

### C. 状态与副作用放在哪里

- **Playback Session 是预算决策唯一入口**：在页面初始化、还没有播放器时接收 startup.started；增加 active/waiting-choice/succeeded/cancelled 等起播状态及开始、暂停、恢复、超预算、继续、首帧事件。首帧前所有自动切线出口都检查剩余预算，避免旧 timer、HLS fatal 或 fallback 绕过 30 秒限制。
- **页面 adapter 负责请求和播放器操作**：分开本轮指定源/搜索/优选的取消句柄；到预算清 timer、取消本轮独占 fetch、停止未成功的 HLS 加载并使媒体回调代次失效。共享的历史缓存读取只丢弃过时消费结果，不强行中止其他调用方的共享请求。浏览器取消搜索不保证服务端已启动的下游请求立即终止，首批不改搜索 API 全链路取消协议。
- **Provider 只提供观测时间**：在 `start` 捕获目标与点击时戳，通过一次性 launchTiming 交给播放页；视觉 overlay 的 surfaceReady 后仍保留该关联供消费。预算、线路和媒体决策都不移入视觉 Provider，符合现有 [ADR 0001](../adr/0001-command-driven-playback-session.md) 与项目域定义。
- **复用现有失败视图和线路选择组件**：为 budget-exhausted 增加专用原因/动作；初始 loading 分支与播放器内分支均可展示。无需为显示提示强行置 loading=false，避免没有 detail 时渲染播放器或卸载有效宿主。
- **预算用尽不是源失败**：单源已明确超时/报错仍按原策略记录；仅被总预算打断的源标为 interrupted，不写不可用记忆、不发送旧反馈 `startupSuccess=false`。续试只恢复该中断项的资格，不清空所有失败/探测账本。
- **保护历史与用户动作**：暂停/停止加载不保存 0 进度、不清空待续播点；旧 canplay、旧首帧不得恢复播放。选择态出现后即使网络晚到也不擅自关掉提示或开始播放，等待用户明确动作。

建议只提取本批需要的纯预算决策与加载结果合并逻辑，仍接入现有 Session；不顺带拆整页或迁移恢复阶梯。

### D. 可独立验收的四个实现任务

| 顺序 | 任务与交付物                                                              | 主要范围                                                               | 验收重点                                                                           |
| ---- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1    | 校准观看/单源 ID，接入最小指标、D1 事实表及管理员 summary，先采旧策略基线 | attempt reporter、准备时间交接、首帧观测、新指标 API/SQL、构建版本     | 一次源启动一个 ID；canplay 不冒充首帧；非管理员可上报但不能读；重复/乱序不重复计数 |
| 2    | 指定源直接起播、候选后台补齐                                              | play 初始化、历史恢复、候选合并、线路面板 loading 展示                 | 搜索挂起但指定源与历史已返回时开始媒体请求；后台结果不覆盖用户选线或续播点         |
| 3    | 整体 30 秒预算与选择交互                                                  | Session types/reducer/effects、页面 timer/请求取消、初始与播放器内视图 | 连续坏源不自动越过 30 秒；继续新一轮；手动选线可用；暂停/后台/自动播放受限不误失败 |
| 4    | 端到端与部署验收，按基线比较结果                                          | 关键用例、Pages 预览/D1 迁移、桌面及目标平台                           | 指定源入口耗时改善；首轮成功率与超预算分开；进度、选线、取消不回归                 |

依赖顺序：任务 1 提供可比较的基线；任务 2、3 都依赖其 ID/时间口径稳定，最终一起完成任务 4。相对工作量：1 中至偏大，2 中，3 中，4 取决于平台可用性；当前不承诺人日。确认后仍可按这四个可审查切片逐步实现，不要求一次大改。

影响文件除下文指标文件外，还包括 `src/lib/playback-session/{types,reducer,adapter-effects}.ts`、`src/lib/playback-history-recovery.ts`（仅在现有接口无法表达早提交时调整）、`src/components/player/EpisodeSelectorSources.tsx`，以及初始化/加载层相关测试。复用现有 API 与存储契约，不给每个卡片塞完整播放数据。

### E. 功能验收清单

1. 指定源详情 1 秒、历史 1 秒、全源搜索 15 秒：约在前两者完成后即发媒体请求，不等第 15 秒；同 source/id 的搜索结果更早也能提交。
2. 指定源失败、候选稍后到达：在总预算内自动兜底；候选 pending 不误报“全部不可用”；缺当前集不静默改集数。
3. 连续多条失败：单源最多按现有 10 秒媒体等待，整体有效等待到 30 秒出现选择；之后旧请求/回调不启动第四条或偷偷恢复。
4. 仅被预算中断的当前源：继续可恢复；已明确失败的源保持跳过；无剩余候选时明确展示重新获取/重试路径。
5. 第 29 秒暂停或切后台：不在第 30 秒误切线；恢复后按剩余时间继续。自动播放被拦时提示用户播放，不标坏源。
6. canplay 后没有真实帧：不记成功，总体预算仍有效；旧源帧、续播 seek 前帧、旧 timeout 均不污染新轮。
7. 起播后后台搜索完成：当前源不变、选中态不丢、恢复点不再被应用；手动选源后晚到的初始化结果不抢回控制。
8. 标题/年份补齐、URL 内部规范化：不新建观看或清空预算；真正换片则新建，离开后无后台播放、不写 0 进度。

实现时给预算纯策略使用假时钟，给关键路径使用可控 Promise 证明“搜索未完成也已发起媒体”；DOM 生命周期回归复用 play-page-player-lifecycle、playback-history-recovery、playback-attempt 和当前 play 页面用例。业务实现后再跑 typecheck、lint、相关 Jest 及仓库要求的 CI，文档阶段不以既有测试通过代替新方案验收。

## 最小质量指标：现有能力与复用边界

| 现有一手代码                                                                                         | 复用方式与缺口                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [attempt reporter](../../src/lib/playback-attempt/reporter.ts#L38)                                   | 复用 sessionId、sourceChangeAttemptId；不另造与调试不相通的观看 ID                                                  |
| [scheduleSourceChangeTimeout](../../src/app/play/page.tsx#L2759)                                     | 当前在定时器安排处 mint sourceAttempt；换源与 updateVideoUrl 都会调用，需把“新尝试”与“重设定时器”拆开，先加回归测试 |
| [标题 effect](../../src/app/play/page.tsx#L3759)                                                     | 当前根据标题/年份 begin/changeTitle；详情补齐不应把同一次用户选择误切成新观看，需区分元数据补齐与真正换片           |
| [canplay 成功反馈](../../src/app/play/page.tsx#L6268)                                                | 保留原质量记忆语义；本次另采首帧，不把已有 startupTimeMs 直接改名为首帧                                             |
| [调试 API](../../src/app/api/playback-debug/route.ts#L32)                                            | 管理员+调试开启才保存；本次新增普通已登录用户指标接口，保持原调试权限                                               |
| [source-feedback](../../src/app/api/source-feedback/route.ts#L15) / [D1 helper](../../src/lib/d1.ts) | 复用 Cookie 鉴权、Zod 严格结构、绑定读取方式；指标不写成旧 feedback 事件，不改变线路降权规则                        |
| [退出保存 hook](../../src/components/player/usePlayProgressPersistOnUnload.ts#L14)                   | 沿用 hidden 时 keepalive 的发送方式，指标独立快照，不等待进度保存完成                                               |
| [准备过渡 Provider](../../src/components/playback-preparation/PlaybackPreparationProvider.tsx#L410)  | 只提供 launchTiming 观测接口（点击单调时间、目标、来源）；surfaceReady 后仍能读取一次，不持有预算/换源决策          |

### 1. ID 与生命周期：一个入口，一次 mint

- `sessionId`：播放页 init 到真正换片/离页；同片换线、切集不换 ID。session/round 都由播放页 init 生成，播放器初始化之前即可取得，详情补齐只更新维度。Provider 仅保存可消费一次的 launchTiming，播放页进入初始化时由 PlaybackSession 接收 startup.started；点卡片但尚未进入播放页就取消，首批不计播放分母，不为此把业务状态机搬进视觉桥。
- `rootRoundId`：直接取同次起播链的第一轮 startupRoundId，不再生成 UUID。同片“继续尝试”及首帧前手动选线沿原 root；切集、成功后重新开始新起播建新 root。最终成功按 root 归并，首轮预算达成按 root 的第一轮计算。
- `startupRoundId`：session 内递增。首次进入、首帧前主动选线、用户“继续尝试”、切集各开新 round；自动换源、同源 HLS 重试不重开。`roundReason` 仅 `initial / continue / manual-source / episode`。
- `sourceChangeAttemptId`：实际提交一次新的 source+episode 媒体尝试时 mint，详情读取不占单源 10 秒媒体加载预算；详情等待仍计总 30 秒。重设计时器、重新解析同一次 URL 不 mint；新一轮明确重试同源才 mint。底层 HLS 请求重试不增 ID，probe 永不算 source attempt。
- 各异步回调捕获 `(sessionId, roundId, attemptId, mediaGeneration)`；旧 canplay/首帧/timeout 返回时核对当前代。ID 只在 reducer/现有 reporter 对应的单一入口变更，不用计时器再生成平行 ID。
- 首批仅记录首次首帧前的自动换源及其成功/失败；播放中卡顿恢复、日常播放时长不新增采集或策略。

### 2. 测量起止与首帧证据

| 测量           | 开始                                                                                     | 结束/暂停规则                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 点击到首帧     | 站内卡片实际触发导航的时刻                                                               | 当前媒体的首个有效帧；没有点击记录则 null，不与入页样本混算                                                                   |
| 入页到首帧     | 本次播放页入口初始化；直链/刷新采用本次 document navigation 起点，SPA 采用播放页入口时刻 | 首帧；分别记录 entryKind，避免把 SPA 整站 document 起点当入页                                                                 |
| round 前台等待 | 首轮从可关联的点击或入页；后续从用户动作/新集开始                                        | 第一帧或终态；暂停、自动播放限制、hidden 不累计；30 秒进入选择态后不再累计                                                    |
| 单源等待       | 确定目标媒体、提交实际播放加载                                                           | 首帧、明确失败、单源 10 秒就绪超时或被取消；10 秒仍以现有媒体就绪条件停止，canplay 不能停止整体 30 秒；详情读取不计此单源阶段 |
| 换线恢复       | 首帧前的恢复策略提交目标源                                                               | 新源恢复实际帧进展；失败、被替代或用户取消分别收口                                                                            |

计时使用浏览器单调时钟；站内导航共用同一时间原点，转整页导航则携带可验证的时间原点+相对值，否则退回入页口径。不把客户端绝对时间当统计日，服务器接收日/时间负责归档。墙钟耗时与前台有效等待分开存；后台长停留样本单独标记，不混入前台 P95。

首帧优先在新媒体绑定后注册一次 `requestVideoFrameCallback`，要求当前媒体代匹配、实际意图为播放且不是旧缓冲画面；续播 seek 时等恢复目标已应用，不能把 seek 前片头帧当恢复成功。该 API 对应“视频帧送入合成器”，不是物理屏幕扫描证明。[MDN API 说明](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)

不支持该 API 时，以 `playing` 后的实际播头前进作为降级成功，并记 `frameEvidence=playhead`；有 API 则记 `rvfc`。`canplay`、UI 过渡结束、预加载静止帧都不算。两种证据各给样本数及分位数；首批不合并成同精度“真实首帧”。取消旧 callback/listener，防止同一元素换址后的旧帧串源。

### 3. 首批指标与分母

| 指标               | 可直接实现的口径                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首轮自动起播达成率 | 起播链第一轮在 activeWait≤30 秒内首帧成功 / 已收口首轮；手动选线导致提前结束首轮归用户干预，单列次数，不伪装网络失败；同时显示全部 starts、pending、unobserved 数 |
| 起播最终成功率     | initial/continue/manual-source 链上任一首帧成功的 entry / 已收口 entry；同一 session 首次选片只计一次，切集另列，不重复增加首入分母                               |
| P50/P95            | 成功样本的 clickToFrameMs、pageToFrameMs 和 activeWaitMs，按入口、平台、frameEvidence、版本分组；注明“成功样本”、样本数与失败/放弃率                              |
| 30 秒超预算        | `roundOutcome=budget-exhausted`；后续选择 continue/manual/leave 分别计数；续试成功不回改首轮超预算                                                                |
| 用户放弃           | 明确返回/取消/换片且未成功；普通 hidden 不算放弃，系统杀进程无终态只记 unobserved，不伪造失败                                                                     |
| 单源结果           | source outcome ＝ frame-ready/source-timeout/network-error/media-error/cancelled；整体预算中止归 cancelled+budget，不写旧反馈 startupSuccess=false                |
| 恢复切源结果       | 首帧前 auto-failover 尝试中实际首帧成功/明确失败，另列取消/未观测；不采本批范围外的播放中恢复，也不用 canplay 当恢复完成                                          |

首批不采播放中卡顿、日常播放时长，不新建恢复状态机。后续明确暂停/seek 排除与时长口径再单独补 QoE，现有调试与线路反馈保持原样。

### 4. 上报契约：小批量完整快照，不传日志流

建议新建 `POST /api/playback-quality`，body `{ schemaVersion:1, records:[...] }`，一次 ≤4 条，总体 ≤16KiB。每条是 round 或 source 的完整快照，方便乱序重试与服务端替换：

| 字段组     | 内容与约束建议                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主键       | sessionId（≤80 字符）、startupRoundId/rootRoundId（正整数）、rowKind（round/source）、sourceChangeAttemptId（round 固定 0、source 正整数）                                                          |
| 更新       | seq 递增、status（pending/terminal）；outcome 固定枚举，终态不得回 pending 或改成另一终态                                                                                                           |
| 维度       | contentKey（已有标准化片名+年份键）、episodeIndex、sourceKey、runtime/platform 枚举、entryKind、roundReason/sourceReason、releaseId、policyVersion；不额外传片名字段、完整播放 URL、Cookie、原始 UA |
| 时间       | elapsedMs、activeWaitMs、clickToFrameMs/pageToFrameMs/sourceToFrameMs（可 null）、frameEvidence、hadHidden/autoplayBlocked；有限非负数，初定单值 ≤24 小时                                           |
| 决策       | round 终态后可补 promptChoice（continue/manual/leave）与 nextRoundId；只准空 → 有效选择，保留原 outcome 和首帧时间                                                                                  |
| 服务端补充 | owner 从登录态取得，receivedAt/updatedAt/dayKey 服务端生成；客户端不能指定 owner 或统计日                                                                                                           |

初始 round 开始、实际 source 开始立即异步发 pending（否则中途退出样本无分母）；首次帧、单源失败、30 秒超预算、用户选择、切集/离页发终态或选择快照。正常播放不按 timeupdate 上报。source 始/终两条路径各一次，重复发送不增加记录。

hidden 发 checkpoint、pagehide/SPA 离页兜底使用 `void fetch(...,{keepalive:true})`，捕获错误；不 await，不阻塞返回，不依赖 beforeunload 成功。hidden 不设 terminal，回前台继续同一摘要；[浏览器最后可靠可观察生命周期点](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)适合发送快照，不意味着用户已放弃。保留进度保存独立执行，既不等待它也不影响它。

不在 localStorage 建遥测日志队列；页面仍在时可保留最近未确认快照，网络恢复/下次正常提交合并补发一次，离页投递仍可能丢失。开始即 pending 使丢失可见，不把缺失终态硬算放弃。

### 5. D1：一张事实表、唯一键、顺序和幂等

新增一张 `playback_quality`，同时存 rowKind=round/source；列为上述固定字段，owner 仅后台可读。唯一约束 `(owner, session_id, round_id, row_kind, attempt_id)`，round 行 attempt_id=0。索引 `(day_key, release_id, row_kind)` 与 `(owner, received_at)`，不把自由文本详情塞 JSON。

UPSERT 仅接受更大 seq，固定 owner/session/root/round/attempt/episode/release 身份：pending 可更新/终结；terminal 不可改变结果或覆盖计时；允许终态空 promptChoice 补为一次明确选择。source 行的来源固定，round 行可在成功时补最终胜出源，不把初始未知维度冻结成空值。seq 重复/旧 checkpoint 返回成功但不重写。rootRoundId 不大于本 roundId，归属从登录账号与 session 联合确定；乱序先到的 source/续试记录可保存，缺首轮摘要的链单列为待补齐，不凭它增加起播分母。客户端后续补发仍未确认的首轮摘要。更新必须在 SQL 条件中完成，不能先 SELECT 判断再无条件 UPDATE，避免终态被乱序覆盖。summary 按 root 第一条 round 行计起播链分母，不以 source 行数或续试 round 数当观看次数。每源仅始/终快照，不新增恢复框架。

checkpoint 只是覆盖同一行：开始一次；hidden 时有变化才发且每 round 至多 4 次；终态一次；选择一次。seq 来自内存固定递增，限制每行总 revision，终态留一个保留位置。重复 terminal/延迟 hidden 测试必须证明不再写。pending 超过 24 小时显示 unobserved，保留原事实，不后台推断为 network-error；选择态无后续选择也记未观测。

存储限量建议初值：每账号每日新增 ≤2000 条事实行，session 内 round≤100、sourceAttempt≤1000；新行插入用索引计数条件与 INSERT 同一 SQL 原子完成，更新已有行仍需通过 revision/状态限制。复用现有[原子额度条件写](../../src/lib/ai-find/usage-quota.ts#L151)模式，不复用 AI 业务表或新增通用 quota 框架；具体 SQL 需本地 D1/SQLite 并发自检。服务端时间戳存 UTC，dayKey 按 Asia/Taipei 计算并固定为首次接收日，后续更新不移动统计日；起播链最终结果归首轮所在日，查询和限额沿同一日界限。

保留 30 天，复用现有 cron 路径定量清理过期记录；不是每个播放请求清全表。新表迁移失败、无 D1 均返回 202 `{saved:false, skipped:true, reason:'no-d1'|'storage-unavailable'}`；客户端不弹错、不停播放，不在 Redis 部署强建第二种遥测存储。首次接口 202 后本会话停发，避免无 D1 每次事件空请求。

### 6. 鉴权、校验与版本

- 普通登录用户可 POST 自己的指标；Cookie 身份来自现有 `getAuthInfoFromCookie`，未登录 401，拒绝跨站写入，body 严格 Zod 和字节上限，未知字段/非法 seq/越界时长 400。管理查询继续用 `isAdminRequest`；不要放开原 debug API。
- 请求速率初值每账号每分钟 120 个包，可用短 TTL 进程 Map 作削峰，必须注明 Edge 实例间不强一致；真正控制新增存储量靠上节 D1 原子日限额。超额 429 且客户端停止当前窗口重试；不因指标失败影响观看或线路评分。
- 当前 [generate-version.js](../../scripts/generate-version.js#L30) 指向本地不存在的 version.ts，不能当可靠发版标识。首批在 `next.config.js` 固化构建时 releaseId：显式部署变量 →`CF_PAGES_COMMIT_SHA`/CI Git SHA→`unknown`；同一构建前后端共用常量，不在用户请求时调用 git。Pages 内置 SHA 来源见[Cloudflare 文档](https://developers.cloudflare.com/pages/configuration/build-configuration/#environment-variables)。
- policyVersion 固定本批策略名称；预览/生产环境单独维度；unknown 可采集但不能拿来比较发版。旧客户端请求新服务端仍以客户端构建版本归因，不能被服务端版本覆盖。

### 7. 首批交付物、影响文件和验证

首批需要可读取的 summary，才能判断改动结果：新增管理员 `GET /api/admin/playback-quality?days=7`（范围上限 30 天），按日/版本/平台返回计数、首轮达成率、最终成功率、样本量、首帧 P50/P95。可以先提供 JSON 与聚合 SQL，不造仪表盘；若必须页面看，现有管理页加一张 summary 表即可。

计数通过条件 SUM/COUNT 与唯一 round 行聚合；分位数用有序样本的 nearest-rank（ceil(p×N)），在 D1 SQL 中按组计算或按组取对应 rank，避免把一个月原始样本全部拉入 Edge 内存。固定成功样本过滤与 frameEvidence 分组，附缺失/未观测数；N=0 返回 null，不写 0 毫秒。

| 影响文件（预计）                                                     | 最小变更                                                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/app/play/page.tsx`、`playback-attempt/reporter.ts/types.ts`     | 单次 mint、生命周期接入、首帧/切换结果，保留调试事件关联                                |
| `PlaybackPreparationProvider.tsx`、必要卡片入口                      | 只捕获/读取 launchTiming 与目标匹配，过渡 UI 不拥有 session/round、预算、换源或超时决策 |
| 新 `src/lib/playback-quality.ts` 与 `.client.ts`（可按实际规模合并） | 固定快照类型/纯更新规则、单调计时、低频发送；不增加泛化事件总线                         |
| 新 API 两条、D1 迁移、现有 cron、`next.config.js`                    | POST 存储/限额、admin summary、清理、构建版本                                           |
| 对应 policy/reporter/route/SQL 及现有播放测试                        | 复用 Jest，SQL 约束用真实 SQLite/D1 自检，不以 mock 证明原子性                          |

验证最低集合：单次换源仅一个 attempt；自动切源不重开 round；metadata 补齐不重开 session；首轮超预算后续试成功两指标分开；canplay 无首帧不成功；seek 旧帧/旧 timeout/旧 callback 不串源；paused/hidden/autoplay 限制不计有效等待；hidden 回页不放弃；取消/离页不等待网络；重复/倒序 seq 与终态保留；401/400/429/noD1；普通用户可采且非管理员不可查询；P50/P95 N=0/1/20 固定样例；老版本客户端不会被新服务端版本错误归因。

首批接受离页遥测可能丢失并展示未观测比例，不引入离线队列、推送、全量卡顿监控或大图表。

## 任务 1：接入与读取基线

- 新表迁移：[2026-10-26_playback_quality.sql](../../migrations/2026-10-26_playback_quality.sql)。上线时按项目现有 D1 迁移流程先应用该文件；无 D1 或缺表时上报返回 202，本次观看停止采集，播放照常。
- 上报入口：`POST /api/playback-quality`，普通有效登录会话可用；每包最多 4 条、16KiB，按账号限制新增记录。客户端低频发送 round/source 完整快照，不发送逐帧日志，不向普通用户显示调试入口。
- 管理员入口：`GET /api/admin/playback-quality?days=7`，天数 1–30；返回 `groups`（起播次数与成功率）、`latency`（按首帧证据分别给出 P50/P95）、`sources`（单源结果）。日期按 Asia/Taipei，非管理员无法查询。首批交付 JSON 汇总，不新增看板。
- `firstRoundWithin30Rate` 是基线中“首轮 30 秒有效等待内播出”的比例，当前没有强制 30 秒停止；超过 30 秒后成功仍记录成功样本。`budgetExhausted` 在后续任务启用预算前应为 0，不伪造政策结果。
- `finalSuccessRate` 按同次起播链归并用户重试；同时查看 `starts`、`completed`、`pending`、`unobserved`，不要把没有终态的记录当作失败。首次进入和切集按 `entryKind` 分组。
- 首帧证据 `rvfc` 与 `playhead` 分开统计；`canplay` 只维持旧线路记忆语义。时长中排除隐藏页面和用户暂停；明确的 NotAllowedError 单独标记，原生 autoplay 静默等待手势仅停止有效等待累计，不据此断言浏览器拒绝。
- 版本：Pages 使用构建时 `CF_PAGES_COMMIT_SHA`；CI Docker 构建传 `PLAYBACK_RELEASE_ID`。手动 Docker 构建使用 `--build-arg PLAYBACK_RELEASE_ID=<commit>`，也可显式配置 `NEXT_PUBLIC_PLAYBACK_RELEASE_ID`。标识追加 Pages 分支或 docker/local 部署维度，预览与主分支共享 D1 时不会合并同 SHA 的流量；手动部署可用 `NEXT_PUBLIC_PLAYBACK_DEPLOYMENT` 指定环境。缺失提交时以 `unknown@部署维度` 记录，不拿该分组作发版归因。
- 保留 30 天；现有鉴权 cron 每次限量清理 2000 条过期数据，需沿用项目 cron 调用安排。未配置定时调用的部署需自行安排清理，接口不会在每次观看时清表。
- SQL 自检：`python3 scripts/test-playback-quality-sql.py`，已接入现有 CI，执行真实 SQLite 的迁移、幂等、终态、跨日、分位数与并发额度检查。

该阶段不改变搜索等待、优选排序、单源超时或播放中恢复策略；真实线上基线要在部署并完成 D1 迁移后采集，不能从本地测试样本推导线上成功率。

## 任务 2：指定线路直接起播

- 明确 `source/id` 且无 `prefer=true` 时，详情、同剧搜索和历史读取并行。详情或同线路搜索结果先提供有效详情后，等待历史恢复信息即可加载媒体；`prefer=true` 和仅片名入口继续沿用聚合搜索与原有优选。
- 同剧候选按线路和资源 ID 去重，后台只补列表、状态和评分；不覆盖当前线路、集数、URL 或再次应用续播点。内部 URL 规范化保留搜索请求，真正换片或卸载取消旧请求并忽略旧结果。
- Session 接收带 discoveryId 的候选发现事件。首源失败但搜索尚未结束时暂缓候选耗尽；搜索结束后按当前意图和媒体尝试继续恢复。暂停、拖动、主动换线、切集或当前媒体已经就绪，都会使旧的延迟恢复失效。
- 历史源近期不可用、详情失败或缺目标集时等待同剧候选兜底；缺目标集且无对应候选时明确提示。非历史指定线路不会自动选为其他来源。已有线路在后台搜索或搜索失败时仍显示并可选择。
- 本版指标 `policyVersion=startup-direct-first-v1`，与 `startup-baseline-v1` 分组比较；沿用已有 D1 表，无新增迁移。单源 10 秒规则保留；整体 30 秒选择交互属于任务 3，本次未启用。
- 预览验收：通过指定线路或继续观看入口播放，检查搜索仍在进行时媒体已加载；待搜索完成后当前源与进度保持。管理员 summary 中按新 policyVersion 和对应提交的 releaseId 查看样本，分别比较 `rvfc`/`playhead`、入口与平台；单个样本只验证采集链路。
