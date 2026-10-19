# 电视 WebView APK 可行性调查

日期：2026-10-06。代码基线：`main` / `1cd2821`。本轮仅调查，未创建 Android 工程或构建 APK。

## 结论与范围

暂按“安装到创维电视上”理解；若实际目标是 Windows/macOS 电脑，需要另一种桌面打包方案，不能直接把安卓 APK 当成桌面安装包。

建议采用 Android WebView 薄壳，加载 `https://movie.sigclr.com/?tv=1`。优先复用可修改的开源模板，再补电视宿主交互，不默认从零手写。复用现有电视页面、ArtPlayer、hls.js 和服务端 API，不另写播放器。WebView 可以在 Activity 中显示网页，默认不带浏览器地址栏，这是方案的官方平台依据；是否适合本项目仍须真机验证。[Android WebView 指南](https://developer.android.com/develop/ui/views/layout/webapps/webview)

结构：电视桌面入口 → Android 壳 → 线上 TV Mode 网页 → 现有后端与视频源。

网页改动通常只需部署网站；壳的改动需要更新 APK。仍依赖网络和现有服务，不提供离线视频播放。

## 已有证据

- `docs/specs/tv-playback-interaction.md` 记录 Q7F Pro 的 Android 13、`8R710_Q7FP` 和 Chromium `101.0.4951.61`，以及网页 HLS 1080P 播放、遥控器交互的用户验收反馈。早期研究中“系统未知”的结论已被此后证据补充。
- `docs/adr/0008-tv-mode-as-playback-interaction-adapter.md` 要求共享播放底层，不引入第二播放器或第二套全屏控制层。
- `src/app/play/page.tsx` 的 TV Mode 已保留 ArtPlayer `fullscreenWeb`、隐藏系统视频全屏。壳可使用全屏窗口，继续保留网页全屏控件和现有焦点逻辑。
- `src/app/api/login/route.ts` 使用 HttpOnly 登录 Cookie；`src/lib/db.client.ts` 存在 localStorage 模式。新壳的登录和本地数据不能假定与第三方浏览器共享。官方指南也明确浏览器的数据不与宿主应用共享。[WebView 数据边界](https://developer.android.com/develop/ui/views/layout/webapps/webview)

## 为什么不先加跨平台框架

| 方案                      | 取舍                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 原生 Android WebView 薄壳 | 推荐。目标只有电视启动入口和网页宿主，直接使用平台能力。                                                                                   |
| Capacitor                 | 暂不引入。仅加载线上站点时收益有限，官方将 `server.url` 标为开发 live reload 用途，不建议生产使用；不代表 Capacitor 不能用于其他生产架构。 |
| OrionTV                   | README 已列出后端对接方式，但它是另一套客户端，不能直接沿用本轮电视网页和播放器交互；仅作备选。                                            |

依据：[Capacitor 配置](https://capacitorjs.com/docs/config)、项目 `README.md` 的 Android TV 集成说明、[OrionTV 官方仓库](https://github.com/orion-lib/OrionTV)。

不把当前 Next.js 项目强行导出成离线网页：代码依赖请求、登录 Cookie、Middleware 和动态 API。Next.js 14 静态导出不支持这些动态能力；最小方案是保留现有部署。[Next.js 14 静态导出限制](https://nextjs.org/docs/14/app/building-your-application/deploying/static-exports)

## 壳必须处理的事情

1. **启动入口**：提供图标、横屏全屏窗口，声明普通 `LAUNCHER` 和电视 `LEANBACK_LAUNCHER`，不要求触屏，Leanback 特性不设为必需。官方 Android TV 支持电视入口及图标/banner 配置，但不能据此保证创维定制桌面展示一致。[Android TV 应用入口](https://developer.android.com/training/tv/get-started/create)
2. **网页运行**：声明网络权限，开启 JavaScript、DOM storage，保留 Cookie 和硬件加速，明确媒体是否需要用户手势。JavaScript 默认关闭；这些媒体/存储配置由 WebSettings 提供。[WebView 指南](https://developer.android.com/develop/ui/views/layout/webapps/webview)、[WebSettings API](https://developer.android.com/reference/android/webkit/WebSettings)
3. **遥控器**：优先让真实方向键和确认键进入 WebView，沿用网页导航。先记录事件，不能照搬第三方浏览器固定坐标点击的假设，或把一次确认合成两次激活。[Android TV 导航与测试要求](https://developer.android.com/training/tv/get-started/navigation)
4. **返回与输入法**：先让输入法处理关闭，再让网页处理浮层、设置和退出网页全屏，最后才返回页面历史或退出应用。已有 `returnFromTvPlayer`、TV 浮层返回逻辑需通过窄接口协调；不能只调用 `WebView.goBack()`。接口仅限可信站点，不新增通用原生能力桥。这是项目交互基线推导的设计要求，尚未实现。
5. **前后台及失败**：失去前台时按明确策略暂停，恢复时不重复创建播放会话；网络失败允许重试而非白屏，重新打开保留尚未过期的登录状态，退出应用不陷入返回循环。

正式壳仅加载可信 HTTPS 站点；顶层导航限制到站点域名，不能因此误拦第三方视频子资源。不忽略 TLS 错误、不写入登录密码、不全局放开混合内容或明文流量。局域网 HTTP 仅在开发构建按开发主机限定。原生桥存在安全边界，优先不引入或只做极窄通信。[WebView 原生桥安全](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges)

## 不能从现有测试推出的结论

- 浏览器 1080P 正常不等于新壳必然正常。实际 WebView 提供者可能不同；用 `getCurrentWebViewPackage()` 记录包名和版本，同时记录 UA、MSE、codec 能力和首帧/卡顿数据。提供者可以随系统配置或更新改变；该 API 也可能返回空。[WebView 提供者 API](<https://developer.android.com/reference/android/webkit/WebView#getCurrentWebViewPackage()>)
- APK 不会自动升级系统 WebView，也不会改善电视解码能力或网络条件。
- Android 13 不证明设备具有 Google Play、标准 Android TV 桌面或允许任意 APK 旁加载。用户已明确没有可用 ADB 调试入口，不以 ADB 为安装前提。
- 优先确认此前第三方浏览器的安装途径能否安装自签名 APK。U 盘、下载或应用市场的可用性必须实际确认，当前没有证据。

## 建议的下一步

经用户确认目标和安装途径后，优先基于开源模板做最小诊断 APK：只包含站点入口、必要返回协调和诊断，不重做 UI 或播放器。以下开源调查细化模板选择，尚未执行构建或接入。

验收顺序：安装/桌面入口 → 登录及重启保留 → 首页/普通搜索/AI 输入法 → 1080P 实际视频连续播放 → 网页全屏的确认、进度、设置、下一集、跳广告、自动隐藏/唤回 → 浮层返回 → 输入法返回 → 页面返回 → 应用退出及前后台恢复。

开发构建可打开局域网站点，复用仅开发环境的 `/api/tv-remote-debug` 采集网页行为；原生生命周期、按键及提供者信息需要另补最小日志。不能把现有网页日志宣称为原生崩溃监控或无 ADB 的系统调试能力。

## 开源方案复核（2026-10-06）

方法：互联网检索后直接读取第一方 GitHub 仓库、LICENSE、Manifest 和关键 Activity 源码。后台研究任务因额度上限中止，输出不完整；本节由主代理直接核对补充，不将后台部分结果当成完成的调查。没有运行下载的代码、安装工具或验证 APK，以下是源码层面的可行性判断，不是兼容性验收。

### 候选与维护快照

最后提交日期来自 GitHub commits API，只证明仓库有提交，不证明电视功能近期经过验收。日期按 UTC；所列仓库查询时均未归档。

| 项目                                                                                                      | 最近提交 / 许可           | 与当前需求的关系                                                                                                   | 判断                                                                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [SuperWebView](https://github.com/roozbehzarei/SuperWebView)                                              | 2026-09-19 / CC0-1.0      | 固定线上网页模板，已开启 JS/DOM storage，有视频全屏回调；Compose + shared 模块。没有电视入口，返回直接走网页历史。 | 优先作为可维护模板做小范围 TV 定制；不能原样视为电视壳。                          |
| [WebToApp](https://github.com/shiaho777/web-to-app)                                                       | 2026-10-06 / Unlicense    | 支持在安卓设备上生成网址 APK；壳的返回逻辑已先派发可取消 Escape，再退历史。构建器提供按配置重建权限。              | 快速打样备选，需检查实际生成 APK 的电视入口、权限、桥及方向键；不搬入整套生成器。 |
| [Halcyon Video 的 android-tv 模块](https://github.com/halcyon-video/halcyon-video/tree/master/android-tv) | 2026-10-05 / 仓库 GPL-3.0 | 已有全屏 WebView、普通/电视入口、遥控器键转发和错误重试，但为特定站点的 `/remote.html` 定制。                      | 最贴近电视宿主需求的参考；不能只改域名，复制代码前确认许可与分发要求。            |
| [TV Bro](https://github.com/truefedex/tv-bro)                                                             | 2026-07-29 / 自定义许可   | 成熟电视浏览器，已有电视入口及虚拟光标、标签、下载等。                                                             | 可作为浏览器对照测试，不推荐把整个浏览器裁剪成单站点 APP。                        |
| [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)                                              | 2026-07-31 / Apache-2.0   | 生成 TWA/PWA APK，不是自带独立内核的 WebView 壳。                                                                  | 暂不优先，Q7F Pro 的兼容浏览器提供者尚未确认，也未确认 TV 返回/焦点能力。         |

维护证据：[SuperWebView commits API](https://api.github.com/repos/roozbehzarei/SuperWebView/commits?per_page=1)、[WebToApp commits API](https://api.github.com/repos/shiaho777/web-to-app/commits?per_page=1)、[Halcyon commits API](https://api.github.com/repos/halcyon-video/halcyon-video/commits?per_page=1)、[TV Bro commits API](https://api.github.com/repos/truefedex/tv-bro/commits?per_page=1)、[Bubblewrap commits API](https://api.github.com/repos/GoogleChromeLabs/bubblewrap/commits?per_page=1)。API 最新值会随提交变化，源码链接固定在调查时的提交。

### 真正影响选型的源码差异

- **SuperWebView**：`MainActivity` 的 BackHandler 调用 `goBack()`；Manifest 只有普通 LAUNCHER，未声明触屏非必需。要补 TV banner/入口、横屏全屏窗口、网页优先返回与媒体策略，移除电视不需要的下拉刷新。域名导航判断使用字符串前缀，正式定制应按解析后的 scheme/host 精确匹配。不是仅修改网址即可交付。[Activity 源码](https://github.com/roozbehzarei/SuperWebView/blob/20c797732fb8c08feac01179190df12349373405/androidApp/src/main/kotlin/com/roozbehzarei/superwebview/MainActivity.kt)、[Manifest](https://github.com/roozbehzarei/SuperWebView/blob/20c797732fb8c08feac01179190df12349373405/androidApp/src/main/AndroidManifest.xml)、[URL 配置](https://github.com/roozbehzarei/SuperWebView/blob/20c797732fb8c08feac01179190df12349373405/shared/src/commonMain/kotlin/com/roozbehzarei/superwebview/shared/WebAppConfig.kt)。
- **WebToApp**：返回时向 document 派发 Escape 并检查是否被网页取消，这与本项目“先关闭网页控件”方向吻合。但壳模板 Manifest 未见 LEANBACK_LAUNCHER；存在 TvUtils 不能证明生成包已完成 TV 适配。模板列出大量权限，构建器会按配置生成权限，不能拿模板清单直接断言最终 APK 必须申请全部权限。后续须检查生成产物，不启用无关桥、广告拦截、网络改写或后台保活。[返回协调源码](https://github.com/shiaho777/web-to-app/blob/6d7b9dfcf62fcfd400af37bcd879179a7fd60e78/app/src/main/java/com/webtoapp/ui/shell/ShellActivityInit.kt)、[壳 Manifest](https://github.com/shiaho777/web-to-app/blob/6d7b9dfcf62fcfd400af37bcd879179a7fd60e78/shell/src/main/AndroidManifest.xml)、[构建器](https://github.com/shiaho777/web-to-app/blob/6d7b9dfcf62fcfd400af37bcd879179a7fd60e78/app/src/main/java/com/webtoapp/core/apkbuilder/ApkBuilder.kt)。
- **Halcyon**：方向、确认和返回经 `evaluateJavascript` 合成 KeyboardEvent，直接派发到 window。它自己的网页无可聚焦控件，不能据此推断所有 WebView 都吞方向键。我们的播放器快捷键监听 document，控件也依赖实际 DOM 焦点；原样复制 window 派发会漏掉该路径，并不能代替输入法输入或真实用户手势。还有站点地址重写及长按返回去设置的行为要移除/替换。[MainActivity](https://github.com/halcyon-video/halcyon-video/blob/e6d1735e69c9538e9a7a352aaaed70f00194d24b/android-tv/app/src/main/java/video/halcyon/tv/MainActivity.kt)、[模块 README](https://github.com/halcyon-video/halcyon-video/blob/e6d1735e69c9538e9a7a352aaaed70f00194d24b/android-tv/README.md)、[GPL LICENSE](https://github.com/halcyon-video/halcyon-video/blob/e6d1735e69c9538e9a7a352aaaed70f00194d24b/LICENSE)；本项目对照：`src/app/play/page.tsx`、`src/components/useTvBrowseNavigation.ts`。
- **TV Bro**：源码包含 CursorLayout 和电视 Manifest。虚拟鼠标是给未做 TV 适配的网站使用的，并非我们需要再加的交互层。许可证要求改版更名、换图标/包名并在 GUI 标注来源；不能当成普通 MIT 模板直接改名分发。[CursorLayout](https://github.com/truefedex/tv-bro/blob/6cb4b7c9be1bc2a231cc2590c184faa2be9c4ff3/app/common/src/main/java/com/phlox/tvwebbrowser/widgets/cursor/CursorLayout.kt)、[Manifest](https://github.com/truefedex/tv-bro/blob/6cb4b7c9be1bc2a231cc2590c184faa2be9c4ff3/app/src/main/AndroidManifest.xml)、[许可证](https://github.com/truefedex/tv-bro/blob/6cb4b7c9be1bc2a231cc2590c184faa2be9c4ff3/LICENSE.md)。
- **Bubblewrap**：TWA 依赖支持相应协议的浏览器及 Digital Asset Links；提供者不支持时可能降级显示 Custom Tab 工具栏。Q7F Pro 已能用某个浏览器不等于满足 TWA 前提，因此不能承诺一键打包就无工具栏。[Chrome TWA 官方说明](https://developer.chrome.com/docs/android/trusted-web-activity)、[Bubblewrap README](https://github.com/GoogleChromeLabs/bubblewrap)。

搜索还发现自动把网页媒体交给 ExoPlayer 的电视浏览器，例如 [mrowser](https://github.com/m-salehi-v/mrowser)。该架构偏离保留 ArtPlayer、广告跳过和播放历史共享逻辑的要求，本轮不作为打包基底；不接受其 README 对所有 WebView 播放品质的泛化描述。

### 更新后的建议

先用 SuperWebView 模板进行受控 TV 定制验证，Halcyon 仅作为宿主按键处理的参考；WebToApp 保留为快速生成测试包的备选。若模板定制比一个最小宿主还复杂，再有证据地退回自行实现，不能因为项目能生成 APK 就跳过 TV 验收。

第一轮只验收入口、登录、1080P、输入法、方向/确认去重及完整返回链。通过后再确定正式签名和发布流程。此顺序能优先复用开源成果，同时不丢掉现有网页交互基线；尚不承诺任一项目在 Q7F Pro 上直接可用。
