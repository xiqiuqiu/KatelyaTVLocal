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
