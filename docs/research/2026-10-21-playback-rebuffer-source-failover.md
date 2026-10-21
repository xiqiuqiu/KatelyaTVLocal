# 播放过慢与多源切换：生产播放器实际怎么判定

访问日期：2026-10-21

## Question

生产播放器和一手文档如何判定「播得太慢 / 重缓冲太频繁」，以及如何因此切换？尤其当备选不是同一 CDN 的多码率，而是不同源站时。

本文只记一手材料里写明的阈值和行为。本仓库现有的 4 秒 `waiting`、同片源重试、前跳分片、稳定后再探测，只作为问题背景，不作为行业做法的依据。

## Short answer

没有一手材料规定「重缓冲占比超过 X 就换源」。重缓冲占比、卡顿次数、卡顿频率是 Mux、Conviva、DASH-IF 用来度量的指标，不是播放器的切换条件。

播放器自己做的是更窄的事：

- 播头停住约 1–1.25 秒，先当作一次卡顿，然后在已缓冲区间内前跳 0.1 秒量级，而不是换地址。hls.js 1.6.16 / 1.7.3 的 `detectStallWithCurrentTimeMs` 是 1250；Shaka 5.3.0 的 `stallThreshold` 是 1 秒。
- 前向缓冲还够用时，不因当前分片偏慢而降级。hls.js 只在「剩余加载时间大于剩余缓冲」时才中止并降到更低码率。
- 换的是同一清单里的 rendition、track 或 Pathway。Media3 对 403/404/410/416/500/503 先排除 location 5 分钟，没有 location 才排除 track 60 秒。Content Steering 也是当前 Pathway 的 URI 全部网络失败，或最低码率都喂不饱实时播放时，才 MAY 惩罚该 Pathway。
- 慢但还在走的播放不会积累成切换。hls.js 只要 `currentTime` 变化就清零 nudge 计数；Shaka 只要播放进度变化就清零 stall 尝试次数。
- 没有一手文档写「播放中探测备用 URL 会抢走带宽所以禁止」。最接近的约束是：HLS 客户端 SHOULD NOT 重载当前没在播的 Variant / Rendition 清单；Content Steering 上报的吞吐只描述当前 Pathway。

## Findings

版本：hls.js 取 2026-10-21 的 `master`（GitHub latest 为 v1.7.3），并核对过本仓库安装的 v1.6.16，下文列出的默认值一致。Shaka 为 `main` 的 5.3.0。Media3 与 dash.js 取各仓库 `release` / `development` 当日源码。

### 1. hls.js：卡顿是播头不动，恢复手段是洞跳和 nudge

`GapController` 每 100ms 看一次 `currentTime`。时间变了，且不在 seek，就把 `skipRetry` 和 `nudgeRetry` 清零；若没有 `waiting`，再发 `STALL_RESOLVED`。暂停、结束、`playbackRate === 0` 同样清零。因此每隔一两秒仍能前进的播放，不会积累成一次 stall。

第一次发现时间没动，只记下 `performance.now()` 并返回。之后若静止达到 `detectStallWithCurrentTimeMs`（默认 **1250ms**），或已经发生过 `waiting` 且此前播头动过，才调用 `_reportStall`。该事件是**非致命** `BUFFER_STALLED_ERROR`，每个 stall 周期只发一次，载荷里的 `buffer` 是当时前向缓冲秒数。

真正改播放位置要再等 `highBufferWatchdogPeriod`（默认 **2 秒**）或已有 `waiting`，并且洞小于 `maxBufferHole`（默认 **0.1 秒**），或相邻分片序号差小于 2。然后：

- 跳洞：`currentTime` 拨到洞后沿加 `skipBufferHolePadding`（0.1 秒）。`skipRetry` 超过 `nudgeMaxRetry`（默认 **3**）后，发致命 `BUFFER_SEEK_OVER_HOLE`。
- nudge：第 n 次前跳 `(n+1) * nudgeOffset`，`nudgeOffset` 默认 **0.1 秒**。前几次是非致命 `BUFFER_NUDGE_ON_STALL`；达到 `nudgeMaxRetry` 后发致命 `BUFFER_STALLED_ERROR`，文案是播头在「已有足够数据」时仍不动。

起播洞另有硬编码 `MAX_START_GAP_JUMP = 2.0` 秒（直播为 2 个 target duration）。这是起播，不是播放中的换源条件。

`docs/design.md` 仍写 `BUFFER_NUDGE_ON_STALL` 为「卡住超过 1 秒」和「前向缓冲不足 500ms」。当前 `gap-controller.ts` 的报告阈值是 1250ms，nudge 等待的是 `highBufferWatchdogPeriod`。以源码为准。

来源：

- https://github.com/video-dev/hls.js/blob/v1.7.3/src/controller/gap-controller.ts
- https://github.com/video-dev/hls.js/blob/v1.7.3/src/config.ts （`hlsDefaultConfig`；v1.6.16 同值）
- https://github.com/video-dev/hls.js/blob/master/docs/API.md （`detectStallWithCurrentTimeMs`：媒体 `waiting` 在起播和 seek 之外立即算 stall，该计时器只覆盖没发出 `waiting` 的情况）

### 2. hls.js：分片太慢只降码率，且仅当缓冲快被耗尽

`AbrController._abandonRulesCheck` 每 100ms 看当前分片。它先等到已加载超过 `max(TTFB 估计, 分片时长 / (2 * playbackRate))`，避免刚开始下就判慢。然后：

- `bufferStarvationDelay = 前向缓冲秒数 / playbackRate`
- `fragLoadedDelay` 为按当前速率估的剩余加载时间
- 仅当 `fragLoadedDelay > bufferStarvationDelay` 才继续
- 再找一个更低 level，其预计加载时间要小于当前分片的剩余加载时间，且小于 `min(剩余缓冲, 分片时长 + TTFB)`，并且不超过分片时长的 10 倍
- 满足后设置 `nextAutoLevel`，发 `FRAG_LOAD_EMERGENCY_ABORTED`。若预计慢到两倍以上，立即 `abortRequests()`；否则再等一个「低档预计加载时间」后才中止

已经在最低自动档、ABR 关闭、暂停、或缓冲还够，都直接返回。这是同一清单内的降档，不是换源站。

选档还受 `maxStarvationDelay` 与 `maxLoadingDelay` 约束，二者默认都是 **4 秒**：没有不卡顿的档时，选预计卡顿短于 4 秒的档；起播时最低档首片加目标档一片的时间也要低于 4 秒。带宽是快、慢两个 EWMA 的较小值，半生命默认 VoD/直播都是 3 秒和 9 秒；尚无样本时 `abrEwmaDefaultEstimate` 为 **500 kbps**，上限 **5 Mbps**。

`fragLoadPolicy.default`（1.6.16 与 1.7.3 相同）：首字节 **10 秒**，整片 **120 秒**；超时重试 4 次、延迟 0；错误重试 6 次，基础延迟 1 秒，上限 8 秒。API 文档写明：重试耗尽后可以换 level 或 Pathway；若因此发生 stall，可以在重试用完之前就换 level。

来源：

- https://github.com/video-dev/hls.js/blob/v1.7.3/src/controller/abr-controller.ts
- https://github.com/video-dev/hls.js/blob/v1.6.16/src/config.ts
- https://github.com/video-dev/hls.js/blob/master/docs/API.md （`maxStarvationDelay`、`maxLoadingDelay`、`fragLoadPolicy`）

### 3. hls.js 与 HLS 规范：换 Pathway 由失败触发，并有惩罚期

v1.7.3 的 `ContentSteeringController` 在错误动作为 `SendAlternateToPenaltyBox` 且带 `MoveAllAlternatesMatchingHost` 时，把该 Pathway 记入 `penalizedPathways`。`PATHWAY_PENALTY_DURATION_MS = 300000`（**5 分钟**）。更新优先级时跳过仍在惩罚期内的 Pathway；若没有可换的，留在当前 Pathway。

规范侧（仍是草案）：

- `draft-pantos-content-steering-05`（2026-05-18）第 7 节：当前 Pathway 的 URI 全部网络失败，或最低码率（或其组合）下载不够快、无法支撑实时使用时，客户端 **MAY** 将该 Pathway 标为 penalized。惩罚够久、可能已恢复时 **SHOULD** 取消惩罚。时长 **MAY** 由内容交付协议规定，否则由客户端定。草案没有规定秒数。
- `draft-pantos-hls-rfc8216bis-22`（2026-05-01）第 7.5 节：「Content Steering does not specify how long a Pathway should be penalized. For HLS, a two minute penalization period is generally enough time for most Pathways to recover from a brief outage while allowing reasonably timely recovery.」这是建议，不是必须。hls.js 实现用的是 5 分钟，不是这两分钟。
- 同草案第 7.4 节：客户端 SHOULD 在 Steering Manifest 请求上带 `_HLS_throughput`，其含义是「对当前已应用 Pathway 的下载吞吐预测」。没有要求去测其他 Pathway。
- 同草案第 6.3.4 节：「In order to reduce server load, the client SHOULD NOT reload the Playlist files of Variant Streams or alternate Renditions that are not currently being played.」理由写的是服务器负载，不是客户端带宽。切换时停止重载旧清单、开始加载新清单。

没有查到一手条文写「播放过程中探测备用 URL 会偷走播放带宽，所以禁止」。WWDC 转述和第三方多 CDN 文章不作为依据。

来源：

- https://github.com/video-dev/hls.js/blob/v1.7.3/src/controller/content-steering-controller.ts
- https://www.ietf.org/archive/id/draft-pantos-content-steering-05.txt
- https://www.ietf.org/archive/id/draft-pantos-hls-rfc8216bis-22.txt （第 6.3.4、7.4、7.5 节）

### 4. Shaka Player 5.3.0：缓冲目标与卡顿检测是两套机制

`lib/util/player_configuration.js` 的 streaming 默认值：

| 字段                    | 默认    | 作用                              |
| ----------------------- | ------- | --------------------------------- |
| `rebufferingGoal`       | 0 秒    | 从饥饿恢复前要重新攒够的前向缓冲  |
| `bufferingGoal`         | 10 秒   | 播放中试图保持的前向缓冲          |
| `bufferBehind`          | 30 秒   | 播头后方保留                      |
| `stallEnabled`          | true    | 是否启用 stall 检测               |
| `stallThreshold`        | 1 秒    | 播头不变多久算一次 stall          |
| `stallSkip`             | 0.1 秒  | stall 时前跳；0 则改为 pause/play |
| `gapDetectionThreshold` | 0.5 秒  | 洞检测                            |
| `gapJumpTimerTime`      | 0.25 秒 | 轮询周期                          |

`rebufferingGoal === 0` 时不做 0.25 秒缓冲轮询，只靠 `waiting`、`playing`、`canplaythrough`、`timeupdate` 等媒体事件。官方网络与缓冲文档把 `rebufferingGoal` 举例为 15、`bufferingGoal` 举例为 30，并写明前者应小于后者；那是示例，不是默认值。

`BufferingObserver` 有滞回：正在饥饿时，要攒到 `rebufferingGoal` 才算满足；已经满足时，前向缓冲掉到 `min(0.5, rebufferingGoal / 2)` 以下才重新算饥饿。默认 `rebufferingGoal` 为 0，因此这条缓冲比较实际上不驱动状态，状态来自媒体事件。`timeupdate` 只有当 `currentTime` 增加超过 **0.01 秒** 才把状态拉回满足。

`StallDetector` 与缓冲判断分开，并且由 gap controller 先调用，以免两边同时拨 `currentTime`。播放进度或「是否应该在动」发生变化就清零。静止达到 `stallThreshold` 且应当在播放时，触发一次；之后每次至少再隔一个 threshold，最多再试 `MAX_STALL_RETRIES = 2` 次（连首次共 3 次）。回调里若缓冲为空则什么也不做；否则前跳 `stallSkip`。只有第一次尝试计入 `stallsDetected` 并发 `stalldetected`。注释写明：不是所有 stall 都由缓冲洞引起。

网络重试默认（`Backoff.defaultRetryParameters`）：`maxAttempts` 2、`baseDelay` 1000ms、`backoffFactor` 2、`fuzzFactor` 0.5、整请求 `timeout` 30 秒、`connectionTimeout` 10 秒、`stallTimeout` 5 秒。`stallTimeout` 是下载进度停滞那么久就 abort 该请求，不是播头卡顿。进度事件会把这个计时器往后推。

来源：

- https://github.com/shaka-project/shaka-player/blob/v5.3.0/lib/util/player_configuration.js （标签若尚不存在，同内容在访问日的 `main`；`package.json` version 为 5.3.0）
- https://github.com/shaka-project/shaka-player/blob/main/lib/media/gap_jumping_controller.js （`StallDetector`、`MAX_STALL_RETRIES`）
- https://github.com/shaka-project/shaka-player/blob/main/lib/media/buffering_observer.js
- https://github.com/shaka-project/shaka-player/blob/main/lib/player.js （`updateBufferingSettings_`、`TYPICAL_BUFFERING_THRESHOLD_ = 0.5`、轮询 0.25 秒）
- https://github.com/shaka-project/shaka-player/blob/main/lib/net/backoff.js
- https://github.com/shaka-project/shaka-player/blob/main/lib/net/networking_engine.js
- https://github.com/shaka-project/shaka-player/blob/main/docs/tutorials/network-and-buffering-config.md

### 5. Media3 ExoPlayer：先重试，再排除 location，再排除 track

`DefaultLoadControl`（`@UnstableApi`）默认：

- 最小/最大缓冲都是 **50 秒**（`DEFAULT_MIN_BUFFER_MS`、`DEFAULT_MAX_BUFFER_MS`）
- 起播或用户 seek 后恢复：**1000ms**（`DEFAULT_BUFFER_FOR_PLAYBACK_MS`）
- 因缓冲耗尽而 rebuffer 之后恢复：**2000ms**。注释写明 rebuffer 指缓冲耗尽，不是用户操作
- 本地播放的对应 rebuffer 恢复值是 1000ms
- 后向缓冲默认 **0**

`DefaultLoadErrorHandlingPolicy`：

- 可重试错误的延迟是 `min((errorCount - 1) * 1000, 5000)` 毫秒
- 至少重试 `DEFAULT_MIN_LOADABLE_RETRY_COUNT = 3` 次（progressive live 为 6）后才把错误抛出
- 解析错误、404 文件类、明文不被允许等直接不重试
- **只有 HTTP 403、404、410、416、500、503** 才有资格 fallback
- 未启用 location steering 时，优先 `FALLBACK_TYPE_LOCATION`，排除 **5 分钟**（`DEFAULT_LOCATION_EXCLUSION_MS`）；没有备用 location 才 `FALLBACK_TYPE_TRACK`，排除 **60 秒**
- location steering 已激活时顺序反过来，先 track 后 location

这是「这个地址返回了这些状态码」才换位置，不是「播着播着卡」就换。慢请求本身走重试延迟，不走 location 排除。

直播掉出窗口是另一条路径。`DefaultLivePlaybackSpeedControl` 每次 rebuffer 把目标直播偏移增加 `DEFAULT_TARGET_LIVE_OFFSET_INCREMENT_ON_REBUFFER_MS = 500`。官方直播文档说：rebuffer 时略放慢播放以离开直播沿；网络恢复后再加快回到目标偏移。若暂停或缓冲太久，位置落到直播窗口之外，报 `ERROR_CODE_BEHIND_LIVE_WINDOW`，应用应 `seekToDefaultPosition()` 再 `prepare()`。这是回到当前直播窗口，不是换源。

来源：

- https://github.com/androidx/media/blob/release/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/DefaultLoadControl.java
- https://github.com/androidx/media/blob/release/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/upstream/DefaultLoadErrorHandlingPolicy.java
- https://github.com/androidx/media/blob/release/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/DefaultLivePlaybackSpeedControl.java
- https://developer.android.com/media/media3/exoplayer/live-streaming

### 6. dash.js：缓冲低于 0.3 秒算空，不是占比

`development` 的 `streaming.buffer`：

- `stallThreshold` 与 `lowLatencyStallThreshold` 都是 **0.3 秒**
- `bufferTimeDefault` **18 秒**，最高质量 **30 秒**，长内容（≥ 600 秒）在最高质量 **60 秒**
- `setStallState` 默认 true：到达 stall 阈值就发手动 `waiting`
- `syntheticStallEvents.enabled` 默认 false

`BufferController.checkIfSufficientBuffer`：音视频的 `bufferLevel <= stallThreshold` 且缓冲未完成，则 `BUFFER_EMPTY`；完成或 `bufferLevel > stallThreshold` 则 `BUFFER_LOADED`。`getTime() === 0` 时不发 `BUFFER_EMPTY`，注释为初始加载。

`streaming.gaps`：`threshold` 0.3 秒，`smallGapLimit` 1.5 秒，`enableStallFix` 默认 **false**，打开后 `stallSeek` 为 0.1 秒。洞跳默认开，缓冲区内的 stall 前跳默认关。

dash.js 没有名为 rebuffer ratio 的设置，也没有「占比超过某值换 representation」的阈值。

来源：

- https://github.com/Dash-Industry-Forum/dash.js/blob/development/src/core/Settings.js
- https://github.com/Dash-Industry-Forum/dash.js/blob/development/src/streaming/controllers/BufferController.js

### 7. 一手 QoE 指标：它们度量卡顿，不规定切换

DASH-IF 立场文件 _Proposed QoE Media Metrics standardization for segmented media playback_（r12，访问日从 dashif.org 取到的 PDF）定义：

- 一次 rebuffer 是音或画因前向缓冲不足而停止。500ms 与 5 秒各算 1 次。必须先在播再停下；只计开始，不计持续时长。
- `rebufferCount` 是窗口内 `rebufferStart` 之差。
- `rebufferRate = (c2 - c1) / (t2 - t1)`，t 是观看时间。例：5 分钟内 4 次，`rebufferRate_300 = 4/300 = 0.0133` 次/秒。
- `rebufferPercentage` 是同一文件中的下一项，用重缓冲时长占观看时间。文件是提案，不是播放器规范，没有切换阈值。

CTA-2066（_Streaming Quality of Experience Events, Properties and Metrics_，2020-03）公开页只说明它定义事件、属性和指标。正文在 CTA 商店，非会员付费。本次没有读到正文，因此不引用它的任何公式。https://www.cta.tech/standards/cta-2066/

Mux Data 的 Smoothness 文档：

- Rebuffer Percentage = 各次观看的重缓冲时长之和 / 观看时间之和，分母包含重缓冲本身。Seek 造成的等待另计为 Seek Latency，不进这个比例。
- Rebuffer Duration 是单次观看的重缓冲秒数。文档明确说更长的片子有更多机会卡，所以比较时百分比比绝对时长公平。
- Rebuffer Frequency 用来抓住「每次卡很短、但反复停」的情况，时间占比会把它漏掉。
- Smoothness Score 是两条曲线的算术平均：`100 / sqrt(1 + (rebuffer_count / 2)^2)` 与 `100 * exp(-10 * rebuffer_percentage)`。一次短暂卡顿掉分不多；占比从第一个百分点起掉得很快。文档把这些当评分形状，并写了「比较播放器和 CDN」的用途，没有给出切换 CDN 的数值。

Conviva Rebuffering Ratio（文档更新 2026-09-02）：重缓冲时间 / 观看时间，观看时间 = 播放时间 + 重缓冲时间。包含 seek 与非 seek 卡顿；不含首帧前的缓冲，不含暂停。连续超过 **90 秒** 的卡顿被丢掉（避免播放器卡死在 buffering 状态污染指标）；短于 **200ms** 的连续卡顿不丢。这是统计口径，不是播放器动作。

来源：

- https://dashif.org/docs/ProposedMediaMetricsforSegmentedMediaDelivery-r12.pdf
- https://www.mux.com/docs/guides/data-smoothness-metric
- https://docs.conviva.ai/sei/video/metric-dictionary/rebuffering-ratio/

## What is NOT established

- 不存在「重缓冲占比超过 X% 就切换源」的一手阈值。Mux、Conviva、DASH-IF 都只定义怎么算。
- 不存在「卡 N 次就换源」的一手规则。Shaka 的 3 次、hls.js 的 `nudgeMaxRetry = 3` 都是同一次卡顿里的前跳次数，用尽后升级为致命错误或停止再试，由应用决定下一步。
- Content Steering 的两分钟是 HLS 草案对「短暂故障后何时取消惩罚」的建议。它不是「卡两分钟再换」，也不是 hls.js 的实现（实现是 5 分钟）。草案本身没有把惩罚时长写成必须。
- Media3 的 location 排除只覆盖列出的 HTTP 状态码，不覆盖超时或吞吐下降。不能把它读成「慢就换 CDN」。
- `docs/design.md` 里「前向不足 500ms」「卡住超过 1 秒」与当前 gap controller 不一致。旧文档里的「失败后换 CDN」也没有对应到当前默认配置的一个数字。
- 没有一手文档写明：播放中对备用源做可用性探测会抢走当前流的带宽，因此必须禁止。HLS 只要求不要重载没在播的清单，理由是服务器负载；吞吐上报只描述当前 Pathway。
- CTA-2066 正文未读到。Bitmovin 本次没有找到带具体卡顿数字的一手页面，故不引用。
- 上述播放器的「换」都假设备选是同一节目的另一 rendition、另一 BaseURL/location 或另一 Pathway，时间轴可对齐。它们没有描述「另一站点的另一份成片，分片边界和进度都对不上」时如何失败转移。

## Implications for a multi-origin player

以下是对本仓库这种「多站点、非多码率」播放器的解读，不是上面任一文档的要求。

1. 只等一次硬卡顿，和这些播放器一致的部分是：它们也不把「还在慢慢走」当成切换信号。不一致的部分是：它们在同一次停滞里会先做 0.1 秒量级的前跳，并且用前向缓冲秒数决定要不要动（hls.js 降档要剩余加载时间大于剩余缓冲；dash.js 在缓冲低于 0.3 秒时进入空缓冲）。前向缓冲健康时继续等，是有出处的；「播头只要偶尔前进就永远不换」也是这些状态机的直接结果，不是它们有意容忍长时间低吞吐。
2. 若要识别「每 1–2 秒挤出一点进度」的源，一手指标里对应的是 Mux 单独列出的 Rebuffer Frequency，以及 DASH-IF 的 `rebufferRate`（次数 / 观看时间），而不是再拉长单次 `waiting` 计时。次数必须按「先在播、再停下」计，DASH-IF 明确 500ms 与 5 秒同算一次；Conviva 则把短于 200ms 的也留下、把长于 90 秒的整段丢掉。这些数字是统计口径，挪来当切换阈值没有出处。
3. 换源条件若做成「当前源已经喂不饱实时播放」，对应的规范语言是 Content Steering 的「最低码率仍无法支撑实时使用」，以及 hls.js 的「剩余加载时间大于剩余缓冲」。两者都先看当前流自己的缓冲跑道，而不是先看备用源测速。备用源没有被测过，规范的做法是留在当前 Pathway，而不是切过去赌。
4. 播放稳定之后再探测，和「SHOULD NOT 重载未播放的清单」方向相同，但那条规则的书面理由是减轻服务器负担，不是保护播放带宽。不能把「探测会偷带宽」写成已证实的行业结论。能写成已证实的是：规范要求的吞吐样本来自正在播的那一条 Pathway，而不是来自旁路探测。
5. Media3 先重试、再按状态码排除 location、并让排除持续数分钟。对多站点播放器，接近的解读是：一次慢或一次 5xx 不足以永久拉黑，但重复失败的源应有有限的排除窗。60 秒与 5 分钟是 track 与 location 的默认值，不能直接当成「站点不可用」的推荐时长。
