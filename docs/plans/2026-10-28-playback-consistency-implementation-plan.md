# 播放一致性：技术设计与分阶段实施计划

日期：2026-10-28。状态：**待评审的实施方案，尚未实施**。本轮只创建计划，不修改业务、测试、CI、Hook 或远端保护，不提交、推送或部署。

## 1. 依据、范围与完成状态

产品语义以 [ADR 0009](../adr/0009-playback-user-operation-semantics.md) 为单一权威；验收流程沿用 [REVIEW.md](../../REVIEW.md)。本计划细化 [既有 Playback Session PRD](2026-06-18-playback-session-refactor-prd.md)，不重复建立规则体系；旧 PRD 中 native HLS 等历史背景以 [ADR 0006](../adr/0006-apple-playback-unified-on-hlsjs-mms.md) 为准。

设计基线为 `main@6252cb3ca85f23ff3386b569be1d92f6e95ea86a`。开始时已有 `M AGENTS.md`、未跟踪 `REVIEW.md`、ADR 0009 和 `output/`；这些均保留。生产部署 SHA、实际存储后端/版本和 authority 开关尚未核验，不从仓库配置推断生产环境。

审计明细暂存于 `/tmp/katelya-architecture-audit-20261028/REPORT.md`；临时文件可能被清理，因此关键依据在此保留：

| 已检查证据                                                         | 结论与边界                                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `downstream.ts:27/67/351` 原导出函数隔离验证                       | 重复 URL 搜索去重、详情保留；过滤无效条目会压缩位置。未证明客户源存在该数据                   |
| `page.tsx:6683` 原保存闭包隔离验证                                 | 旧保存完成可覆盖新集内存 snapshot；未验证后端历史因此错误                                     |
| `page.tsx:3430` 原历史采纳闭包验证                                 | 响应可跨暂停继续 seek，重建时改旧实例而非新实例                                               |
| `page.tsx:7261` 原 manifest 回调合成窗口                           | 旧 HLS 尚挂载且新 URL ref 已写时可标新 attempt manifestReady；真实事件窗口待验证              |
| `api/playrecords/route.ts:73–112` 原 POST + 原 merge、受控 mock DB | 两请求同读 300，依次写 500/400，最终 400、均 200；说明非原子合并缺口，不是生产数据库实测      |
| `api/cron/route.ts:207–243` 静态                                   | 刷新总集数时整行写回读取时的旧进度，绕过 POST merge；实际竞态待补测试                         |
| `reducer.ts:999–1037` 静态                                         | 恢复期间即使 confirmedUserGesture=true 也拒绝；页面分类另有门控                               |
| 仓库现有测试                                                       | 同业务 HEAD 曾全量 139 suites/1184 项通过；审计轮定向 6 suites/111 项通过。不是本计划执行结果 |

以上不等于客户 iOS 错集根因。**本计划所有任务、目标类型、协议和新增测试均未实现**；新语义的实质取舍见第 4 节，不能据本计划直接启用。

## 2. 复用与唯一责任边界

保持 Next/React、ArtPlayer、hls.js、现有 Session reducer、Source Availability、Watch Progress planner、DbManager/IStorage。先缩小副作用责任，再考虑文件组织，不引入新状态库。

| 责任                                    | 目标所有者                  | 原代码入口与最小迁移                                                               |
| --------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| 源内集序号与可播状态                    | downstream 规范化函数       | 搜索/详情共用；保留每组原始位置，不按 URL 去重、不过滤挪位；不跨源匹配剧情         |
| Playback Intent、恢复梯级、广告抑制状态 | Playback Session            | 保留现有 gate；明确 gesture 命令和 browser evidence；4 处页面领域 patch 逐一改事件 |
| 实际媒体实例、加载/seek 命令生命周期    | 窄媒体适配器                | 复用 sourceChangeMediaAttempt 与 adLoad generation；先迁移 manifest/canplay 路径   |
| 已封存采样、保存请求序号、响应归属      | 进度适配器                  | 从 page 保存/采纳闭包逐步收口，复用 progressMediaEpoch 和 rewind generation        |
| 跨设备操作接纳、版本、删除屏障          | 服务端进度服务+原子存储契约 | API 负责认证/schema，存储负责条件写；页面不能替跨设备解决并发                      |
| 标题/封面/总集数刷新                    | 元数据专用写方法            | cron 只 patch 获准字段，不携进度字段；与进度版本分离                               |
| React 展示、URL、toast                  | 页面投影                    | 不反向成为第二套播放策略；保留必要的即时 ref，但注明投影/命令归属                  |

### 2.1 源内序号：先兼容后演进

第一步保持当前 `episodes: string[]` 消费契约，重复 URL 保留；无效项可先用不可播空位维持长度。可选后续内部 `EpisodeSlot={ordinal,label,url|null,status}`，经兼容适配再供页面使用，不能一批改所有 API/UI。空位方案不是免检：统计“总集数”和“可播数”分离，所有 `.length`、`some(Boolean)`、首次选源、缺集判定都需审查；旧缓存要考虑 `SOURCE_DATA_VERSION`。

源 A 第二项换到源 B 第二项，即使内容不同也不设语义门槛。标签只展示，不按“特别篇”等重排。源只提供无编号紧凑列表时，无法凭空恢复未提供的集；记录此能力边界。目标源缺对应项时提示且不静默改集仍是待确认建议，不在修解析时顺带改变 fallback。

### 2.2 身份与版本：不要混用一种计数器

拟定只读值对象（字段名可在实现时调整）：

```text
MediaIdentity:
  playbackAttemptId, contentKey, episodeIndex, sourceKey,
  sourceAttemptId, playerGeneration, resolvedUrl
LocalIntent:
  intentVersion, explicitOperationId, kind
SeekOperation:
  seekId, mediaIdentity, intentVersion, reason(user/resume/recovery/ad/undo), target
SaveRequest:
  requestId, mediaIdentity, intentVersion, sampleSeq, capturedRecord
```

Playback Attempt 在同一标题观看期间可跨集/源，不要求每次换集都重建 session ID；其余复合身份区分具体媒体。值在发起操作时捕获，不能在回调里以“当前 ref”重建并冒充原身份。HLS 原始 URL 与 resolvedUrl 经明确映射比较，不能用新 expectedUrl 等于新 ref 替旧回调 URL 背书。

`intentVersion` 是本机明确意图代际，不是跨设备全局时钟。明确选集产生新播放意图；自动 seek/heartbeat 继承所属意图，不自增夺权。seeked 没有自带 seekId，适配器必须结合当前实例、挂起操作及观测目标判定，歧义时不得释放新操作的锁。

不同完成操作有不同规则：旧集保存允许持久化离开集的封存记录，但不得写新媒体内存快照；当前媒体同集较旧 save 完成也不得倒写较新 sample；历史读取采纳须复核实例/意图，并重新读当前时间，不能用请求开始时的时间决定跳转。

### 2.3 副作用执行

先列 effect 消费清单并测一次性与顺序：当前 dispatch 中的 onSwitchSource 主要记 quality，调用方另执行换源；saveProgress 由专用 runner 执行。迁移一个 effect 时同时移除旧消费者，不能新增通用 executor 后让旧调用者继续执行。异步 effect 具有身份/完成事件；取消意味着禁止迟到结果改新状态，不承诺已经发送的数据库写能撤回。

## 3. 跨设备进度：可实现的推荐方案（待确认）

### 3.1 无法从网络到达推断真实操作时间

没有可靠同步的两台设备可能离线操作、时钟漂移、网络乱序。server revision/CAS 保证写入不互相覆盖，却不能自动证明现实世界中哪个手势更晚；Lamport/HLC 也不能凭空产生未知因果关系。不能将“最后接受的请求”改名为“最新用户操作”。

推荐语义：**已知因果先后自动接纳；无法判定的并发/离线操作保留为冲突，由用户选择继续哪一端的位置**。保留当前已接受记录仅作为暂定服务端值，不能宣称它是现实最新；冲突时本地可继续播放，显示同步待确认，不强制跳动另一设备。是否接受该交互成本，需要用户确认。

不推荐仅取最大 play_time（新回拖会失败）、客户端 Date.now 最大（时钟偏差）、到达顺序 LWW（旧请求晚到夺权）。估算服务端时差可作为提示信息，但网络非对称/离线漂移下不是严格排序证明。

### 3.2 协议草案

作用域建议为“用户+contentKey”的操作头，指向当前集；每集保留封存进度。这样旧设备第 2 集 heartbeat 不能盖过另一端新选第 3 集的最新入口。作品之间独立，不用一个全账户计数器争抢播放权。

```text
UserOperation: operationId, deviceSessionId, deviceSeq,
  baseRevision, parentOperationId, deletionEpoch, kind, episodeIndex
ProgressSample: operationId, sampleSeq, media identity, playTime, totalTime
AcceptedHead: revision, operationId, deletionEpoch, episodeIndex
Result: accepted | duplicate | conflict | deleted | invalid,
  acceptedRecord, acceptedRevision, operationId
```

这是合同草图，不是已新增 schema/API：

1. 明确动作先于其采样建 operation：播放/暂停、完成的用户拖动、选集、手动换源。连续拖动过程可合并为一次完成动作；具体手势识别沿用现有控件入口，不能从所有 video 事件反推用户操作。广告/自动恢复/heartbeat 归属既有 operation；undo 是明确动作，但其进度含义单独测。
2. 在线客户端已观察 revision r 再操作，可提交`baseRevision=r`。服务端以 CAS 验证并接纳为 r+1；同设备队列按 deviceSeq/parent 链提交。丢序先补链或返回待同步，不靠时间戳重排。
3. 操作 ID 幂等；网络重试使用原 ID，返回其已接受结果。CAS 冲突后不能自动获取新版本重贴同一旧操作，把旧操作伪装成新动作。用户看过冲突后明确“继续这里”才能创建基于最新 revision 的新 operation。
4. 同一 operation 采样以 sampleSeq 接受新样本；新操作回拖可合法低于旧 play_time。旧 operation 的在途封存只能更新其被允许的离开集档案，不能修改 content head 或覆盖该集更新操作的记录。该路径需要独立授权/版本谓词，不能用普通 heartbeat 借道。
5. 两设备同 base 并发：至多一个 CAS 先接受，另一返回 conflict；先接受只是暂定值，**不证明它较新**。同设备多 tab 应视为不同 session，并发也走冲突，不能假定 localStorage 提供原子全局序号。
6. 接受记录由服务端返回，客户端按 request/intent 身份校准 cache；暂停期间不因校准自动 seek。显示同步状态与实际持久化状态分开。
7. clientOccurredAt/服务器时间可记录用于诊断/界面提示，不作为唯一胜负依据。sampleSeq 和版本不复用客户端毫秒时间。

### 3.3 离线、删除与兼容

- 离线保留 operation 链与采样，恢复联网时如果服务端仍是已知父版本，可顺序重放；另一设备已推进则返回冲突，不能自动 rebase。等待用户决策期间仍能本机播放，跨端状态不冒充已同步。
- 建议删除提升 content deletionEpoch；清空全部历史另有 user historyEpoch。旧 epoch 的 heartbeat/离线写被拒绝，重新观看须在观察删除后创建新 operation。墓碑不携带完整观看内容；保留期与离线队列最大寿命必须一起决定，否则过期墓碑会让旧记录复活。此删除语义待确认，不自定永久保存或天数。
- 当前 content-key/legacy 串行双写不具备版本关系。迁移后 legacy 应是同一 accepted revision 的投影，不能独立决定胜者；先让新服务端同时理解旧格式，再启用新客户端。
- **关键迁移风险**：旧客户端/cron/旧服务器若仍能无条件写新权威行，版本协议即被绕过。建议按用户或部署分批启用 v2：已启用作用域的无版本写不静默覆盖，返回需刷新/升级或隔离兼容记录；具体旧客户端体验需确认。旧数据作为 version0 导入，不能凭旧 save_time 伪造操作顺序。
- schema 先加字段/新表并保留旧读取；回滚优先停用新客户端功能但保留新服务端写保护，不能直接回滚到无条件写旧服务器并继续写同一数据。最终删除旧字段/开关是单独阶段。

## 4. 后端实现选择与决策点

当前 `IStorage` 只有 get/set/delete 等接口（`types.ts:85`），`DbManager:86–101`薄转发；API 先 get/merge/set，D1 无条件 UPSERT、Redis/Kvrocks/Upstash 先 SET 再更新 recent 索引。需要新增窄合同，建议 `applyProgressOperation`、`appendProgressSample`、`patchPlayRecordMetadata`、`deleteProgress`；不直接给所有调用方通用事务权限。

| 后端         | 可行方案比较                                                                                 | 推荐验证方向与限制                                                                                                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1           | 单 SQL 条件 UPDATE/UPSERT CAS；多个相关行可用 batch；不能把应用层 GET 后无条件写包装成“事务” | head、每集记录、operation 幂等结果的更新在一次条件化批次内；每个后续写都受接受凭证/operation 谓词约束，CAS 更新 0 行不是 SQL 异常，不能以 batch 回滚自动拦住后续无条件写。校验 changes 或返回行；同批读取 accepted 结果。先验证实际绑定 API 和本地类型 |
| Redis        | WATCH+GET+MULTI/EXEC CAS，或 Lua 在服务端完成比较/更新                                       | 优先评估短 Lua，一次处理 head/record/recent/幂等；WATCH 需独占连接与重试，不能共享连接串扰。脚本先验证输入/key 类型再写，运行时错误不等于自动回滚。集群 slot 及部署版本未查，不能假定跨 slot 可原子                                                    |
| Kvrocks      | 当前使用 Redis 客户端，候选 Lua 或 WATCH                                                     | 单独验证已部署版本/命令支持及持久化行为；不能因 Redis 协议兼容直接宣称同等语义                                                                                                                                                                         |
| Upstash      | HTTP SDK 的 EVAL 可选；MULTI/批处理本身不解决读后条件判断                                    | 以安装 SDK 与服务端支持为准验证 Lua 和 key 布局、幂等/超时重试；不假设有跨 HTTP 连接的 WATCH 会话                                                                                                                                                      |
| localstorage | 当前客户端直接写 JSON，无服务端跨设备同步                                                    | 不承诺跨设备协议；同浏览器多 tab 要独立定义协调能力。若需要原子本地队列可另评估 IndexedDB 事务，非本轮必做迁移，不能用 Promise 队列假装跨 tab 原子                                                                                                     |

D1 `batch` 的事务失败回滚语义参考[官方文档](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)；条件谓词是本方案推导，仍需真实合同测试。Redis WATCH 提供 CAS，Lua 可服务端原子执行，见[事务说明](https://redis.io/docs/latest/develop/using-commands/transactions/)和[脚本说明](https://redis.io/docs/latest/develop/programmability/eval-intro/)；[Upstash EVAL 接口](https://upstash.com/docs/redis/sdks/ts/commands/scripts/eval)提供候选实现。查询日期 2026-10-28，未创建远端数据库；这些能力不代表仓库已经使用或部署版本已验证。

元数据 cron 使用 UPDATE/字段 patch，只修改 title/cover/year/total_episodes 等明确字段，不修改 index/play_time/total_time/save_time/operation/version。metadata revision 可独立；row 已删除时不重新插入观看历史。Redis 也必须字段级原子 patch，不能读旧 JSON 后覆盖整个 JSON。

### 需要用户确认的实质取舍

- **跨端无法判先后时**：是否接受“保留冲突、本地继续、用户确认继续位置”，而非自动猜最新？这是推荐方案的前提，不改变已确认的最新操作目标。
- **删除/离线**：是否采用删除屏障，旧离线记录需明确重新观看才能重建？可接受的离线保留窗口决定墓碑清理策略。
- **旧客户端与后端支持**：v2 作用域是否可以要求旧页面刷新？需核验实际使用的后端，决定逐后端启用顺序；未通过合同测试的后端不宣称支持新协议。
- **缺集边界**：目标源缺同序号时提示并重选、不静默改集；仍是待确认建议。明确 undo 与普通回拖的抑制时序、跨源时间点比例映射另行细化，不阻塞首批快照修复。

## 5. 分阶段任务卡

每张卡都单独审查，不打包成大重写。所有状态均为“计划”；进入实现须有相应授权。缺陷回归先在隔离基线跑红，修复再绿；未修阶段的失败证据保存，不能以 skip 合入绿色假象。正常对照与原有测试必须保留。

### 第一批：回归底座 + 一处确定性边界修复

**T01：把 snapshot 乱序隔离证据落到现有 PlayPage 集成入口。**

- 范围：`src/app/play/page.test.tsx`；必要的测试辅助仅放测试目录。复用真实 reducer 默认 spy，不重写保存规则。
- 依赖：无产品待决；先校验当前 mock 的 player/video 时间和事件调度差异。
- 用例：第 N 集保存等待 → 切 N+1→ 新保存先完成 → 旧保存后完成 → 再次触发保存，从实际保存调用的集数/进度与去重行为断言旧结果不能污染新状态；同集 sample2 先完成/sample1 后完成另测。不能只断言私有 ref 数值。
- 风险：既有 debounce 可能遮住症状；必须选择可观察的后续行为，而非断言 mock 调用顺序等于正确性。若无法跨过原闭包边界，停止修复并记录入口缺口。
- 完成：旧代码有稳定红、正常顺序绿；证据说明 mock 存储和媒体边界。回滚：仅测试改动，可单独撤回；不改业务预期。

**T02：仅保护保存完成的本机 snapshot 归属/顺序。**

- 范围：`page.tsx`保存函数及必要的小型纯 helper；不改 API merge、content-key、源选择或用户产品语义。
- 依赖：T01 确实捕获问题。捕获完整目标身份与本机保存序号；离开集持久化可以完成，但当前 snapshot 只接受匹配身份且不旧于已应用序号的完成。保持 rewind generation 原有保护。
- 验收：T01 红 → 绿；同集完成乱序、切集封存、回拖标志不被旧完成清除、正常 heartbeat/暂停/退出保存保持。定向 page/lifecycle/save-policy 与类型/静态通过，PR 前全量和适用构建。
- 风险/回滚：不能用“不是当前集就不发送保存”丢掉离开集记录；只回滚完成保护 helper 和接线，不变存储格式。完成条件为所有上述证据可复现，**不是宣布客户错集已修复**。

首批止于 T01/T02；如 T01 无法构成可靠红，不自动扩大至全播放器重构。与跨设备排序无关，可先做。

### 后续确定性修复

**T03：统一源内集序号解析。**

- 范围：downstream、types 兼容层、source-query 缓存版本、已有 downstream/page/source availability 测试；列出 episodes 消费者后限小批改。
- 依赖：确认空位兼容策略；缺集交互待决不暗改。风险为总集数、初始可播项、搜索 movie/tv 判定受空位影响。
- 验收：正常[A,B,C]、重复[A,A,C]、无效[A,空,C]、多播放组搜索/详情一致；两种返回顺序同 index 同 URL；换源第 2 项仍第 2 项；原优选/历史 fallback 不退化。
- 回滚/完成：保持旧响应类型兼容；缓存版本需随兼容回滚评估。消费者矩阵全部明确，不以函数测试代替页面联动。

**T04：cron 只更新元数据。**

- 范围：IStorage/DbManager、cron、各实际支持后端新增 patch 方法与合同测试；不得先用旧整行 set 实现 patch 外壳。
- 依赖：先核验部署后端；风险为缺行创建和 recent 索引误刷新。
- 验收：cron 读旧进度 → 用户写新进度 → 详情返回，进度不变而集数更新；删除后不复活；封面/总集数正常更新；至少目标真实测试后端通过。
- 回滚/完成：新增窄方法不改历史格式；保持兼容部署顺序。生产启用前所有启用后端有实现，不能退回危险整行覆盖以“兼容”。

### 渐进控制层

**T05：媒体身份 token 先覆盖 ready 事件。**

- 范围：page setup/manifest/finalize/canplay/playing 及窄媒体 helper，沿用 ad load generation 模式。
- 依赖：扩展现有晚 manifest/旧 canplay 测试，先证明旧 HLS 尚挂载窗口可达；只合成可达则保持疑点，先做表征。
- 验收：旧 URL 回调、新 URL 相同源重建、切集、duration 未就绪、正确早 canplay+晚 manifest；旧事件不能 ready 新集，正常起播不被误拒。
- 风险/回滚：resolved URL 映射与当前 policy 一致；每次迁移一种事件，不能一次替全部媒体生命周期。无存储迁移，可按路径回退。

**T06：显式手势与系统 seek 分流，落实广告回拖。**

- 范围：控件/TV 入口、page seeking 适配、Session 事件/gate、广告窗口抑制及测试；不改广告候选信任阈值。
- 依赖：T05 身份边界；核对真实拖动入口，undo 交叉预期细化。风险：放开模糊 seeking 会重启 ratchet，标记过早会把自动 seek 当用户。
- 验收：恢复中真实回拖能接管，自动 seeking 不重置逃逸预算；暂停后选集新播放且 autoplay 拒绝可点击恢复；广告跳过后主动回拖再检测跳过，无无限 seek；undo 独立；真 iOS 手势抽测。
- 回滚/完成：入口与 reducer 门控配套回滚，保留新语义测试证据；不删除 legacy authority 开关直到支持矩阵明确。

**T07：副作用唯一执行与领域 patch 收口。**

- 范围：Session adapter-effects、page 调用者，逐个 switchSource/saveProgress；再改 page 的 4 处领域 patch。
- 依赖：消费次数/顺序测试，T05/T06 相关保护不退化。
- 验收：每个 effect 恰被授权 executor 消费一次；换源与保存顺序保持；过期完成无效；纯核心无 DOM/network/DB 依赖。
- 风险/回滚：同步改异步可能改变行为；按 effect 拆卡，保留旧接口适配到新 executor，不能新旧同时执行。完成后才考虑定向 lint 导入限制，启用需另审。

### 跨端协议与真实持久化

**T08：先冻结协议与后端合同，再实现。**

- 范围：第 3/4 节转为评审通过的协议 schema；候选后端能力小实验只用隔离服务。依赖：用户确认并发/离线/删除/旧客户端取舍，核验实际后端。
- 验收：操作图、冲突表、幂等/删除/双写迁移用例有唯一预期；D1 CAS 不匹配 0 行时后续写不误执行，Redis 索引与记录一致；明确无法判断真实先后的例子。
- 风险/回滚：CAS≠ 最新操作，不能按到达顺序自动重试夺权；设计未通过就不实施 v2。实验数据可删，无生产迁移。

**T09：分后端落地原子契约与兼容迁移。**

- 范围：IStorage/DbManager、API schema、实际后端、迁移、db.client accepted record 与离线队列；一个后端一个实施切片。
- 依赖：T08、T04；风险：旧 writer 绕过、客户端时间、双写部分成功、删除后复活。
- 验收：同 base 并发返回明确 conflict；因果后继回拖合法；重复请求无重复生效；旧 op 采样不能夺 head；离线/删除/重试/响应丢失；真实后端合同与旧格式读兼容。另测不同 episode 的归档不改变当前 head。
- 回滚/完成：先 schema/API 兼容再客户端再启用，备份与试迁移；停写或保留 v2 保护才能回退，不能无条件降级旧 writer。每个启用后端须真实合约通过，未支持的明确提示，不能静默冒充同步成功。

### 真实媒体闭环与发布门禁

**T10：受控 HLS + 隔离真实历史闭环。** 设计见第 6 节；范围测试夹具/浏览器 harness/隔离启动配置。依赖可先搭底座，业务断言随 T03/T05/T09 逐步加入。验收 UI/session/解码内容/持久化四侧一致；风险是 mock 泄漏与媒体平台差异；回滚仅测试设施，不能用删断言解决波动。完成需运行证据而非只有媒体文件存在。

**T11：统一质量 gate 与产物 smoke 提案。** 范围为未来工作流/工具版本，先设计不启用。依赖测试稳定与用户另行批准；见第 7 节。验收失败检查阻止所有发布路径、相同 SHA、两种产物启动冒烟；回滚每次一个 workflow/required rule，业务改造不混批。远端保护、发布凭证与 hook 安装都需单独确认。

## 6. 真实测试设施设计

### 媒体

复用 `public/tv-test/hls` 与现有 TV 测试页经验，新增测试专用三集短素材：自生成色块/几何动画、画面内集序号和运行时间码、可选合成音调，不下载影视片段或依赖外部有版权素材。生成脚本、编码参数、片长/分片长度、工具版本、哈希和素材来源说明同存；当前资源是否已有时间码需先解码确认，不声称从零起步。

源 A/B 各有同序号不同颜色内容，验证用户允许的内容差异；另提供重复 URL、无效槽、manifest 晚返回、分片 404、结构化广告测试窗口。只按集序号切换；图像断言读取实际视频帧中的序号/编码色块，不能只看 UI 或请求 URL。时间码容差依据帧率/分片和 seek 行为设置，不硬断言浮点完全相等。

### 网络与事件

浏览器请求拦截按 requestId/barrier 释放搜索、详情、GET/POST、manifest/分片，不靠 sleep 猜时序；用两 context 模拟设备，保存同基线请求并人为反转完成。旧 canplay/playing/HLS 实例回调在组件集成层可控注入；浏览器层必须说明哪些事件由真实引擎产生、哪些是注入，不能将合成事件当 MMS 锁屏证据。

### 真实历史后端

先核验部署后端。D1 合同使用独立临时目录的本地 D1 兼容运行环境及实际迁移 SQL；Python sqlite 单测只作 SQL 辅助，不等价 D1 绑定。Redis/Kvrocks 用本地隔离实例/容器和随机测试命名空间；Upstash 需独立测试实例/凭证另行授权，普通 Redis 模拟不能证明其 HTTP 重试语义。不得读取/覆写生产 bindings 或共享广告数据。

启动真实 Next/API 和实际存储 adapter，只有下游采集源/媒体地址受控；至少一条 page→POST→ 持久化 → 新 context GET 链不 mock db.client 或 DbManager。运行前写明测试用户/数据前缀，退出清理所建数据/进程，失败保留脱敏日志且列清理结果。

### 平台与诊断

Chromium 用于基础真实解码闭环，WebKit 用于浏览器差异抽测；二者不替代真 iOS 的 MMS、锁屏、后台/前台、系统暂停。iOS 每次记录硬件/OS/浏览器、部署 SHA、操作步骤和 media/intent token；因 WebKit 桌面通过不能标 iOS 通过。复用 playback-attempt/quality/debug 关联 ID，新增字段不写 token/password 或私人内容。

## 7. 拟定发布 gate（未启用）

现有 `docker-build.yml` checks→build，独立 `docker-image.yml`发布不依赖同套 checks，release 使用另一套 Node/pnpm；Dockerfile 还将 edge 改 nodejs。因此建议：

1. 复用一个无发布权限的 checks 工作流/可复用 job，绑定相同提交 SHA：现有`pnpm check:ci`、播放质量 SQL、稳定合同测试；固定 packageManager 和运行时版本。
2. PR 执行相应 Docker/Pages 构建与启动/API smoke；branch/tag 发布必须显式依赖同 SHA checks 和产物验证，不能只依赖另一个 workflow“通常会跑”。复用 artifact 时核验 SHA/digest。
3. 真实浏览器媒体测试先观察稳定性再成为 required；真机手工验收用证据记录，不伪装自动 job。没有测试环境则明确阻塞。
4. 纯文档路径过滤与 required job 需共同设计：若 required check 根本不触发可能使 PR 挂起；采用始终报告结果的总 gate，按影响面标适用范围，不能把取消/未运行当通过。
5. 现有 Hook 保留辅助角色；不安装新 hook、不改远端保护。真正的 required checks/rulesets 与发布权限配置另行确认后执行，当前不声称任何新 gate 生效。

## 8. 执行记录与计划维护

本计划编写只读核验代码、审计、规范与官方后端文档，并做文档格式/链接/diff 检查；未运行新增业务测试、未验证真实后端能力、未生成媒体或启用 CI。上述历史测试计数不代表任何任务已完成。

实施时每卡附完整 HEAD+dirty 补丁标识、命令/范围、旧版红/修复绿、mock 边界、实际后端/平台、失败与未执行项、数据清理、回滚条件；复用 REVIEW 模板，不再建另一套验收制度。当前可用命令仍为 package.json 中的 typecheck/lint:strict/test:ci/build/pages:build；新 harness 命令须实现后才登记，不能预写成已可执行。

后续顺序：先确认是否执行 T01/T02；跨端实质取舍不阻塞首批，但 T08/T09 启用前必须解决。任何发现无法复现或会扩大产品行为的任务，停在证据/设计边界重新评审。
