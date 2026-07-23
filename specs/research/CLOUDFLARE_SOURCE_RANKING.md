# Cloudflare 播放源优选（个人精简版）

这套方案只做三件事：

- 用 D1 存放体检结果和真实播放反馈
- 用低频 Cron 定时刷新播放源状态
- 在有数据时优先参考 D1，没有数据时回退到现有实时探测

它的目标不是做复杂调度，而是在个人使用场景下，用尽量低的成本提升换源稳定性。

## 依赖范围

这版只依赖：

- Cloudflare D1
- Cloudflare Cron Triggers

这版明确不依赖：

- Queue
- KV
- Analytics Engine

## 推荐启用顺序

1. 先创建并绑定 D1
2. 执行 `migrations/2026-05-09_cloudflare_source_ranking.sql`
3. 确认表创建成功
4. 再开启低频 Cron
5. 最后打开 `SOURCE_RANKING_ENABLED`

这样做的原因很简单：先让存储准备好，再让体检开始跑，最后才让播放前排序正式接管。

## 定时体检的推荐接法

当前项目是 Cloudflare Pages + Next。

为了避免直接改 Pages 主站部署结构，这里推荐：

- Pages 站点继续负责真正的体检逻辑，入口是 `/api/cron`
- 单独再部署一个很小的 Cloudflare Worker，只负责按时间触发 `/api/cron`

仓库里已经提供了模板：

- `workers/source-ranking-cron/worker.js`
- `workers/source-ranking-cron/wrangler.toml.example`

这条链路的好处是：

- 主站逻辑不需要拆散
- 定时器和页面部署彼此独立
- 后面要暂停、改频率、换目标地址都更简单

## D1 绑定方式

这个项目现在提供了一份最小模板：

- `wrangler.toml.example`

建议做法：

1. 复制一份为 `wrangler.toml`
2. 把里面的 `database_name` 和 `database_id` 换成你自己的 D1 信息
3. 保持绑定名为 `DB`

如果你是通过 Cloudflare Pages 面板管理项目，也可以不依赖本地 `wrangler.toml`，直接在 Pages 项目设置里增加同名的 D1 绑定。

关键点只有一个：

- 代码里读取的绑定名就是 `DB`

只要绑定名不是 `DB`，播放源优选和播放反馈这两条新链路都会把它当成“没有 D1”。

## 环境变量

建议至少配置以下开关：

```env
SOURCE_RANKING_ENABLED=false
NEXT_PUBLIC_SOURCE_RANKING_ENABLED=false
SOURCE_RANKING_FALLBACK_TO_LIVE=true
SOURCE_RANKING_CRON_ENABLED=false
SOURCE_RANKING_HAS_D1=false
CRON_API_TOKEN=
```

补充说明：

- `SOURCE_RANKING_ENABLED`: 控制服务端是否启用播放源优选
- `NEXT_PUBLIC_SOURCE_RANKING_ENABLED`: 让前端知道当前是否开启，方便展示和排查
- `SOURCE_RANKING_FALLBACK_TO_LIVE`: D1 没结果时是否回退到实时探测，建议始终保留 `true`
- `SOURCE_RANKING_CRON_ENABLED`: 控制定时体检是否启用
- `SOURCE_RANKING_HAS_D1`: 仅用于本地或测试环境，手动把运行时标记为“已具备 D1 绑定”。生产环境不要依赖它，正常应以真实 `DB` 绑定为准
- `CRON_API_TOKEN`: 启用 cron 时必填。用于保护 `/api/cron`，触发方需携带 `x-cron-token` 或 `Authorization: Bearer <token>`

补充说明：

- `.env` 或 `.env.local` 里不需要也不能直接写出 `DB`
- `DB` 是 Cloudflare 注入的绑定对象，来源应当是 Pages 绑定或 `wrangler.toml`
- 当前代码已经优先读取 Cloudflare 请求上下文里的 `DB`，不是只看本地环境变量
- 启用 cron 时必须配置 `CRON_API_TOKEN`，Pages 和 cron worker 两边使用同一个值

## D1 不可用时的行为

这套方案默认要保证“不影响播放”：

- 如果没有 D1，应该回退到现有实时探测
- 如果 D1 里还没有数据，应该回退到现有实时探测
- 如果 Cron 还没开始跑，只会影响优选质量，不会影响播放本身
- 如果关闭 `SOURCE_RANKING_ENABLED`，系统应回到旧逻辑

## Cron 频率建议

个人场景推荐从低频开始：

- 每天 1 次
- 或每天 2 次

不建议一开始就高频跑。个人使用更需要稳定和省额度，不需要实时刷新到分钟级。

## 部署检查清单

启用前建议确认下面几项：

- D1 已创建并成功绑定到项目
- 绑定名就是 `DB`
- 迁移脚本已执行成功
- `SOURCE_RANKING_FALLBACK_TO_LIVE=true`
- Pages 侧已打开 `SOURCE_RANKING_CRON_ENABLED=true`
- 单独的 cron worker 已部署，并指向 `https://你的域名/api/cron`
- 启用 cron 时，Pages 和 cron worker 两边已经配置同一个 `CRON_API_TOKEN`
- Cron 频率设置为每天 1 到 2 次
- 首次启用后，即使 D1 为空，也不会阻断原有播放流程
