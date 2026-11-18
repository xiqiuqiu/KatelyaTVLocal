# TMDB 接入（P1：代理层与匹配）

## 为什么接

片源只提供竖版海报（270×400），首页横幅只能裁切或留白。TMDB 能补上 `backdrop_path`（16:9 横图）、`logo_path`（片名字体）、`overview`（简介）、`videos`（预告片）、剧集 `still_path`（每集剧照）等字段。

## 配置

两种鉴权方式，任选其一（v4 Read Token 优先）：

| 环境变量 | 说明 |
| --- | --- |
| `TMDB_READ_TOKEN` | v4 Read Access Token，走 `Authorization: Bearer`，key 不出现在 URL |
| `TMDB_API_KEY` | v3 API Key，会拼进查询串 |

未配置时 `/api/tmdb/*` 返回 **503**，前端必须按「没有 TMDB」降级，不能白屏。

本地做法：把 key 填进 worktree 的 `.env`（该文件不入库），保存后重启 `next dev`。
`.env.example` 里已保留两个空占位，方便新环境照着填。

## 代理端点

`GET /api/tmdb/<path>?<params>`

只放行白名单路径（`src/lib/tmdb/endpoints.ts`）：

```
search/movie  search/tv  search/multi
movie/{id}  tv/{id}
movie/{id}/recommendations  tv/{id}/recommendations
movie/{id}/credits  tv/{id}/credits
tv/{id}/season/{n}
trending/{movie|tv|all}/{day|week}
discover/{movie|tv}
genre/{movie|tv}/list
```

- 查询参数白名单：`query`、`year`、`primary_release_year`、`first_air_date_year`、`language`、`page`、`include_adult`、`with_genres`、`sort_by`、`vote_average_gte`、`vote_average.gte`、`with_original_language`、`append_to_response`
- 其它参数（例如外部传进来的 `api_key`）一律丢弃，防止代理被当成开放网关
- `language` 默认 `zh-CN`
- 响应头：列表类 `s-maxage=3600`，详情类 `s-maxage=21600`，都带 `stale-while-revalidate=86400`

## 标题匹配

`src/lib/tmdb/matching.ts`：

- `normalizeTmdbTitle()`：去掉括号内容、标点、`第 N 季 / Season N` 后缀
- `pickTmdbMatch()`：同时比较 `title` / `original_title` / `original_name`；年份相差 > 1 年直接排除，差 1 年扣 0.15，标题只前缀匹配扣 0.25
- 置信度 < 0.6 时调用方应回退到无 backdrop 的展示

豆瓣与 TMDB 的 ID 体系不通，只能按标题+年份匹配，国产剧/国漫命中率需要真机数据验证后再决定降级策略。

## 图片

```ts
import { buildTmdbImageUrl } from '@/lib/tmdb/matching';
buildTmdbImageUrl(backdropPath, 'w1280');
// https://image.tmdb.org/t/p/w1280/xxx.jpg
```

`image.tmdb.org` 国内访问不稳，落地时统一走现有 `/api/image-proxy`：

```ts
processImageUrl(buildTmdbImageUrl(path, 'w1280'));
```

## 条款

TMDB 要求署名，且不得用其数据做竞品服务。上线时需要页脚显示
“This product uses the TMDB API but is not endorsed or certified by TMDB.”

## 首屏聚合接口（P2）

`GET /api/tmdb/hero?items=<JSON>`

- 入参最多 6 条：`[{ title, year?, kind: 'movie'|'tv'|'show' }]`
- 服务端逐条 search → detail，只返回 `{ title, matched, tmdbId, media, backdropPath, overview, runtime, genres, vote }`
- 单条失败不影响其它条目；匹配不到返回 `matched: false`
- 未配置 TMDB 时返回 `{ enabled: false, items: [] }`（HTTP 200），前端据此保持竖版海报布局
- 响应 `cache-control: public, s-maxage=86400`；前端另用 sessionStorage 按推荐列表缓存

前端消费：`src/components/useTmdbHero.ts`

- 有 backdrop → `data-layout="backdrop"`，全幅 16:9 大图 + 左侧渐变，右侧海报列与候选清单隐藏
- 没有 backdrop（综艺命中率低）或 TMDB 未配置 → `data-layout="split"`，保留「竖版海报 + 候选清单」双栏

## 实测命中率（2026-11-18，本地 60 条豆瓣条目）

| 榜单 | 命中 | 有 backdrop | 有简介 |
| --- | --- | --- | --- |
| 热门电影 | 19/20 | 19 | 18 |
| 热门剧集 | 20/20 | 20 | 20 |
| 热门综艺 | 5/20 | 4 | 5 |

结论：电影/剧集足够支撑全幅首屏；国产综艺覆盖差，必须保留双栏回退。

## 筛选片库（P4a）

页面：`/discover`（Web 优先，已加侧栏「筛选」入口）

筛选维度与对应 TMDB 参数：

| 维度 | 参数 | 说明 |
| --- | --- | --- |
| 内容 | `discover/movie` / `discover/tv` | 切换时会清空类型选择（两种媒体的 genre id 不通用） |
| 类型（多选） | `with_genres=18,80` | 取自 `genre/{movie\|tv}/list?language=zh-CN` |
| 年份 | `primary_release_date.gte/lte`（电影）`first_air_date.gte/lte`（剧集） | 2020 年代 / 2010 年代 / 2000 年代 / 更早 |
| 评分 | `vote_average.gte` + `vote_count.gte=200` | 7/8/9 分以上；票数下限防止冷门刷分 |
| 语言 | `with_original_language` | 华语 zh / 英语 en / 日语 ja / 韩语 ko |
| 排序 | `sort_by` | 人气 / 评分 / 最新 |

- 每页 20 条，`IntersectionObserver` 无限滚动（实测 20 → 40）
- 卡片走 `VideoCard from='douban'`，点击后进入 `/play?title&year&stype`，由播放页现有逻辑做多线路聚合搜索
- TMDB 未配置时 `data` 为空并显示「筛选暂不可用」空态，不影响其它页面

## 点片 → 多线路查找（P4b）

筛选页卡片会带上三个参数进入播放页：

```
/play?title=<中文名>&year=<年份>&stype=<movie|tv>&alt=<原名>&from=discover
```

播放页行为：

1. 先按中文名走原有聚合搜索
2. 搜不到且带 `alt` → **自动用原名重跑一次**（`router.replace`，只重试一次，靠 `retriedWithAltRef` 防循环）
3. 仍搜不到 → 未命中页给出「用原名再搜一次 / 回到筛选页」两个出口
4. 再次失败的最后一次尝试里 `alt` 已被消耗，页面不会来回跳

## 电视端（P4c）

- 电视导航新增「筛选」→ `/discover?tv=1`（`首页 / 发现 / 筛选 / 搜索 / 收藏夹 / 播放历史`）
- 筛选胶囊 64px、行标签 96px、字号 20–22px
- 无限滚动在电视上同时提供显式「加载更多」按钮，遥控更好按
- 网格沿用 PosterGrid，遥控方向键在 6 列网格间移动

## 年份档位与结果统计（P5a）

### 年份

`buildYearOptions(referenceYear)` / `getYearOptions()`（运行时按当前年份算）：

| 档位 | 区间 |
| --- | --- |
| 今年 | 当年整年 |
| 去年 | 上一年整年 |
| 2020–(今年-2) | 2020 至前年（2022 年后才出现） |
| 2010 年代 / 2000 年代 / 90 年代 / 80 年代 | 各十年 |
| 更早 | 1950–1979 |

### 结果统计

面板标题旁显示「共 N 个结果」，取自 discover 的 `total_results`；超过 10000 显示 `10000+`（TMDB 分页上限）。

### 二级标签（已移除）

曾按 TMDB keyword 做过动漫子类型标签（异世界 / 热血 / 少女 / 竞技 / 治愈），实测覆盖不足：

- 日漫尚可（异世界 190、热血 543、少女 189、竞技 145、治愈 760）
- 国漫几乎为空（异世界 19、热血 6、少女 1、竞技 6、治愈 31）

其他类型也评估过（动作→功夫 中文 576、恐怖→丧尸 中文 13、科幻→时间旅行 中文 10…），整体标签体系不完整、效果不稳定，已整体移除，不再展示。

代理层的 `with_keywords` / `without_keywords` / `with_origin_country` 白名单保留，供以后接入更完整的标签源时使用。

## 首屏按钮收敛与移动端排版（P6）

- 移除「查看片单」次要按钮：首屏只保留「立即播放」，减少决策分叉（片单入口在下方分类行与侧栏已有）
- 移动端（<768px）：
  - 全幅模式的 stage 不再锁 `min-height`，高度由内容决定（此前 320px 会把卡片底部空出约 48px）
  - 横版剧照的遮罩改为自下而上（0.94 → 0.18），文字可读的同时保留画面
  - 「立即播放」最小高度 44px，满足触屏点击目标
  - 长标题在 306px 容器内两行截断，实测无横向溢出（390 / 360 / 320 三档都验证过）

## 加载态与闪烁处理（P7）

### 现象

刷新首页时会看到「骨架 → 分栏 → 海报图」三段跳。用 `requestAnimationFrame` 逐帧采样 `data-layout` 才定位到真实序列：

```
backdrop+sk → split+bd+list|克拉克森的农场 第五季 → backdrop+sk → backdrop+bd|罗斯
```

即：先按**没有本地信号**的那份推荐（综艺排第一、且它的 TMDB 记录没有 backdrop）画了一版分栏，再换成有信号的推荐。

### 根因（四处，缺一不可）

1. `useTmdbHero` 的 `pending` 是在 effect 里手动置位的 → 推荐列表一变，会先用上一份结果渲染一帧
2. `HomeHero` 的骨架条件写成 `loading && count === 0` → 热榜先到、本地信号没到时（`count > 0`）就直接画内容
3. `useHomeSignals` 把「播放记录」和「收藏」放在两个 state → 首屏会先后算出两版推荐
4. TMDB 结果按下标匹配推荐列表 → 列表重排时张冠李戴

### 处理

- `pending` 改为**渲染期推导**：`resolved.key !== cacheKey` 即为待定，effect 只写结果不置位
- 骨架条件统一为 `loading || pending`：热榜 / 本地信号 / TMDB 任一未就绪都保持骨架
- `useHomeSignals` 合并成单个 state，一次写入；初次读取完成前忽略订阅事件
- TMDB 结果按**标题**匹配（`enrichmentByTitle`），不再依赖下标
- TMDB 请求失败**重试一次**，避免偶发失败把首屏从横图退回分栏

### 验证

清缓存/有缓存各刷新多次，逐帧采样结果全部是：

```
backdrop+骨架 → backdrop+横图
```

没有任何 `split` 中间帧。桌面 1440、移动端 390 均如此。

### 筛选页

- 切换筛选条件时**不再清空结果**，旧网格保留并淡化（`data-loading` → `opacity: .45`），新数据到达后整体替换
- 首次加载显示 12 张骨架卡（`aspect-[2/3]`）
- 实测切换「电影 → 剧集」时卡片数量始终为 20，中途不归零

## Cloudflare Pages 部署清单

部署方式：`@cloudflare/next-on-pages`（项目名 `katelyatv-b3u`），通过 GitHub 连接自动构建。

### 必须配置

| 位置 | 项 | 值 |
| --- | --- | --- |
| Pages → Settings → Environment variables | `TMDB_READ_TOKEN` | v4 Read Access Token，**勾选 Secret/加密**，Production 与 Preview 都要加 |
| Pages → Settings → Functions → Compatibility flags | `nodejs_compat` | 仓库 `wrangler.toml` 里已声明，确认控制台里也开着 |

说明：

- 只用 v3 key 时可改成 `TMDB_API_KEY`（会拼进上游查询串，安全性略低，优先用 v4）
- 未配置时 `/api/tmdb/*` 返回 503 / `enabled:false`，首屏与筛选页会自动降级，**不会白屏**

### 建议配置

| 项 | 值 | 作用 |
| --- | --- | --- |
| `NEXT_PUBLIC_IMAGE_PROXY` | `/api/image-proxy?url=` | 让 TMDB 图片（`image.tmdb.org`）走自家图片代理，国内网络更稳。这是**构建期变量**，改了要重新部署 |

注意结尾必须带 `?url=`：代码里是 `${proxyUrl}${encodeURIComponent(originalUrl)}` 直接拼接。

### 不需要做的事

- **无需新的依赖 / 构建命令变更**：本次改动没有新增 npm 包
- **无需 D1 迁移**：TMDB 相关代码不落库，只走内存与 sessionStorage 缓存
- **无需新增 wrangler 绑定**：不新增 KV / D1 / R2

### 需要知道的限制

- Pages Functions 的响应**不会**自动进 Cloudflare 边缘缓存，`Cache-Control: s-maxage` 只是声明；实际复用的是浏览器 sessionStorage 与服务端对 TMDB 的实时请求。若要真正边缘缓存，需要改用 Cache API（`caches.default`）
- 首屏聚合接口一次最多 6 部片 × 2 次上游请求（search + detail），即单次访问最多 12 个 TMDB 请求；TMDB 免费额度约 50 次/秒，个人使用量级无压力
- `/api/tmdb/*` 走登录校验（middleware 未放行），token 只在服务端使用，不会出现在浏览器请求里
