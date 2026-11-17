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

## 8.8 P3 结果（已完成）

### 落地内容

| 区域 | 改动 |
| --- | --- |
| 页面标题 | 首页/片库/搜索/播放页 h1 改衬线字体，首页 30→34px |
| 顶部分类 | 电影/剧集/综艺改为带边框的胶囊组（容器 1px 描边 + 内部 34px 项） |
| 区块标题 | 19px/600，“查看更多”降到 12px（移动端保留 44px 触控高度） |
| 海报卡 | 新增 `ui-video-card` / `ui-video-poster` 类；细描边 + 悬停琥珀描边，无投影；圆角 12px |
| 卡片角标 | 评分变等宽字体瓃珀色、集数变中性白，统一 4px 圆角 + 68% 黑底 |
| 卡内图标 | 豆瓣/收藏/删除从 44px 改为 30px（仍保留 44px 命中区由内部按钮尺寸控制，TV 模式另走放大规则） |
| 搜索卡 | 单列列表（与设计稿一致），封面 104px + 内边距 16px + 悬停琥珀描边；内层来源卡去边框 |
| 分段控件 | 普通搜索 / AI 找片改为胶囊容器 + 激活项填充（暗色琥珀、亮色墨黑） |
| 筛选胶囊 | 带描边 34px，激活项琥珀描边 + 12% 琥珀底 |
| 按钮 | 主/次按钮降到 36px / 13px，移动端仍 44px |

### 验证

- `tsc`、ESLint、Jest 140 套件 / 1254 用例全绿
- 截图：`.scratch/ui-refresh/after-p3/`（home / search / douban / history / favorites × 暗亮 1440、home 暗 390、TV 首页）
- TV 模式：卡片与导航未受影响，方向键焦点仍在瓃珀环上

### 刻意保留的差异

- 设计稿海报是虚构的 3:4 构图，目标用真实 2:3 海报；改比例会裁掉片名信息，保留 2:3
- 设计稿把“类型切换”放在标题右侧同一行，目标豆瓣页是标题上方独立导航条；动它属于改页面结构，P3 不动

---

## 8.29 继续观看卡：播放按钮只在电视保留（P6m，已完成）

### 最终形态

| 场景 | 脚部播放按钮 | 点按区域 |
| --- | --- | --- |
| 网页 / 手机 | 不渲染（不留隐形节点） | 整块文案区就是按钮：标题、集数、进度、来源全部可点，hover 时标题转琥珀色，键盘聚焦时有 2px 焦点环 |
| 电视 | 整行 64px「继续播放」主按钮，`data-tv-primary` | 按钮自身，遥控可聚焦 |

上一轮用 CSS `display:none` 隐藏的做法已废弃，改为在模型层直接不渲染（`showContinue: isLandscape && tvMode`），避免出现「存在但不可见、也进不了焦点顺序」的节点。

### 实现要点

- `footerIsAction = isLandscape && !tvMode`：网页/手机的文案区渲染成 `<button aria-label="继续播放 <片名>">`，点击走同一个 `handleClick`，保留 `tv` 参数与播放记录路由
- 电视侧文案区仍是 `<div>`，保证 `VideoCard.test.tsx` 里「唯一可聚焦按钮是继续播放」的断言成立
- 删掉了此前为圆形按钮写的 36px/媒体查询样式，改为 `.ui-video-footer-action` 的复位样式

### 验证

- 手机 390：脚部无按钮，`.ui-video-footer-action` 存在，点第二条「逃出布迪秀」文案区正确跳到 `/play?source=ruyi&id=88334&...`
- 电视 1920：按钮 541×64、`tabIndex=0`、文案区不是按钮
- 桌面 1440：无按钮，文案区可点
- `tsc`、ESLint 0 warning、**Jest 145 套件 / 1266 用例全绿**
- 截图：`.scratch/ui-refresh/resume-cta2-{mobile-390,tv-1920}.png`

### 附注

本轮中途 dev server 自己退出了，用 `next dev -p 3100` 重启（日志 `.scratch/dev.log`）。

## 8.28 继续观看卡：桌面移除脚部圆形播放按钮（P6l，已完成）

### 问题

桌面继续观看卡信息区右侧有一个 36px 圆形播放按钮。它和封面悬停浮层里的播放按钮、以及整卡点击重复，而且在网页端并不参与焦点顺序（`<article>` 内的海报按钮才带 `data-tv-primary`），用户 Tab 不到、鼠标也只会点在整卡上，属于纯装饰性多余控件。

### 处理

| 场景 | 行为 |
| --- | --- |
| 桌面 / 平板（≥768px，非电视） | `display: none`，信息区文字占满整行；播放入口仍为封面悬停浮层 + 整卡点击 |
| 手机（<768px） | 保留 36px 圆形按钮，作为无悬停场景的稳定点按目标 |
| 电视（`data-tv-mode` / `data-tv-browse`） | 显式 `display: inline-flex` 覆盖，保持整行 64px「继续播放」主按钮与遥控焦点 |

### 验证

- 桌面 1440：`.ui-video-continue` 计算样式 `display: none`，卡片脚部只剩标题与「第 1 集 · 共 9 集 · 已看 27% · 如意资源」
- 手机 390：按钮 `display: flex`、36×36，仍可点
- 电视 1920：按钮 541×64、`tabIndex=0`、`display: inline-flex`，遥控可聚焦
- **Jest 145 套件 / 1266 用例全绿**（`VideoCard.test.tsx` 继续播放断言在 `tvMode` 下，未受影响）
- 截图：`.scratch/ui-refresh/resume-cta-{card-1440,mobile-390,tv-1920}.png`

## 8.27 叠层封面改用结果海报（P6k，已完成）

### 可行性结论：可以，且不需要数据迁移

历史记录在存储层保存的是完整 `AiFindResponse`，而列表卡片拿到的 `AiFindSavedRecordSummary` 是**读时派生**的（`summarizeAiFindSavedRecord`）。所以在派生阶段顺手收集海报即可，已有的 upstash / D1 / 本地存储里的旧记录立刻生效，无需回填。

### 改动

| 层 | 改动 |
| --- | --- |
| 类型 | `AiFindSavedRecordSummary` 新增可选 `posters?: string[]`（最多 3 张） |
| 派生 | `collectSavedRecordPosters()` 按 `response.groups[].groups[].poster` 顺序取，去重、跳过空值、取前 3 |
| 卡片 | 每层卡面优先渲染海报（`processImageUrl` 走 image-proxy，宽 160 请求，`loading="lazy"`、`referrerPolicy="no-referrer"`）；无海报时回退为原来的文字标签 |
| 层级 | 第一张海报（首个结果）压最上层，后两张依次右下方错位露出边缘；容器 78×104 容纳错位不裁剪 |
| 海报态样式 | 卡面底部加 62% 黑色渐变保证叠层文字/边界清晰，标签字号降到 11px |

### 验证

- `/api/ai/find/history` 返回 `posters: 3`，三条 img `naturalWidth` 均加载成功（270 / 1000 / 270）
- 暗色、亮色 1440 与 TV 1920 三种场景截图正常，TV 焦点环与卡片尺寸不变
- `tsc`、ESLint（本次改动文件 0 warning）、**Jest 145 套件 / 1266 用例全绿**
- 截图：`.scratch/ui-refresh/ai-cards-posters-{zoom,dark,light,tv}.png`

## 8.26 最近 AI 找片恢复叠层卡片样式（P6j，已完成）

旧版（`b794b4f6.katelyatv-b3u.pages.dev`）的「最近 AI 找片」是卡片网格，而不是当前的单行列表。样式来源已确认在本仓库历史提交里：`55cd0d3` / `9af3adb`（之后被 `43ccde7` 统一界面时改成了列表）。

### 复刻内容

| 部分 | 实现 |
| --- | --- |
| 网格 | `repeat(auto-fill, minmax(288px, 1fr))`，1440 宽下 4 列，自适应不依赖固定断点 |
| 卡片 | 最小高 148px、16px 圆角、细描边 + 低透明底色，悬停上浮 2px 并变琥珀描边，选中态琥珀底 |
| 叠层封面 | 三张 62×91 小卡错位旋转（每层 +7px/+6px/旋转 4°），底部渐变 + 琥珀光斑，左下角显示查询词前 6 字 |
| 文案区 | 标题两行截断 14px/600；状态胶囊「已完成」(success 绿) /「继续加载」(琥珀)；底部时间 + 圆形打开按钮 |
| 亮色适配 | 叠层封面固定深色卡面（#1d212a→#0c0e13），保证白字在亮色主题下依然可读 |
| TV | 网格改为 `minmax(520px, 1fr)`，卡片最小高 176px，标题 26px、状态 18px、打开按钮 44px；保留 `data-tv-focus-key` 与 3px 琥珀焦点环 |

### 验证

- 桌面暗色 1440：4 列卡片，叠层封面、状态胶囊、时间与打开按钮均正常
- 桌面亮色 1440：卡面与文字对比度正常（此前叠层在白底上发灰，已改固定深色卡面）
- TV 1920：单列 523px 宽卡片，遥控可聚焦
- `tsc`、ESLint、**Jest 145 套件 / 1266 用例全绿**
- 截图：`.scratch/ui-refresh/ai-cards-*.png`、旧版对照 `.scratch/ui-refresh/old-version-ai-1440.png`

## 8.25 AI 找片本地实跑（P6i，已完成）

### 为什么之前本地跑不出结果

不是 UI 问题，而是**额度存储只支持 D1**：`usage-quota.ts` 里 `getD1Database()` 拿不到库就直接返回 503「AI 找片额度存储未配置」。本地是 upstash，所以即使配好 AI 也一定失败。

### 本轮改动

| 项 | 改法 |
| --- | --- |
| 额度后端抽象 | `checkAndConsumeAiFindQuota` 改为选后端：有 D1 用 D1，否则尝试 KV 计数器 |
| 新增 `usage-quota-kv.ts` | 用 `@upstash/redis` 的 INCR/DECR + 3 天过期实现按日计数，键形如 `ai-find:usage:find:user:admin:2026-11-17` |
| 安全兜底 | 仅在 `NEXT_PUBLIC_STORAGE_TYPE=upstash`、存在 URL/TOKEN、且运行环境有全局 `fetch` 时启用；否则维持原 503 行为（测试环境因此不受影响） |

### 本地配置（`.env`，未入库）

```
AI_FIND_ENABLED=true
AI_BASE_URL=http://127.0.0.1:3425/v1
AI_API_KEY=local-gateway
AI_MODEL=group/ds4.1
```

说明：本地 3425 是 magpie 网关，实测 `Authorization: Bearer <任意值>` 即可用，所以 key 填占位值。原 `.env` 备份在 `/tmp/reelfind-env-before-ai.bak`。

### 实测结果（本地 vs 线上）

| 项 | 本地（upstash + KV 额度） | 线上（D1） |
| --- | --- | --- |
| 提交请求 | 200，返回 answer + 5 个候选片名（含高匹配/可参考置信度） | 一致 |
| 记录保存 | 「16–32 组结果 · 部分结果 · 时间」 | 一致 |
| 最近 AI 找片 | 有记录时列表展示，无记录时显示空态 | 有记录时列表展示 |
| 分组加载 | 按候选片名逐个查询，可边看边加载 | 一致 |
| 额度计数 | Redis 键 `ai-find:usage:find:{user,ip,global}:…` 正常生成 | D1 表 |

### 电视端实测

- `/search?mode=ai&tv=1`：Tab 后方向键直接落到记录卡（3px 琥珀焦点环，卡片 108px 高）
- Enter 打开记录 → 候选影片区、分组标题 40px、结果卡带「查看并播放 / 展开来源」，遥控焦点正常

`tsc`、ESLint、**Jest 145 套件 / 1266 用例全绿**。截图：`.scratch/ui-refresh/ai-live-*.png`。

## 8.24 AI 找片：本地空态与电视端适配（P6h，已完成）

### 线上与本地差异的真实原因

- 线上（D1 + 已配置 AI）能看到「最近 AI 找片」列表与历史记录
- 本地 `AI_FIND_ENABLED=false`、`AI_API_KEY`/`AI_MODEL` 为空，AI 请求不可用；并且 `AiFindSavedRecordsList` 在没有记录时**直接返回 null**，所以整块「最近 AI 找片」在本地和电视端都完全消失

### 本轮改动

| 项 | 改法 |
| --- | --- |
| 空态 | 无记录时不再返回 null，而是渲染「还没有 AI 找片记录」+ 说明（结果会自动保存、之后可直接打开） |
| TV 文案 | 电视端空态追加「用方向键选择记录，按确认键打开」 |
| TV 排版 | 空态、标题、记录卡在 `[data-tv-browse]` 下放大：标题 36px、卡片最小 88px、正文 22–26px |
| 记录卡 | TV 下 `ui-saved-query` 高度与字号提升，保持 `data-tv-focus-key="ai-record:<id>"` 遥控定位 |

### 兼容性验证（含临时数据）

用一条临时记录（写入 Redis `u:admin:ai_find_saved_records`，验证后已 `DEL`）验证电视端：

| 检查 | 结果 |
| --- | --- |
| TV 显示记录 | 「推荐几部高分日本热血漫 0 组结果 · 已完成」✓ |
| 遥控聚焦 | 首按方向键即落到记录卡，3px 琥珀焦点环，卡片高 108px ✓ |
| 确认打开 | Enter 后展示「候选影片 / 刷新结果 / 删除记录」+ 答案文本 ✓ |
| 空态 | 删除记录后桌面与 TV 都显示空态文案 ✓ |
| TV 输入流程 | Tab → 方向键到输入框 → Enter 进入编辑 → 输入 → Enter 提交 ✓ |
| AI 未启用提示 | 提交后显示「AI 找片尚未启用，请先配置 AI 服务。」✓ |

`tsc`、ESLint、**Jest 145 套件 / 1266 用例全绿**。

### 遗留：本地要看到真实 AI 结果需配置环境变量

AI 找片是**纯 env 配置**（`AI_FIND_ENABLED` / `AI_API_KEY` / `AI_MODEL` / `AI_BASE_URL`），后台设置面板里没有 AI 入口。本地 `.env` 目前未配置，因此只能看到界面与空态，无法真正生成结果。补上这三项并重启即可与线上一致。

## 8.23 移除首页片库频道分类行（P6g，已完成）

| 端 | 处理 |
| --- | --- |
| 桌面（≥768px） | 首页不再渲染「片库频道 + 电影/剧集/综艺」整行；分类由侧栏直接承担 |
| 手机（<768px） | 保留一行紧凑的分类胶囊（首页仍需要入口，底栏只有「发现」）；由 `useMediaQuery` 判断 |
| 电视 | 首页不渲染分类行；沿用 TV 顶部「发现 → /douban?type=movie」与豆瓣页的分类导航 |
| 侧栏结构 | 拆成三个 `<nav>`：主导航（首页）/ 影片分类（电影·剧集·综艺）/ 个人内容（收藏夹·播放历史），便于读屏与测试定位 |

### 兼容性说明

`page.test.tsx` 要求「非 TV 首页必须存在 `nav[aria-label='影片分类']`」，同时又要求「TV 首页不得存在」。由于该用例把 `PageLayout` mock 掉了（侧栏不在 DOM 里），分类入口必须由首页自己渲染——所以采用媒体查询：窄屏渲染、宽屏与 TV 不渲染。jsdom 无 `matchMedia` 时按窄屏处理，测试通过；真实桌面浏览器里就是侧栏接管。

### 验证

- 桌面实测：`ui-home-catalog` 下无分类行，侧栏 `ui-sidebar-catalog` 存在；顺序为 Hero → 继续观看 → 热门电影
- 手机实测：`.ui-home-channels-actions` 渲染三枚胶囊，链接分别指向 `/douban?type=movie|tv|show`
- TV 实测：首页无分类行，顶部导航仍是 首页/发现/搜索/收藏夹/播放历史/设置
- `tsc`、ESLint、**Jest 145 套件 / 1266 用例全绿**
- 截图：`.scratch/ui-refresh/after-p6g-*.png`（桌面 1440 / 手机 390 / TV 1920）

---

## 8.22 侧栏「发现」拆成一级分类（P6f，已完成）

| 项 | 改法 |
| --- | --- |
| 侧栏结构 | 首页 / **电影 · 剧集 · 综艺** / 收藏夹 / 播放历史；去掉「发现」这层，少点一次 |
| 数据来源 | `sidebarNavigationItems` 直接展开 `catalogNavigationItems`，不再引用 `primaryNavigationItems[1]` |
| 高亮规则 | `/douban?type=tv` → 剧集、`?type=show` → 综艺、`/douban`（无 type，默认电影）→ 电影 |
| 移动底栏 | **保留「发现」**：底栏只有 3 个入口，塞进三个分类会超出，且 `light-cinema-navigation` 断言底栏是 首页/发现/搜索 |
| TV 导航 | **保留「发现」**：`app-shell.test` 断言 TV 模式存在「发现 → /douban?type=movie&tv=1」 |

### 验证

- 实测三种 URL 的高亮：`type=tv` → 剧集、无 type → 电影、`type=show` → 综艺，均只有一项高亮
- `tsc`、ESLint、**Jest 145 套件 / 1266 用例全绿**
- 截图：`.scratch/ui-refresh/after-p6f-*.png`

---

## 8.21 继续观看卡显示总集数（P6e，已完成）

| 项 | 改法 |
| --- | --- |
| 集数文案 | 抽出 `buildLandscapeStatusText`：有总集数时输出「第 N 集 / 共 M 集」，否则退化为「第 N 集」 |
| 进度 | 仍保留 `已看 X%` 与来源，组合成「第 1 集 / 共 9 集 · 已看 27% · 如意资源」 |
| 换行 | 副标题从单行省略改为最多两行，避免「共 N 集」被截断成「如意…」 |
| 兼容 | 未提供总集数的旧数据仍使用原格式；`VideoCard.test.tsx` 里「第 18 集 · 已看 40% · 测试源」的断言不受影响 |

### 验证

- 新增 `__tests__/video-card-landscape-status.test.tsx`：覆盖有总集数与无总集数两种输出
- Jest **145 套件 / 1266 用例全绿**；`tsc`、ESLint 通过
- 实测：桌面 `第 1 集 / 共 9 集 · 已看 27% · 如意资源`（两行完整展示）；TV 22px 同文案；播放历史页计数与侧栏一致
- 截图：`.scratch/ui-refresh/after-p6e-*.png`

---

## 8.20 继续观看卡片对齐设计稿（P6d，已完成）

对齐设计稿的横卡结构，同时保住全部既有交互：

| 项 | 改法 |
| --- | --- |
| 卡片 | 整卡 1px 描边 + 12px 圆角 + 溢出裁切；悬停整卡描边变琥珀 50% |
| 封面 | 满出血（去掉内层描边与圆角） |
| 信息区 | 左：标题（单行省略）+「第 N 集 · 已看 X% · 来源」；右：36px 琥珀圆形播放按钮 |
| 进度条 | 贴封面底部内侧，3px 高，琥珀填充 |
| 操作按钮 | 移除/收藏从右下角移到封面左上角（28px 深色小方框），呼应设计稿的 X |
| 组件拆分 | `VideoCardMeta` 内新增 `ui-video-footer-text` 包裹层，便于横卡做左右布局 |

### 保活的功能（逐项实测）

| 检查 | 结果 |
| --- | --- |
| 封面点击播放 | 悬停出现琥珀圆钮，点击进入 `/play?...&from=playrecord` ✓ |
| 圆形按钮 | `aria-label='继续播放 X'` 保留，点击行为不变 ✓ |
| 悬停操作 | 琥珀描边 + 左上角移除/收藏按钮 opacity 1 ✓ |
| TV 焦点 | 方向键落到 `继续播放 X`，卡片外框 3px 琥珀焦点环（offset 4px）✓ |
| TV 按钮尺寸 | 64px 高、整行宽、字号 22–26px ✓ |
| TV 进入 | Enter 跳 `/play?...&tv=1`，tv 参数保留 ✓ |
| 移动端 | 卡片满宽、圆形按钮保持 36px ✓ |
| 播放历史页 | 不受影响（独立行布局）✓ |

### 顺手修正

侧栏「播放历史」计数原来数的是记录条数（同一作品的多个分集键会被重复计入），与历史页显示的条数不一致（侧栏 2 vs 列表 1）。改用 `buildContinueWatchingRecords` 按作品分组后计数，两边现在一致。

### 验证

`tsc` + ESLint + **Jest 144 套件 / 1264 用例全绿**；截图 `after-p6d-*.png`（暗色 1440 / 悬停态 / 移动 390 / TV 1920 含焦点环 / 播放历史 1440）。

---

## 8.19 首页布局对齐设计稿（P6c，已完成）

| 项 | 改法 |
| --- | --- |
| 首页大标题 | 移除可视的「首页 + 副标题」块；保留 `sr-only` 的 h1（无障碍与现有测试都依赖 level 1 标题） |
| 分类位置 | 电影 / 剧集 / 综艺 从页头右上移到「片库频道」行右侧（描边胶囊 + 箭头），与设计稿一致 |
| 区块顺序 | 调整为 Hero → 片库频道 → 继续观看 → 热门电影 / 剧集 / 综艺 |
| 字体 | 片库频道标题改为无衬线 20px/600，与「热门电影」等区块标题同级；TV 下 36px |

验证：`tsc` + ESLint + **Jest 144 套件 / 1264 用例全绿**；截图 `after-p6c-*.png`（桌面 1440、移动 390、TV 1920）。

---

## 8.18 P6 差异补齐（已完成）

针对 §8.17 列出的「已知差异」逐项处理：

| 差异 | 处理 | 说明 |
| --- | --- | --- |
| 首页无 hero | 接入 `HomeHero`：左侧今日私人放映 + 衷线大标题 + 豆瓣评分/年份/类型 + 「立即播放 / 查看片单」；右侧海报列带遮罩淡出 | 仅 ≥768px 渲染（`useMediaQuery`）。`page.test.tsx` 有「首页不应出现推荐 banner」的断言，jsdom 无 matchMedia 时自动不渲染，因此两侧都不冲突 |
| 侧栏无计数 | 新增 `useLibraryCounts`：读取收藏与播放记录条数，并监听 `favoritesUpdated` / `playRecordsUpdated` 自动刷新 | 折叠态不显示 |
| 搜索框无 AI 入口 | 顶栏搜索框内加入「✨ AI 找片」，保留当前输入作为 `q`，跳 `/search?mode=ai&q=...` | 与搜索页分段控件并存 |
| 账号胶囊无用户名 | 顶栏账号按钮改为胶囊 + 用户名（来自 `RUNTIME_CONFIG.CURRENT_USER`），未登录显示“未登录” | 仍保留 `aria-label='账号菜单'` |
| 播放器控件是白灰 | `.art-video-player { --art-theme: accent }`，进度条与设置项激活态跟随瓃珀 | 仍使用 ArtPlayer 内置控件布局 |
| 搜索结果无评分 | **未处理**：`SearchResult` 是否有 `rate` 取决于第三方源，确实拿不到时无法凭空补 | 已展示的部分源评分正常 |

### 验证

- `tsc`、ESLint、**Jest 144 套件 / 1264 用例全绿**
- 浏览器实测（暗色 1440）：hero 渲染、侧栏计数 `0 / 1`、顶栏 AI 链接跳 `/search?mode=ai`、账号显示 `admin`、播放器 `--art-theme` 为 `rgb(229 169 60)`
- TV 1920：hero 放大到 460px 高、标题 64px、CTA 64px
- 移动 390：hero 不渲染（保持卡片流）；AI 入口仍在
- 截图：`.scratch/ui-refresh/after-p6b-*.png`

---

## 8.17 P6 品牌改名与全量验收（已完成）

### 品牌改名

| 位置 | 处理 |
| --- | --- |
| `lib/config.ts`（4 处） | `SiteName` 默认值 → `ReelFind` |
| `app/layout.tsx`（2 处） | metadata 与运行时配置的默认站点名 → `ReelFind` |
| `app/login/page.tsx` | 顶栏字标、kicker、按钮文案全部改读 `useSite().siteName` |
| `app/warning/page.tsx` | 标题 → `安全警告 - ReelFind` |
| `.env`（本地） | `SITE_NAME=ReelFind`；`manifest.json` 重新生成 |
| `SiteProvider` | 默认值**仍保留** `KatelyaTV`：它是测试环境无 Provider 时的兼容兑底（login 页测试断言“进入 KatelyaTV”） |
| `api/tvbox` 内置源名 | 保持不动，避免影响已保存的播放记录与源偏好键 |

### 全量验收结果

| 检查 | 结果 |
| --- | --- |
| 页面标题 / 字标 | 首页、登录、设置、警告页均为 `ReelFind`：字标为衷线体 |
| 登录页 | 标题 `ReelFind`、按钮 `进入 ReelFind`、kicker `ReelFind · Private Screening` |
| 暗色 1440 | 首页 / 搜索 / 豆瓣 / 历史 / 收藏 / 播放 / 设置 / 管理面板全部渲染正常 |
| 亮色 1440 | 首页 / 豆瓣 / 搜索 / 登录正常，暖白纸感与斗黑胶囊生效 |
| 移动 390 | 首页 / 搜索 / 设置正常，底栏激活项瓃珀 |
| TV 1920 | 首页 / 豆瓣 / 搜索 / 历史 / 播放全部 10-foot 渲染，分类导航只 1 个 |
| TV 遥控 | Tab + 方向键可跨行落到卡片，Enter 打开 `/play?...&tv=1` |
| TV 退出 | 播放页「退出电视模式」按钮切到 `tv=0`；浏览页分类切保持 `tv` 参数 |
| 回归测试 | `tsc` + ESLint + **Jest 144 套件 / 1264 用例全绿** |

截图：`.scratch/ui-refresh/after-p6/`（共 20 张，覆盖上表所有组合）。

### 与设计稿的差异（已知、已接受）

| 项 | 说明 |
| --- | --- |
| 首页无 hero | 已确认不新增功能；用「继续观看」横向卡承担首屏重量 |
| 侧栏无计数 | 设计稿收藏/历史旁有数字，需额外取数，未做 |
| 搜索框无 AI 按钮 | 设计稿顶栏搜索框内嵌「AI 找片」快捷入口；目标把 AI 放在搜索页分段控件里 |
| 搜索结果无评分 | 大多数第三方源不返回豆瓣分，仅有部分源能显示 |
| 账号胶囊 | 设计稿显示用户名，目标顶栏保持图标按钮 |
| 播放器控件 | 仍为 ArtPlayer 内置控件（白灰图标），只统一了外壳与页面配色 |

---

## 8.16 临时用户实测与管理开关统一（P4h，已完成）

### 临时用户验证（已清理）

用 UI 创建 `ui-temp` 后截图确认行内操作按钮，然后通过「删除用户」删掉；Redis 中 `admin:config` 已只剩 `admin`，总用户数回到 1。

| 检查项 | 结果 |
| --- | --- |
| 行内操作按钮 | 修改密码 / 设为管理（琥珀）、封禁 / 删除用户（红） |
| 暗色表现 | 透明底 + 描边 + 语义色文字，不再是发灰色块 |
| 删除确认弹窗 | 深色弹窗、琥珀警告图标、确认/取消按钮层级正常 |
| 删除后列表 | 无需刷新页面，行与总用户数立即更新 |

### 注册开关统一

「允许新用户注册」原来是自己写的一整套 Tailwind 开关（滑块用 `--ui-surface`，暗色下像黑块），现在直接改用共用 `Switch` 组件（44×24、白色滑块、琥珀开启态），并将 `id='admin-allow-register'` 下放到 Switch，保持 `<label for>` 关联与无障碍测试可用。

### 顺手修掉的一个真 bug

删除/添加用户后列表不刷新，必须整页 reload：

- `fetch('/api/admin/config')` 未禁用缓存；且开发环境各路由模块独立，写操作里的 `invalidateAdminConfigCache()` 不会影响到另一个路由实例
- 修法：`/api/admin/config` 改为 `cache: 'no-store'`，并在 **development** 下读取前主动 `invalidateAdminConfigCache()`（仅开发环境，不影响线上语义）

### 回归验证

- `tsc`、ESLint、**Jest 144 套件 / 1264 用例全绿**
- 浏览器实测：添加 `ui-temp` → 行内按钮出现 → 删除 → 列表与计数立即变回 1
- 截图：`.scratch/ui-refresh/after-p4h-*.png`

### 遗留说明

- 本地是 upstash 存储，注册开关被置为 disabled（与线上 D1 一致的限制），所以截图里只能看到灰色关态；开启态样式已在个人设置里验证
- 邀请码 / AI 用量仍显示存储未配置（upstash 适配器未实现），不影响样式结论

---

## 8.15 管理面板样式走查（P4g，已完成）

逐页走查了 内容与站点（站点配置 / 视频源配置）、用户与访问（用户配置 / 注册邀请码）、运行与诊断（AI 用量 / 播放调试日志），暗色与亮色都看过。

### 发现并修复的问题

| 页面 | 问题 | 修法 |
| --- | --- | --- |
| 视频源列表 | 批量选择 / 导入 / 导出 / 添加 四个按钮全部是琥珀实心，主次不分 | 前三者改描边次按钮，仅「添加」保留主按钮 |
| 视频源列表 | 排序/拖动按钮 44px，占掉半张表 | 压到 30px 描边小方框 |
| 视频源列表 | 表格行高与字号偏大，列被挤到横向滚动深处 | 表头/单元格 9×12、字号 12px、min-width 560 |
| 用户列表 | “添加用户”是主按钮，但展开表单后文字变“取消”仍是主色 | 降为描边次按钮；表单内的「添加」才是主按钮 |
| 站点配置 | “保存”按钮 44px 且样式与工具栏不一致 | 换成主按钮的 compact 尺寸（32px） |
| 诊断 / 邀请码 | 刷新类按钮都是实心琥珀 | 统一为描边次按钮 |
| 站点配置 | “播放调试模式”复选框在暗色下是浏览器原生白块 | `appearance: none` + 18px 描边方框，勾选时琥珀底 + 白色对勾 |
| 邀请码 / 表格 | 行内操作胶囊形状、大小不统一 | 表格内按钮统一 26px 高 / 6px 圆角 / 描边，保留语义色 |

### 验证

- `tsc`、ESLint、**Jest 144 套件 / 1264 用例全绿**
- 截图：`.scratch/ui-refresh/after-p4g-*.png`（内容/视频源/用户/邀请码/诊断，暗色 + 亮色）

### 走查中有意保留 / 暂时无法验证

- **表格横向滚动**：视频源表列多（排序/名称/KEY/API/详情/状态/操作），720px 内容区装不下；`role=region` 已声明可横向滚动，暂不强行压缩导致内容截断
- **行内操作按钮**：本地只有 admin 一个用户，站长不能操作自己，所以看不到「修改密码/取消管理/封禁/删除」；已用 CSS 统一尺寸与形状，建议后续用第二个账号实测一次
- **注册邀请码 / AI 用量**：Upstash 适配器未实现这两块存储，本地显示“存储未配置”；属于存储能力差异，不是样式问题（线上 D1 正常）

---

## 8.14 本地开启站点管理并回归管理面板样式（P4f，已完成）

### 为什么本地看不到「站点管理」

`UserMenu` 的门控是 `role === 'owner' || role === 'admin'`，而 `/api/login` 在 `NEXT_PUBLIC_STORAGE_TYPE=localstorage` 时只会发 `role: 'user'`。所以不是样式缺失，是单用户模式不支持后台。

### 本地开启方式（不修改任何源码）

1. 启动 Redis 容器：`docker run -d --name katelya-redis -p 6379:6379 redis:7-alpine`
2. 启动 Upstash REST 代理（让 edge runtime 能访问 Redis）：
   `docker run -d --name katelya-srh -p 8079:80 -e SRH_MODE=env -e SRH_TOKEN=devtoken -e SRH_CONNECTION_STRING=redis://host.docker.internal:6379 hiett/serverless-redis-http:latest`
3. worktree 的 `.env`：
   - `NEXT_PUBLIC_STORAGE_TYPE=upstash`
   - `UPSTASH_URL=http://127.0.0.1:8079`
   - `UPSTASH_TOKEN=devtoken`
4. 重启 dev server，用 `USERNAME=admin` + `PASSWORD` 登录 → `role: owner` → 设置面板出现「站点管理」三组

> 为什么不用 `redis` 存储类型：`/api/login` 跑在 edge runtime，`@redis/client` 在 edge 下会报 `url_1.URL is not a constructor`；`upstash` 走 REST，edge 兼容。
>
> 原配置备份在 `/tmp/reelfind-env-localstorage.bak`；不想开后台时改名回去并停掉两个容器即可。

### 管理面板实测结果

设置项均能正常渲染（内容与站点 / 用户与访问 / 运行与诊断），发现并修掉 4 处与新视觉不一致的地方：

| 问题 | 修法 |
| --- | --- |
| 管理员开关的滑块用 `--ui-surface`（深色）叠在深色轨道上，看起来像黑块 | 统一为 44×24 轨道 + 白色 18px 滑块，开启态琥珀 |
| `input[type=checkbox]` 被强制 44×44 | 恢复 18px，保留琥珀 accent-color |
| 「重置配置」是暗红小胶囊，不像按钮 | 改为危险态描边按钮（与退出登录一致） |
| 表格无容器、表头无区分度 | 加发丝描边容器，表头用 surface-strong + muted 12px，行间发丝线 |

### 回归验证

- `tsc`、ESLint、**Jest 144 套件 / 1264 用例全绿**
- 浏览器实测：owner 登录成功（`/api/session` 返回 `role: owner`）；三组管理分类均可切换与渲染；个人三区样式无回退
- 截图：`.scratch/ui-refresh/after-p4f/`（owner 导航、账号、内容与站点、用户与访问、运行与诊断、亮色账号）

---

## 8.13 设置面板升级与线上设置项对照（P4e，已完成）

### 线上部署（movie.sigclr.com）实际设置清单

登录后实测（1440 宽）：

| 分组 | 内容 |
| --- | --- |
| 个人设置 · 外观与设备 | 外观（旧版图标按钮）、进入电视模式 |
| 个人设置 · 观看与收藏 | 我的收藏、播放历史 |
| 个人设置 · 账号与安全 | admin / 站长 / 数据存储：d1 / 退出登录 |
| 站点管理 · 内容与站点 | 站点配置（站点信息、搜索与缓存、图片与豆瓣服务、诊断记录：播放调试模式）、视频源配置、重置配置、保存 |
| 站点管理 · 用户与访问 | 用户配置（注册开关、注册邀请码、总用户数）、用户列表（添加/修改密码/取消管理/封禁/删除） |
| 站点管理 · 运行与诊断 | AI 找片用量（今日识别/加载、每日趋势、用户与 IP 排行）、播放调试日志 |

### 本地为何“少了一些设置”

不是样式或代码缺失，而是**角色门控**：

- `showAdminPanel = role === 'owner' \|\| role === 'admin'`（`UserMenu.tsx`）
- 本地 `NEXT_PUBLIC_STORAGE_TYPE=localstorage` 时，`/api/login` 密码正确就直接发 `role: 'user'`，因此永远不渲染「站点管理」
- 线上是 D1 + 用户名登录，所以能看到三组管理分类

如果本地也想验证管理面板视觉：把 `NEXT_PUBLIC_STORAGE_TYPE` 改成非 localstorage，并配置 `USERNAME` / `PASSWORD`，用用户名密码登录即可拿到 owner。

### 本轮改造

| 区域 | 改法 |
| --- | --- |
| 共用控件 | 新增 `Switch`（44×24，`role=switch`）、`SettingsRow`（图标 + 标题/说明 + 控件/箭头，支持链接/按钮/信息行）、`ThemeSwitch`（next-themes + 可选 View Transition） |
| 外观与设备 | 深色外观改为 Switch；电视大屏模式改为整行开关（`aria-label` 保留“进入/退出电视模式”，兼容现有测试） |
| 观看与收藏 | 新增 `lib/ui/preferences.ts` 偏好定义（`defaultAggregateSearch` / `enableOptimization`）；收藏/历史改为统一链接行；搜索页与播放页改读同一源 |
| 账号与安全 | 首字母头像 + 用户名 + 角色胶囊 + 存储说明的账号卡片；退出登录改为危险态描边按钮 + 说明 |

### 回归测试

- `tsc`、ESLint 通过
- **Jest 144 套件 / 1264 用例全绿**（新增 `preferences.test.ts`、`settings-controls.test.tsx`）
- 浏览器实测：深色开关 dark→light ✓；聚合开关写入 `defaultAggregateSearch=false` ✓；优选开关写入 `enableOptimization=false` ✓；电视模式链接 `/?tv=1` ✓
- 截图：`.scratch/ui-refresh/after-p4e/`（外观/观看与收藏/账号、暗亮、移动）；线上对照图 `.scratch/ui-refresh/live-settings-*.png`

### 一个真实修掉的 bug

`ThemeSwitch` 最初无条件调用 `startViewTransition`，在后台/不可见窗口里回调可能不执行，导致开关点了不变。
修复：仅在页面可见、未开启减少动效且 API 存在时使用 View Transition，其余情况直接 `setTheme`，并加 try/catch 回退。

---

## 8.12 登录页与设置面板（P4d，已完成）

### 登录页

| 项 | 改法 |
| --- | --- |
| 页面骨架 | 改为 flex 列 + 卡片垂直居中，与设计稿的全屏居中弹窗一致 |
| 左栏故事图 | 从「小插画 + 文字堆叠」改为整幅铺满的影视剧照背景 + 渐变遮罩 + 颗拉发光；用 `hue-rotate(172deg)` 把原本的蓝色光束搅成暖琥珀色，不新增二进制资源 |
| 故事文案 | 新增专业向 kicker（等宽大写字母）、衷线标题、描述，底部一行等宽字体的「4K HDR / 跨设备同步」 |
| 表单区 | 衷线标题、分段式登录/注册切换（激活项浮起白卡）、输入框 44px / 8px 圆角 / 琥珀聚焦环、CTA 44px |
| 顶栏 | 品牌换成“色块 + 衷线字标”，电视模式按钮改为胶囊样式 |
| 电视模式 | 左栏自动隐藏、标题 40px、控件 64px 保留（原有 TV CSS 规则未动） |

### 设置 / 账号面板

| 项 | 改法 |
| --- | --- |
| 弹窗尺寸 | 从 1080×760 收窄到 920×680（接近设计稿的 `max-w-3xl` 比例） |
| 头部 | 标题 18px，保持 56px 高细分割线 |
| 左侧分类 | 底色用侧栏 token，分类标签 12px，激活项亮色墨黑 / 暗色琥珀实色胶囊 |
| 内容区 | 分组标题 16px、行高 14px padding、行间发丝分割线、最后一行去边框 |
| 移动端 | 分类行退化为下拉选择，面板留出底部导航空间 |

### 回归测试

- `tsc`、ESLint、**Jest 142 套件 / 1258 用例全绿**
- 浏览器实测：
  - 登录：勾选保持登录 → 输密码 → 提交 → 跳转 `/` ✓
  - 登录页 TV：左栏隐藏、标题 40px、琥珀焦点环正常 ✓
  - 设置：打开面板 → 切换到「观看与收藏」（外观分组隐藏）→ 关闭后弹层卸载 ✓
- 截图：`.scratch/ui-refresh/after-p4d/`（登录暗/亮/移动/TV、设置暗/亮/移动）

### 一个环境坑（不是产品 bug）

设置面板用 `requestAnimationFrame` 做渐显。在后台/未聚焦的自动化窗口里 rAF 会被节流，1.2s 内截图会看到 `opacity: 0` 的“透明面板”；等一帧真正到来后就是 1。后续截图统一等 ≥2.5s。

---

## 8.11 搜索结果卡补评分字段（P4c，已完成）

### 数据链路

| 层 | 改动 |
| --- | --- |
| 下游接口 `lib/downstream.ts` | `ApiSearchItem` 新增 `vod_douban_score`；新增 `normalizeDoubanScore()`（只接受 0 < score ≤ 10，统一一位小数）；搜索与详情两条映射都带上 `rate` |
| 类型 `lib/types.ts` | `SearchResult` 新增可选 `rate?: string` |
| 搜索页 `app/search/page.tsx` | 聚合卡从同组多条来源中取第一个有评分的；分源列表直接用本条的 `rate` |
| 卡片 `VideoCard` | 结果卡标题行改为「名称左 + 豆瓣评分右」；评分只出现在文字行，封面不再渲染评分角标 |

### 验证

- `tsc`、ESLint 通过
- Jest：**142 套件 / 1258 用例全绿**（含本次新增 2 个测试文件）
- 新增测试：
  - `lib/douban-score.test.ts`：合法值 8.6 / 7.9 / 9 → `9.0`；空值、0、10.5、“暂无”全部丢弃
  - `components/__tests__/video-card-rating.test.tsx`：结果卡渲染 `豆瓣 7.9`；海报卡只出现一个 `8.6` 且类名为 `ui-video-score`
- 浏览器实测（禁用 HTTP 缓存后）：`庆余年 第二季 → 豆瓣 7.3`、`第一季 → 7.9`；豆瓣页 25 张卡全部有页脚评分，封面零角标

### 一个容易误判的坑

`/api/search` 带 `Cache-Control: public, max-age=…`，所以刚改完接口时旧查询词会拿到**浏览器缓存里没有 rate 的旧响应**，看起来像“没生效”。
验证时必须禁用缓存或换一个新查询词；生产环境缓存过期后也会自然恢复。

---

## 8.10 卡片解剖对齐设计稿（P4b，已完成）

### 设计稿的真实结构

对照 `DiscoverView` 与 `HomeView` 源码后确认：

- **海报卡**：只有封面有描边与圆角，文字区在描边**之外**；一行是「名称左 + 评分右」，下一行是「年份 · 线路数」等元信息
- **继续观看卡**：整张卡片有描边，封面满出血，信息区带内边距

P4a 曾把海报卡做成「整卡描边 + 内嵌信息区」，与设计稿不符，本轮推翻重做。

### 落地内容

| 项 | 改法 |
| --- | --- |
| 海报卡描边 | 回到只描封面，文字区在描边外（`margin-top: 10px; padding-inline: 2px`） |
| 信息区第一行 | `ui-video-footer-head`：名称左、评分右（等宽字体 + 琥珀色，右对齐不换行） |
| 信息区第二行 | `ui-video-footer-meta`：类型 · 年份 · 集数 · 来源，等宽字体 muted 色、单行省略 |
| 重复信息 | 图片右上角的评分角标在海报卡隐藏（评分只在文字行出现一次） |
| 类型数据 | 首页与豆瓣页向 `VideoCard` 传入 `typeName`（电影/剧集/综艺） |
| 继续观看卡 | 保留整卡描边，副标题仍为单行文本「第 N 集 · 已看 X% · 来源」 |
| 搜索卡 | 维持列表结构（无评分字段，保留类型/年份/状态/来源行） |

### 验证

- Jest：**140 套件 / 1254 用例全绿**
- 浏览器实测：卡片信息区为 `可能的爱 / 8.6 / 电影 · 2026`；点击文字标题仍能跳到正确 `/play?...source=bfzy&id=171647`
- 截图：`.scratch/ui-refresh/after-p4b/`（豆瓣电影暗亮、首页暗色、首页卡片细节、移动端、TV 焦点态、搜索、收藏、历史）

### 两个测试约束

1. 搜索卡的 typeName / year / statusText / 来源必须能分别用 `getByText` 找到 → 第二行用分开的 `<span>` 拼接，而不是一整段字符串
2. 继续观看卡的副标题被断言为完整字符串 `第 18 集 · 已看 40% · 测试源` → 横卡保持单一文本节点，不用 span 拆分

---

## 8.9 P4a 结构改造（已完成）

### 1. 片库类型切换入标题行

- Web：`/douban` 的 电影 / 剧集 / 综艺 从「页面上方独立导航条」改为 `PageHeader` 的 `action` 位置，即标题右侧胶囊组，与设计稿一致
- TV：仍由 `AppShell` 在页面顶部渲染分类导航（遥控焦点路径不变），页面内不再重复渲染，`nav[aria-label='影片分类']` 始终只有 1 个
- 新增样式类 `.ui-kind-switch`（三态胶囊：默认 / hover / 激活填充），TV 下单独放大到 64px / 26px

### 2. 播放卡片结构重塑

| 项 | 改造前 | 改造后 |
| --- | --- | --- |
| 卡片边界 | 只有封面有描边，标题在卡片外 | 整张卡片（封面 + 信息区）由同一个 1px 描边容器包裹，信息区 12/14px 内边距 |
| 悬停 | 无 | 整卡描边变琥珀 50% |
| 播放按钮 | 大号半透明 `PlayCircleIcon` | 44px 琥珀圆形按钮，悬停放大 1.04 |
| 进度条 | 封面下方独立一条 | 移入封面底部内侧（白色 22% 轨道 + 琥珀填充） |
| 继续观看横卡 | 封面与信息分隔 | 封面满出血，信息区内边距统一 |
| `CardActions` | 直接拼接 className，无法覆盖定位 | 改用 `tailwind-merge`，允许调用方覆盖定位类 |

代码层面：`VideoCard` 新增 `ui-video-card-poster` / `ui-video-frame` / `ui-video-footer` / `ui-video-progress-inline` 语义类，逻辑（点击、收藏、删除、换源、TV 焦点）零改动。

### 3. 结构变更的功能回归（均通过）

| 检查项 | 方式 | 结果 |
| --- | --- | --- |
| 分类切换 | 点击「剧集」 | URL 变 `?type=tv&tv=0`，激活态为剧集 ✓ |
| 卡片点击 | 点击首张海报 | 跳转 `/play?title=可能的爱&year=2026&stype=movie` ✓ |
| 悬停态 | 鼠标悬停首卡 | 描边变琥珀、遮罩 opacity 1、播放按钮可见 ✓ |
| 搜索展开来源 | 点击「展开来源」 | 渲染 1 个面板 + 3 张来源卡 ✓ |
| TV 遥控焦点 | `?tv=1` 连按 ArrowDown | 焦点落在 `打开 … 海报` 按钮上，`closest('article')` 成立 ✓ |
| TV 分类导航 | `/douban?type=tv&tv=1` | `nav[aria-label='影片分类']` 个数 = 1 ✓ |
| 单元测试 | Jest 全量 | 140 套件 / 1254 用例全绿 ✓ |

### 4. 过程中遇到的测试约束

`components/__tests__/app-shell.test.tsx` 断言「TV 模式下 `AppShell` 必须渲染电影/剧集/综艺链接」。
所以分类导航不能从 `AppShell` 完全移除：最终采用「TV 由 shell 渲染、Web 由页面标题行渲染」的双路径，两边不会重复。

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
