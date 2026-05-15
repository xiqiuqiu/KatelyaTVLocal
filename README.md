<div align="center">
  <img src="public/logo.png" alt="KatelyaTV Logo" width="128" />

  <h1>KatelyaTV</h1>
  <p><strong>跨平台 · 聚合搜索 · 即开即用 · 自托管影视聚合播放器</strong></p>
  <p>基于 <code>Next.js 14</code> · <code>TypeScript</code> · <code>Tailwind CSS</code> · 多源聚合 / 播放记录 / 收藏同步 / 跳过片头片尾 / PWA / HLS 广告过滤</p>
  <p>MoonTV 二创延续版 · 持续维护与增强</p>

  <p>
    <a href="#🚀-功能特性">✨ 功能</a> ·
    <a href="#-部署方案">🚀 部署</a> ·
    <a href="#🐳-docker-单容器推荐新手">🐳 Docker</a> ·
    <a href="#️-tvbox-兼容功能">📺 TVBox</a>
  </p>
</div>

## 📰 项目声明

本项目自「MoonTV」演进而来，为其二创/继承版本，持续维护与改进功能与体验。保留并致谢原作者与社区贡献者；如有授权或版权问题请联系以处理。目标：在原作基础上提供更易部署、更友好、更稳定干净的体验。

> **🔔 重要通知**：为确保合规性并保证系统稳定运行，我们已移除内置源。用户需自行配置资源站或使用社区推荐的配置文件（见文末）。

---

## 🚀 功能特性 (最新进展)

### 🛡️ 播放优化与去广告 (New!)
- **HLS 广告过滤拦截**：实时解析并过滤 .m3u8 视频流中被劫持插入的切片广告。
- **智能跳过**：自动检测并跳过片头片尾，支持手自一体设置。
- **播放源定时体检与优选**：集成基于 Cloudflare D1 + Cron 的机制对数据源进行健康监测，自动过滤死链并实现无缝流跳转。

### 🎬 核心播放体验
- **聚合搜索**：多站资源一键检索。
- **高清跨屏播放**：基于 ArtPlayer 强力驱动，完美适配移动端、平板及PC大屏。
- **断点记录**：自动记录播放进度，跨设备无感续播。

### 💾 丰富的数据后台
多设备用户数据支持多种数据后端进行存储：
- 本地浏览器 (LocalStorage)
- 远端服务器 (Redis / Kvrocks / Upstash)
- Cloudflare原生数据栈 (D1)

### 📺 TVBox 兼容功能
支持将全站解析库及影视资源一键导出供 TVBox 盒子使用 (/api/tvbox?format=json 或 base64 格式)。

---

## 📋 技术栈

| 构建部分 | 技术及框架 |
| - | - |
| 核心框架 | Next.js 14 (App Router), TypeScript 5 |
| UI 设计 | Tailwind CSS 3, Framer Motion |
| 播放引擎 | ArtPlayer, HLS.js |
| 存储池 | LocalStorage, Redis, Kvrocks, Cloudflare D1 |

---

## 🚀 部署方案

### 🐳 Docker 部署系列

#### 1. Docker 单容器（推荐新手）
**最轻量配置**，无外接数据库需求：
`ash
docker run -d --name katelyatv -p 3000:3000 \
  --env PASSWORD=your_password \
  --restart unless-stopped \
  ghcr.io/katelya77/katelyatv:latest
`

*自定义资源站（挂载配置文件）*:
`ash
docker run -d --name katelyatv -p 3000:3000 \
  --env PASSWORD=your_password \
  -v /path/to/config.json:/app/config.json:ro \
  --restart unless-stopped \
  ghcr.io/katelya77/katelyatv:latest
`

#### 2. Docker + Redis （推荐服务器用户）
通过 Docker Compose 提供**完善的用户数据隔离与鉴权存储**：
> 参考项目内的 docker-compose.yml 范例（结合 NEXT_PUBLIC_STORAGE_TYPE=redis 配置项）。

#### 3. Docker + Kvrocks（高可靠性生产环境）
适合**极大体量且需磁盘级可靠化**存储的用户，内存节省更佳。配置见 docker-compose.kvrocks.yml。

### ☁️ 云平台免维护部署

#### Vercel（极致免维护）
直接 Fork 仓库一键 Vercel Deploy，配置环境变量 PASSWORD=你的密码 即可。

#### Cloudflare Pages + D1 (极力推荐进阶用户)
利用 Cloudflare 网络分发及原生数据库，支持定时任务与播放优选服务：
1. **D1 初始化**：使用 migrations/2026-05-09_cloudflare_source_ranking.sql (以及之前初始化的表) 对数据库进行填充。
2. **环境变量配置**：
   - PASSWORD=XXX 
   - NEXT_PUBLIC_STORAGE_TYPE=d1
   - SOURCE_RANKING_ENABLED=true (启用源优选)
3. **Cron Worker 配置**：利用 workers/source-ranking-cron 定时唤醒主站探测存活。详见项目下 [Cloudflare Source Ranking 配置文档](docs/CLOUDFLARE_SOURCE_RANKING.md)。

---

## 📂 获取推荐资源站

为了方便新手快速测试系统：
- [标准配置文件 (config.json)](https://www.mediafire.com/file/xl3yo7la2ci378w/config.json/file)
- [扩展配置文件 (configplus.json)](https://www.mediafire.com/file/fbpk1mlupxp3u3v/configplus.json/file)

> **免责条款**：资源站配置仅为方便系统测试与协议联调使用；部分资源站可能不受控制地植入切片广告或变动服务。我们不对任何通过自定义配置访问的第三方视频源内容合法性及稳定性负责。

