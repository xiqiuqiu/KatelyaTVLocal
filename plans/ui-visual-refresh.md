# UI 视觉改版：KatelyaTVLocal → ReelFind

> 把 `new_movie_website`（ReelFind 设计稿）的视觉体系迁移到 `KatelyaTVLocal`，
> 功能与电视模式保持不变，样式还原目标 ≥ 90%。
>
> 状态：待开工（本文件为计划，尚未改动任何源码）
> 参考设计：`/Users/sigclr/Projects/movie-web/new_movie_website`（dev 端口 5199）
> 改造目标：本 worktree（`.worktrees/ui-reelfind`，分支 `ui/reelfind-visual-refresh`）
> 目标 dev 端口：3100

---

## 1. 已确认的决策

| 项 | 决定 |
| --- | --- |
| 品牌名 | 改为 **ReelFind**（站点名、字标、登录页文案、页面标题） |
| 主色 | 采用参考设计的暖琥珀 `#E5A93C` + 墨黑/暖白纸感，替换现有蓝色 accent |
| AI 找片 | **只调色**：底色、表面、描边、文字层级、圆角、按钮、字体。不改布局、不改信息架构、不改交互 |
| 工作方式 | 在 worktree `.worktrees/ui-reelfind` 的新分支 `ui/reelfind-visual-refresh` 上改；主目录 `/Users/sigclr/Projects/KatelyaTVLocal` 保持零改动 |
| 内部页 | `/admin`、`/tvbox`、`/tvbox-debug`、`/tv-test`、`/tv-remote-debug`、`/warning` 仅做 token 级适配 |
| 字体 | 默认本地自托管 woff2 到 `public/fonts/`，取不到时回退 CDN 与系统栈（见 §7） |

---

## 2. 现状核对

### 参考设计（ReelFind）
- Vite + React 19 + Tailwind v4，22 文件，纯 mock 数据，无后端
- 设计语言：琥珀强调 + 墨黑/暖白纸感，1px 细描边、几乎无阴影、大留白、衬线大标题、等宽数字

### 改造目标（KatelyaTVLocal）
- Next 14 App Router，373 源文件，140 个测试文件
- 语义化样式层：`--ui-*` 变量 + `ui-*` 类，`ui-theme.css` 2211 行 / 388 选择器
- 路由：`/`（含 `?tab=favorites`）、`/douban`、`/search`、`/history`、`/play`（8490 行）、`/login`、`/admin`、`/config`、`/tvbox*`、`/tv-test`、`/tv-remote-debug`、`/warning`
- 电视模式是功能不是样式开关：`?tv=1` + cookie `katelya_tv_mode` + UA 识别（middleware）+ `useTvBrowseNavigation` 遥控焦点算法 + `data-tv-mode` / `data-tv-browse` / `data-tv-focus-key` / `data-tv-back`

### 为什么这次迁移成本可控
- 目标项目颜色基本走 `rgb(var(--ui-*))`：`bg-[rgb(var(--ui-` 出现 162 次，硬编码调色板仅 32 处
- 卡片、按钮、导航、骨架屏都已有语义类，改样式无需重写组件
- 主要工作量在「语义层 CSS + 少量外壳 JSX 结构调整」，不在业务逻辑

---

## 3. 验收标准

### 视觉（≥ 90%）
每个页面按 12 项视觉原子逐项打分（0 / 0.5 / 1）：

1. 页面底色 2. 卡片表面 3. 描边 4. 文字层级 5. 强调色与 CTA 6. 圆角
7. 间距节奏 8. 字体与字重 9. 卡片解剖（图/标题/元信息/角标） 10. hover/focus
11. 加载与空态 12. 响应式断点行为

### 功能
- `pnpm typecheck`、`pnpm lint:strict`、`pnpm test`（140 文件）全绿
- TV 模式：方向键浏览、Enter 进入、Back 返回、焦点环可见、`?tv=1` 跨页保持、退出写回 cookie、UA 识别路径不变
- AI 找片、聚合搜索、播放、选集、换源、跳过片头片尾、播放历史、收藏、登录/注册全部正常

### 不改动
- `src/lib/**`、`src/app/api/**`、`middleware.ts`、`next.config.js`、所有 `.test.*`
- 业务逻辑、配置结构、环境变量语义
- 测试依赖的类名：`play-overscroll-lock`、`ios-safari`、`tv-browse-navigation`、`art-setting-*`、侧栏 `opacity-100`

---

## 4. 端口与启动

| 项目 | 端口 | 说明 |
| --- | --- | --- |
| new_movie_website | 5199 | 已在运行，不动 |
| KatelyaTVLocal（worktree） | **3100** | 避开已占用的 3000；被占用则顺延 3101 / 3200 |

- worktree 需要 `node_modules`：优先 `pnpm install`；若过慢则临时 symlink 主目录的 `node_modules`（仅本地，不提交）
- 本地登录用 `.env` 中的 `PASSWORD`（不回显、不落盘）
- 启动命令从 worktree 执行：`pnpm gen:runtime && pnpm gen:manifest && next dev -H 127.0.0.1 -p 3100`

---

## 5. 设计系统映射

### 5.1 色板（统计自设计稿源码）

| 语义 | 暗色 | 亮色 |
| --- | --- | --- |
| 背景 | `#0A0B0E` | `#F7F6F2` |
| 表面 | `#13151B` | `#FFFFFF` |
| 抬升面 | `#1A1D26` | `#F2F0EB` |
| 主文字 | `#F4F2ED` | `#14161A` |
| 次级文字 | `#8F96A3` / `#B3B9C4` | `#5D6470` / `#7E8591` |
| 强调 | `#E5A93C`（hover `#EEB854`） | `#B45309`（文字）/ `#D97706` |
| 主 CTA | 琥珀底 + 墨黑字 | 墨黑底 + 白字 |
| 焦点环 | `#E5A93C` | `#B45309` |

### 5.2 变量映射

`src/styles/ui-theme.css` 的 `:root`（暗）与 `:root.light`（亮）：

- `--ui-bg` → `10 11 14` / `247 246 242`
- `--ui-surface`、`--ui-bg-elevated` → `19 21 27` / `255 255 255`
- `--ui-surface-strong` → `26 29 38` / `242 240 235`
- `--ui-border` → `43 47 58` / `216 222 232`
- `--ui-text` → `244 242 237` / `20 22 26`
- `--ui-text-muted` → `143 150 163` / `93 100 112`
- `--ui-accent` → `229 169 60` / `180 83 9`
- `--ui-accent-warm` → `238 184 84` / `217 119 6`
- `--ui-on-accent` → `10 11 14` / `255 255 255`
- `--ui-focus` → `229 169 60` / `20 22 26`
- **新增** `--ui-cta` / `--ui-on-cta`：亮色模式 CTA 是墨黑底白字，暗色是琥珀底墨黑字。现有 `--ui-accent` 同时承担「强调色」和「按钮底色」两个角色，必须拆分，否则亮色模式按钮会整片琥珀
- 阴影：`--ui-shadow-soft` / `--ui-shadow-strong` 降为参考设计的「几乎无阴影 + 1px 描边」
- 圆角：沿用 `--ui-radius-sm 8px / md 12px / lg 16px`，与设计稿一致

### 5.3 字体

- 无衬线：`Plus Jakarta Sans` + `Noto Sans SC`
- 衬线标题：`Cormorant Garamond` + `Noto Serif SC`
- 等宽数字：`JetBrains Mono`
- 接入方式：本地 woff2 子集（`public/fonts/`）+ `@font-face`；取不到时按 `Noto Serif SC → Georgia`、`system-ui` 回退
- 数字场景统一 `font-variant-numeric: tabular-nums`

---

## 6. 分阶段实施

### P0 · 基线快照（不改代码）
- 3100 启动改造前版本，浏览器按 **12 路由 × 亮/暗 × 390/834/1440** 截图
- 存档 `.scratch/ui-refresh/before/`，作为评分对照基准

### P1 · 设计地基
- `src/styles/ui-theme.css`：变量替换 + 新增 cta token + 字重/行高/圆角/阴影节奏
- `src/styles/globals.css`、`src/app/globals.css`：移除旧蓝色光晕、玻璃拟态、多余动效（flicker / glow / shimmer 按页删减）
- `src/app/layout.tsx`：字体接入、`themeColor` 同步新底色
- `tailwind.config.ts`：`primary` 调色板继续映射 accent，保证现有 `primary-*` 类不失效

### P2 · 应用外壳（视觉差异最大）
- `TopSearchBar`：改为「左品牌 · 中搜索 · 右操作」单行 64px 顶栏；移动端仍是两行（与设计稿一致）
- `Sidebar`：224 / 72px 双态；激活项亮色墨黑胶囊、暗色琥珀胶囊；折叠按钮入顶栏
- `MobileBottomNav`：5 项、底部模糊条、激活项琥珀
- `PageLayout`、`ui/PageHeader`、`ui/SectionHeader`、`ui/Surface`、`ui/ActionLink`、`ui/LoadingPrimitives`：字号阶梯、留白、骨架屏配色

### P3 · 内容页
- 首页 `app/page.tsx`、`HomeHero`、`ContinueWatching`、`ui/PosterGrid`、`VideoCard`
  - Hero 改为 12 栅格（左文案 + 右剧照渐变）
  - 片库频道条、横滑大卡、进度条配色
- `VideoCard`（1015 行）：只动 className 与 CSS，保留全部 `data-tv-*`、`model.*` 类名与播放遮罩逻辑
- `/douban` + `DoubanSelector` + `CapsuleSwitch`：胶囊筛选条
- `/search` + `TvSearchForm`：搜索头、豆瓣/资源/AI 三档分区
- `/history`：分组列表与缩略图行
- 收藏 tab：共用卡片，仅调整空态

### P4 · 边界业务页
- `/login` + `IOSCompatibility`：保留左故事右表单双栏，按新设计调色与排版
- 设置 / 账号：`UserMenu`、`lib/ui/settings` 分组不变，只重构容器、行、开关的视觉
- `/play`（8490 行）+ player 子组件 + `SkipController`（2065 行）：
  - **只改外框**：页头、详情区、推荐、选集/换源面板、加载与错误态、ArtPlayer 主题变量
  - 播放内核、HLS 策略、跳过逻辑、调试面板一律不碰

### P5 · 未覆盖页面（token 级）
- `AiFindPanel`、`AiFindResultGroups`、`AiFindSavedRecordsList`：仅调色与字体（输入区、分组标题、已保存记录卡片）
- `/admin`（`AdminSettings` 2860 行）、`/tvbox`、`/tvbox-debug`、`/tv-test`、`/tv-remote-debug`、`/warning`：底色、表面、描边、文字层级、圆角、按钮、字体
- 判定原则：换到新界面里「不违和」即可，不改布局与信息架构

### P6 · 品牌与 TV 专项 + 交叉验证
- 品牌改名 ReelFind（见 §8）
- TV 模式 CSS 独立成段：10-foot 字号、加大焦点环、导航放大、`[data-tv-browse]` 栅格与留白
- 逐条回归 `data-tv-focus-key` 顺序、`data-tv-back` 语义、`tv-browse-navigation` 根类、UA 识别
- 两项目并排截图，输出逐页对照表与最终分数

---

## 7. TV 模式兼容策略

新设计只有一条 TV 相关 CSS（琥珀焦点环），目标项目的 TV 体系必须完整保留：

1. **结构冻结**：`AppShell` 中 TV 分支的 DOM、`data-*` 属性、`buildTvModeHref` 调用、`useTvBrowseNavigation` 参数不动
2. **样式重定向**：TV 视觉从「另一套布局」改为「同一套设计的放大版」；TV 下隐藏顶栏（现状），TV 导航条沿用新胶囊项
3. **焦点环统一**：TV 下 `3px 琥珀 + 6px 外发光`，与鼠标键盘态区分
4. **回归清单**：`?tv=1` 首屏 / 搜索 / 豆瓣 / 历史 / 播放；退出按钮；cookie 持久化；方向键跨行跳转；Back 回退
5. **注意**：`useTvBrowseNavigation` 依赖可聚焦元素的可达性，改布局后必须实测方向键顺序，不能只看截图

---

## 8. 品牌改名 ReelFind（测试兼容方案）

约束：140 个测试必须保持绿色，且**不允许修改测试文件**。现状中有测试把文案钉死为 `KatelyaTV`：

- `src/app/login/page.test.tsx`：断言按钮名 `创建 KatelyaTV 账号` / `进入 KatelyaTV`
- `src/components/__tests__/tv-browse-navigation.test.tsx`：`SiteProvider` 默认值 `'KatelyaTV'`

处理方式（不改测试也能改名）：

| 位置 | 处理 |
| --- | --- |
| `src/app/login/page.tsx` | 按钮文案改为读取 `useSite().siteName`，不再硬编码 |
| `src/components/SiteProvider.tsx` | **保留** `'KatelyaTV'` 作为 SSR/无 Provider 时的兜底字面量（测试正是走这条路径），实际站点名由 layout 传入 |
| `src/app/layout.tsx` | `process.env.SITE_NAME \|\| 'KatelyaTV'` 的默认字面量改为 `'ReelFind'`；实际值仍优先取 `SITE_NAME` / `config.json` |
| `src/app/warning/page.tsx` | 标题改为 `安全警告 - ReelFind` |
| `src/lib/config.ts` | 4 处 `SiteName` 兜底默认值改为 `ReelFind` |
| `.env`（数据，非代码） | `SITE_NAME=ReelFind` |
| `config.json` / 后台站点配置 | `SiteConfig.SiteName` 设为 `ReelFind`（当前为空，走 env 兜底） |
| `src/app/api/tvbox/route.ts` | 内置源名称 `KatelyaTV内置解析` / `KatelyaTV直播`：属于播放源标识，**保持不动**，避免影响已保存的播放记录与源偏好键 |
| 字标 | 顶栏/侧栏使用文本 `ReelFind`，`logo.png` 暂时保留；如需新图标单开一步 |

验收时额外确认：登录页在生产环境显示 `进入 ReelFind`，而测试环境仍渲染 `KatelyaTV` 兜底文案并全部通过。

---

## 9. 验证矩阵

| 路由 | 亮 | 暗 | 390 | 834 | 1440 | tv=1 |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/?tab=favorites` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/history` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/search`（含 AI 找片） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/douban?type=movie` `/douban?type=tv` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/play` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/login` | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| 设置 / 账号面板 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/admin` `/tvbox` `/warning` | ✓ | ✓ | — | — | ✓ | — |

自动化：`pnpm typecheck` → `pnpm lint:strict` → `pnpm test`。
手工：TV 遥控全流程、AI 找片一次完整提问、播放/换源/跳过片头各一次。

---

## 10. 风险与对策

| 风险 | 对策 |
| --- | --- |
| `/play` 8490 行、`SkipController` 2065 行，误改逻辑风险高 | 只允许 className / CSS 变更，逻辑块冻结；改完跑 play 全部测试 |
| 388 个 `ui-*` 选择器互相覆盖 | 变量先行 + 分阶段提交，每阶段截图核对，不一次性重写 |
| 亮色模式「墨黑 CTA vs 琥珀 accent」冲突 | 新增 `--ui-cta` / `--ui-on-cta` 拆分语义 |
| 字体国内加载 | 本地自托管 woff2 优先，系统衬线兜底；不阻塞首屏 |
| 旧动效（flicker / glow / shimmer）与新设计冲突 | P1 统一清理，逐页核对残留 |
| `next-pwa` 生产环境缓存旧 CSS | dev 验证不受影响；生产验证时强制更新 SW 并复测 |
| 改布局后 TV 焦点顺序错乱 | 每个改动页在 tv=1 下实测方向键，不只看截图 |
| worktree 与主目录依赖/配置漂移 | worktree 只放代码改动，`node_modules` 与 `.env` 用本地链接，不提交 |

---

## 11. 提交与审阅方式

- 分支：`ui/reelfind-visual-refresh`（worktree `.worktrees/ui-reelfind`）
- 按 P1–P6 分阶段提交，每个 commit 只覆盖一个层次（tokens / shell / home / ...）
- 每阶段结束提供：改动文件清单 + 改造前后截图 + 该阶段视觉原子得分
- 主目录 `/Users/sigclr/Projects/KatelyaTVLocal` 不产生任何代码改动，可随时 `git diff ui/reelfind-visual-refresh` 审阅
