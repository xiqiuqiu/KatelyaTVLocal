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

### 首屏会「先分栏再闪成横图」的原因

首屏分两步拿到数据：豆瓣热榜（推荐列表）与本地播放记录/收藏（偏好加权），TMDB 补数据是第三跳。任何一跳晚到都会让 `data-layout` 从 `split` 翻到 `backdrop`，用户在页面上看到的就是布局闪一下。

处理：

1. `useTmdbHero` 增加 `pending` 状态：请求未回来前为 `true`
2. `HomeHero` 在 `pending` 时渲染**与真实卡片同高**的骨架（`data-layout="backdrop"` + `.ui-home-feature-stage-fill`），而不是先画分栏
3. 推荐列表变化（本地信号到达导致重排）时，hook 立刻回到 `pending`，避免用旧数据渲染一帧
4. TMDB 结果按**标题**匹配而不是下标匹配，列表重排时不会张冠李戴
5. 首屏 `loading` 同时等本地信号（`loading || signals.loading`），把两次重排合并成一次

采样验证（清 sessionStorage 后每 70ms 记录一次）：`backdrop+骨架 → backdrop+横图`，没有中间态。

### 筛选页

- 切换筛选条件时**不再清空结果**，旧网格保留并淡化（`data-loading` → `opacity: .45`），新数据到达后整体替换
- 首次加载显示 12 张骨架卡（`aspect-[2/3]`），避免空白 + 跳动
- 实测切换「电影 → 剧集」时卡片数量始终为 20，中途没有归零
