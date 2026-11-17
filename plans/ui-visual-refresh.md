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
- 首页 `app/page.tsx`、`ContinueWatching`、`ui/PosterGrid`、`VideoCard`
  - 现状无 hero（见 §8.5），不新增区块；「继续观看」作为首屏大卡承担设计稿 hero 的视觉重量
  - 片库频道条、海报栅格密度、进度条配色、区块标题节奏
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

## 8.5 P0 基线快照结果（已完成）

### 环境

| 项 | 值 |
| --- | --- |
| 目标 dev 服务 | `http://127.0.0.1:3100`（PID 55977，Next 14.2.35） |
| 启动方式 | worktree 内 `node_modules` 软链到主目录 + 复制 `.env`（两者均不提交） |
| 登录 | 用 `.env` 的 `PASSWORD` 走 `/api/login`，浏览器 profile 内已持有 auth cookie |
| 设计稿服务 | `http://127.0.0.1:5199`（参考用，未参与本次截图） |

### 产物

路径：`.worktrees/ui-reelfind/.scratch/ui-refresh/before/`（44 张，约 50MB，已本地 exclude，不入库）

| 分组 | 覆盖 |
| --- | --- |
| 桌面 1440 | home / favorites / history / search-normal / search-ai / douban-movie / douban-tv / play / admin / warning / settings 面板，各含暗色 + 亮色 |
| 移动 390 | 同上一组（暗色），另含 login |
| TV 1920 | home / search / douban / history / play（暗色 + 亮色，个别为视口截图） |
| 登录 | login 暗/亮 1440 + 暗色 390 |

### 基线观察（会直接影响 P1 之后的取舍）

1. **现网主色是蓝色**（`--ui-accent: 120 170 255`，亮色为深蓝按钮），与新设计的琥珀 + 墨黑差异最大，token 层替换收益最高
2. **首页没有 hero 区块**：`HomeHero` 组件已无页面引用，首页首屏是页头 + 海报流。设计稿的 12 栅格大 hero 在目标里没有对应结构
   - 取舍：**不新增 hero**（属于加功能，超出改版范围），改为把「继续观看」提升为首页首屏大卡；无观看记录时保持海报流分栏
3. **播放历史 / 收藏为空**：本地存储为 `localstorage`，播放页能进到播放器，但源视频在本机网络下未能起播，因此没有进度记录，`继续观看` 区块未渲染
   - 影响：P6 交叉验证前需要先造一条真实观看记录（或直接写入 localStorage 播放记录键），否则该区块无法评分
4. **TV 模式截图陷阱**：整页截图时视口外海报是懒加载，会出现大量空白卡
   - 影响：TV 相关验收必须「先滚动预热图片，再截图」，或只截视口
5. **全页截图体积偏大**（单张 2–4MB），后续对比改用视口 + 关键区块截图，必要时降采样
6. 客户端页面标题仍是 `KatelyaTV`，登录按钮文案是 `进入 KatelyaTV`，与 §8 的改名方案一致

### P0 结论

基线可用，可以直接进入 P1（变量层替换）。唯一需要提前决策的是上面第 2 条：首页是否接受「无 hero」的还原方式。

---

## 8.6 P1 结果（已完成）

### 落地内容

| 文件 | 改动 |
| --- | --- |
| `src/styles/ui-theme.css` | 暗/亮两套 `--ui-*` 全量替换为 ReelFind 色板；新增 `--ui-cta` / `--ui-on-cta`；`--ui-focus` 改为琥珀；阴影降为「1px 描边感」；新增 `--font-display` / `--font-mono`；主按钮改消费 cta token，次按钮改为描边卡 |
| `src/styles/fonts.css`（新） | 三个本地 latin 变量字体 `@font-face`，`font-display: swap` |
| `public/fonts/*.woff2`（新） | Plus Jakarta Sans / Cormorant Garamond / JetBrains Mono，共 95KB |
| `src/app/globals.css` | 品牌字标去渐变改衬线纯色；移除 logo 光晕；粒子/几何装饰去彩色渐变；滚动条与焦点色 token 化；body 字体接 `--font-primary` |
| `src/styles/globals.css` | ArtPlayer TV 控件焦点色改琥珀（保留 4px，见下方约束） |
| `src/app/layout.tsx` | 引入 `fonts.css`；`themeColor` 同步新底色 |

### 验证

- `tsc --noEmit` 通过；ESLint 改动文件通过
- Jest：**140 套件 / 1254 用例全部通过**
- 截图：`.scratch/ui-refresh/after-p1/`（home / login / search-ai / settings 各暗亮 + TV 焦点态）
- 视觉确认：暗色底已是近墨黑、主按钮与搜索键为琥珀、TV 导航焦点环为琥珀、亮色回到暖白纸感

### 过程中发现的两个硬约束

1. **Jest 默认配置会忽略 `.worktrees/` 路径**，在 worktree 里直接跑会「No tests found」
   - 解决：`jest --runInBand --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/.next/`
   - 后续验收统一用这条命令，避免误判「测试不存在」
2. **`play/page.test.tsx` 断言 ArtPlayer TV 控件焦点环必须是 `4px`**
   - 处理：颜色改琥珀但保留 4px 宽度；其他焦点环仍按计划的 3px
   - 教训：动 TV 焦点样式前先搜一遍测试里的硬数字断言

### 遗留到后续阶段

- 登录页左侧故事图仍是蓝色调素材（`public/login-cinema-bg.png`），P4 重做登录页时一并换色
- 亮色模式下搜索键/图标按钮仍用强调色而非墨黑 CTA，P2 统一外壳时按 `--ui-cta` 收口
- 首页仍无 hero（已确认不做），等 P3 用「继续观看」大卡承担视觉重量

---

## 8.7 P2 结果（已完成）

### 落地内容

| 区域 | 改动 |
| --- | --- |
| 顶栏 `TopSearchBar` | 单行 64px：品牌（32px 琥珀字标块 + 衬线字标）→ 居中搜索（最大 640px）→ 右侧胶囊（电视模式 / 主题 / 账号）；移动端仍为两行 |
| 搜索键 | 改为琥珀文字按钮「🔍 搜索」，移动端只显图标 |
| 侧栏 `Sidebar` | 宽度 224 / 折叠 72（CSS 变量控制），背景独立 token `--ui-sidebar-bg`；激活项亮色墨黑胶囊 / 暗色琥珀胶囊；圆角 8px、行高 40px |
| 移动底栏 `MobileBottomNav` | 底栏模糊、5 列（首页/发现/搜索/我的 4 项 + 预留），激活项琥珀（亮色为墨黑） |
| `AppShell` | 主内容左内边距随侧栏同步 224/72，加 200ms 过渡避免跳变 |
| `ThemeToggle` | 图标与占位尺寸降至 36px，适配新顶栏 |

新增 token：`--ui-sidebar-bg`、`--ui-nav-active-bg`、`--ui-nav-active-fg`。

### 验证

- `tsc --noEmit`、ESLint 改动文件、Jest 140 套件 / 1254 用例全绿
- 截图：`.scratch/ui-refresh/after-p2/`（home 暗/亮 1440、home 暗 390、侧栏折叠、TV 首页、search、history）

### 发现并修复的问题

1. **Tailwind 任意值 `max-w-[9rem]` 在编译后的顺序上晚于 `max-w-0`**，导致侧栏折叠后文字仍占位被裁切（旧代码已有此隐患）
   - 修复：折叠时直接用 `hidden`，不再依赖 `max-w` 过渡
2. **侧栏宽度过渡与主区内边距切换不同步**，折叠瞬间内容会短暂被遮住
   - 修复：给 `#main-content` 加同等 200ms 的 `padding-left` 过渡
3. `.ui-sidebar` 不能写 `display: flex`，否则会盖掉 Tailwind 的 `hidden md:flex`，侧栏在移动端会冒出来
   - 修复：display 交给 `hidden md:flex`，CSS 只负责定位与尺寸

### 与设计稿的差异（有意保留）

- 设计稿底栏是 5 个导航位 + 设置，目标是 3 个主入口 + 「我的」（收藏/历史已能从侧栏进入）；不新增导航项属于功能变更，未做
- 设计稿账号按钮显示用户名，目标当前顶栏拿不到会话用户名，先保留图标按钮

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

自动化：`pnpm typecheck` → `pnpm lint:strict` → worktree 内 Jest：

```bash
jest --runInBand --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/.next/
```
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
