# 创维 Q7F Pro 作为 KatelyaTV 电视浏览器端 HLS 接收器的可行性评估

访问日期：2026-10-05

## 结论

**结论：有条件适合作为“1080p、H.264 + AAC”电视网页接收器原型，不足以确认适合 4K、H.265、AV1 或 HDR 正式播放。**

决定因素不是电视在系统播放器中能否解码，而是 Q7F Pro 实际浏览器是否同时提供：

1. 可用的 `MediaSource`（MSE）；
2. hls.js 所需的 codec/MSE 组合；
3. 足够新的浏览器或 Android WebView；
4. 跨域可访问的 HLS 清单和分片；
5. 用户点击后可播放、可进入全屏的浏览器实现。

截至访问日，创维公开官方页面只能核验到 `75Q7F Pro` 商品型号，未公开可复核的 SoC、CPU、GPU、运行内存、系统版本、浏览器内核版本或逐项音视频解码表。[S1] 因此本文不采用电商宣传、评测拆机或同系列机型参数进行推断；芯片厂商规格也无法在未知 SoC 型号的前提下可靠套用。

## 官方资料可确认与不可确认项

| 项目                       | 结论                                                                  | 依据                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 型号存在性                 | 创维官方商城可核验 `75Q7F Pro` 页面；不能据此推断其他尺寸硬件完全一致 | [S1]                                                                                                                                                    |
| 芯片 / SoC                 | **未知**                                                              | 创维公开页面未披露可复核型号；不猜测芯片厂商                                                                                                            |
| CPU / GPU                  | **未知**                                                              | 缺少官方 SoC 型号与整机规格                                                                                                                             |
| 运行内存 / 存储            | **未知**                                                              | 官方商品页“规格参数”未给出可核验内容                                                                                                                    |
| 系统版本                   | **未知**                                                              | 未找到 Q7F Pro 的官方系统版本或 Android API Level 资料                                                                                                  |
| 内置浏览器                 | **未知**                                                              | 未找到浏览器名称、内核或版本资料                                                                                                                        |
| 可安装浏览器               | **未知**                                                              | 未找到 Q7F Pro 应用商店兼容清单                                                                                                                         |
| MSE / MediaSource          | **未知，必须真机检测**                                                | MSE 是浏览器能力，不可由面板或系统播放器解码能力推出；`MediaSource.isTypeSupported()` 也只是能力探测，返回 `true` 不保证实际播放成功 [S4]               |
| 原生 HLS                   | **未知，必须真机检测**                                                | 需以 `video.canPlayType()` 和实际 m3u8 播放验证；当前 KatelyaTV 主链路并未为电视浏览器提供原生 HLS fallback                                             |
| H.264 / AAC                | **最值得优先验证**                                                    | Android 平台文档广泛列出 AVC、AAC 解码支持，但具体设备、浏览器和 MSE 暴露仍取决于系统实现 [S5]                                                          |
| H.265 / HEVC               | **高风险、未知**                                                      | Android 平台从较早版本提供 HEVC 解码接口，但 hls.js 的 HEVC 支持依赖浏览器、容器、MSE 与系统解码器组合，不能用电视本地播放器支持代替浏览器验证 [S3][S5] |
| AV1                        | **高风险、未知**                                                      | Android 平台文档列出 AV1 解码支持起始版本，但 Q7F Pro 系统版本、硬件解码器和浏览器暴露均未知 [S5]                                                       |
| HDR10 / HLG / Dolby Vision | **高风险、未知**                                                      | Android HDR 文档要求显示、解码、合成与应用链路共同支持；没有 Q7F Pro 浏览器链路的官方资料 [S6]                                                          |
| AC-3 / E-AC-3 / DTS 等音频 | **未知**                                                              | Android 通用格式表和 Q7F Pro 官方资料不足以证明浏览器 HLS 管线可用；优先以 AAC 作为接收器基线                                                           |

## KatelyaTV 当前 HLS 链路

当前仓库实际安装的是 hls.js `1.6.16`（声明范围为 `^1.6.6`），见 `package.json:40` 与 `pnpm-lock.yaml`。

播放链路为：

1. 从剧集数据取得原始 m3u8 URL；
2. `resolveHlsPlaybackPolicy()` 固定返回 `runtime: 'hlsjs'`、直连 URL、直连分片，见 `src/lib/hls-playback-policy.ts:87`；
3. ArtPlayer 的 `customType.m3u8` 无条件创建 hls.js，见 `src/app/play/page.tsx:4618`；
4. hls.js 拉取清单和分片，经 MSE 喂给 `<video>`；自定义 loader 还会读取媒体清单并生成广告跳过时间窗，见 `src/app/play/page.tsx:3287`；
5. 当前配置为前向缓冲 60 秒、后向缓冲 90 秒、`maxBufferSize` 约 90 MB，见 `src/app/play/page.tsx:4634`。

hls.js 官方说明其依赖 MSE，负责将 HLS 的 MPEG-TS/AAC 等内容转封装后送入浏览器媒体管线，并要求所有 HLS 资源返回允许 `GET` 的 CORS 响应头。[S3]

### 对电视浏览器的直接影响

- **无 MSE 即无法走当前主链路。** 当前策略只在 Apple 设备上用 `Hls.isSupported()` 阻断不支持设备；非 Apple 电视浏览器即使 `Hls.isSupported()` 为 `false`，仍可能继续进入 hls.js 初始化，见 `src/lib/hls-playback-policy.ts:91`、`src/app/play/page.tsx:2928`。
- **电视本地播放器能播 m3u8，不代表当前网页能播。** 当前代码没有先尝试 `video.canPlayType('application/vnd.apple.mpegurl')` 的原生 HLS fallback。
- **低内存风险需实测。** 90 MB 只是 hls.js 的缓冲上限配置之一，不含浏览器、页面、解复用、视频帧和 GPU 占用；Q7F Pro 运行内存未知。
- **跨域是硬门槛。** 直连模式要求主清单、子清单、密钥和分片都允许电视浏览器跨域请求。[S3]
- **codec 必须逐条验证。** hls.js 不替代 H.264/H.265/AV1 硬件或系统解码器；MSE 是否接受对应 codec string 才是浏览器侧第一关。[S3][S4]

### 当前片源抽样

2026-10-05 使用 `ffprobe` 对三条仓库现有或当前资源接口返回的 HLS 地址做了只读抽样：

| 样本             | 视频                 | 音频          | 分辨率    |
| ---------------- | -------------------- | ------------- | --------- |
| 当前如意资源样本 | H.264 High Level 4.0 | AAC-LC 双声道 | 1920×1080 |
| 仓库回归样本一   | H.264 High Level 3.1 | AAC-LC 双声道 | 1280×720  |
| 仓库回归样本二   | H.264 Main Level 4.0 | AAC-LC 双声道 | 1920×1080 |

这说明当前业务最常见的验证目标可以先收窄为 **MPEG-TS HLS + H.264 + AAC，最高 1080p**。三条样本不能代表全部来源；遇到 HEVC、AV1、非常规音频或更高码率时仍需逐条检测。

## 自动播放与全屏

当前 ArtPlayer 配置为 `muted: false`、`autoplay: true`、`playsInline: true`，见 `src/app/play/page.tsx:4584`。

- Chrome 官方自动播放策略允许静音自动播放；带声音自动播放通常要求用户交互或满足浏览器策略条件。[S7]
- Android WebView 提供 `setMediaPlaybackRequiresUserGesture()`；官方 API 文档说明该设置控制媒体播放是否需要用户手势，默认值为 `true`。[S8]
- Android WebView 的视频全屏需要宿主处理 `WebChromeClient.onShowCustomView()`；官方文档说明宿主未覆盖该回调时，WebView 默认不支持自定义全屏视图。[S9]
- 因此电视接收页应把“手机确认投放”映射为电视端明确的播放动作，并保留遥控器点击“播放 / 全屏”的兜底，不应依赖页面载入后有声自动播放。

上述 WebView 规则只说明 Android 宿主应用如何配置，**不能证明 Q7F Pro 内置浏览器采用哪个 WebView 版本或怎样配置**。

## 分辨率与编码可行性

| 测试档位                   | 预期判断   | 说明                                                              |
| -------------------------- | ---------- | ----------------------------------------------------------------- |
| 720p H.264 Main + AAC-LC   | 最可能成功 | 作为兼容性基线                                                    |
| 1080p H.264 High + AAC-LC  | MVP 目标   | MSE、CORS、连续播放和内存均通过后，才可判定接收器可用             |
| 4K H.264 + AAC-LC          | 未知       | 需验证浏览器是否限制分辨率、码率或硬件解码通路                    |
| 1080p/4K H.265 + AAC-LC    | 高风险     | 同时依赖 hls.js 容器支持、浏览器 MSE、HEVC codec 暴露和系统解码器 |
| 1080p/4K AV1 + AAC-LC      | 高风险     | 系统版本与 AV1 硬件能力未知                                       |
| 4K HDR10 / HLG             | 高风险     | 即使画面可播，也需确认 HDR 元数据未被浏览器链路降级或丢失         |
| 任意视频 + AC-3/E-AC-3/DTS | 高风险     | 浏览器音频 codec 暴露未知；AAC 应作为第一阶段唯一基线             |

## 最小真机验证清单

按顺序执行；前一阶段失败即停止，不需要先开发完整电视配对功能。

临时测试入口为 `/tv-test`。页面默认使用公开多码率 H.264 + AAC HLS
样片，可分别运行自适应播放和最高 1080p 档压力测试；也可以在输入框中
替换为真实片源，或通过 `/tv-test?src=<URL 编码后的 m3u8 地址>` 预填
测试地址。

### 1. 记录设备事实

- 设置页拍照记录：完整型号、系统版本、系统构建号、固件版本。
- 浏览器“关于”页记录：浏览器名称与版本。
- 若是可安装浏览器或 WebView 包装应用，记录应用包名、版本和 WebView provider；Android 官方提供 `WebView.getCurrentWebViewPackage()` 供宿主查询实际 WebView 包。[S10]
- 在浏览器控制台或测试页记录：`navigator.userAgent`、屏幕分辨率、`devicePixelRatio`。

### 2. 只测能力，不先接业务

```js
({
  mediaSource: typeof MediaSource !== 'undefined',
  hlsNative: document
    .createElement('video')
    .canPlayType('application/vnd.apple.mpegurl'),
  avc:
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028"'),
  aac:
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"'),
  hevc:
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L120.B0"'),
  av1:
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported('video/mp4; codecs="av01.0.08M.08"'),
});
```

判定：

- `mediaSource === false`：当前 KatelyaTV hls.js 链路不可用；仅在原生 HLS 实播成功时，才值得增加电视专用 native fallback。
- `avc === false` 或 `aac === false`：不适合做当前方案的网页接收器。
- `true` 只代表“浏览器声明可能支持”，仍必须实播；MSE 标准明确不把 `true` 视为播放成功保证。[S4]

### 3. hls.js 最小样片矩阵

使用同源或正确配置 CORS 的固定样片，每项连续播放至少 15 分钟：

1. 720p H.264 + AAC；
2. 1080p H.264 + AAC；
3. 4K H.264 + AAC；
4. 1080p H.265 + AAC；
5. 4K H.265 + AAC；
6. AV1 + AAC；
7. HDR10 / HLG；
8. 当前真实片源中的典型 MPEG-TS 与 fMP4 各一条。

每项记录：首帧时间、是否有声、是否硬解可观察、掉帧、卡顿、A/V 同步、拖动、暂停恢复、切集、15 分钟后内存/崩溃情况。

### 4. KatelyaTV 真实链路

- 打开现有播放页，确认 hls.js `MANIFEST_PARSED`、首帧和连续分片加载。
- 至少测试三条真实来源，覆盖主清单、单码率清单、带鉴权参数 URL。
- 检查主清单、子清单、密钥、TS/fMP4 分片的 CORS；任一级失败都不能归因于电视解码。
- 验证当前 60 秒前向、90 秒后向、约 90 MB 缓冲设置是否导致浏览器被系统回收。
- 验证广告跳过时间窗的 seek 在电视浏览器上不会造成永久 waiting/stalled。

### 5. 交互

- 页面打开后有声自动播放是否被拦截；
- 遥控器一次点击后能否 `play()`；
- ArtPlayer 全屏与网页全屏能否进入、退出；
- 返回键是否先退出全屏而不是关闭页面；
- 焦点能否到达播放、暂停、进度、全屏和退出按钮。

## 决策门槛

满足以下全部条件，才建议继续做 `/tv` 配对接收页：

- MSE 存在；
- 1080p H.264 High + AAC 的 `isTypeSupported()` 与 hls.js 实播均通过；
- 三条 KatelyaTV 真实 HLS 连续播放 30 分钟，无浏览器崩溃或持续卡顿；
- 用户操作后可稳定有声播放并进入全屏；
- 遥控器可以恢复播放、退出全屏和退出接收页。

HEVC、AV1、4K 与 HDR 任一失败，都不应阻塞第一版；第一版可明确限制为 **1080p H.264 + AAC**。若 MSE 缺失但原生 HLS 实播成功，再考虑仅在电视接收页加入最小 native HLS fallback；若两者都失败，则 Q7F Pro 不适合作为纯浏览器接收器，应转向原生 Android/电视应用或继续使用系统镜像。

## 官方来源

- **[S1] 创维商城：创维电视 75Q7F Pro 商品页**  
  https://www.skyworthmall.com/goods/detail/toProductDetail?skuNo=S105-000003277-001-DF  
  访问日期：2026-10-05。仅用于核验型号页面；未用商品宣传推断芯片或解码能力。
- **[S2] 创维官网：服务与电子说明书入口**  
  https://www.skyworth.com/service.php  
  访问日期：2026-10-05。页面未提供可公开检索到的 Q7F Pro 芯片、系统或浏览器规格。
- **[S3] hls.js 官方仓库与兼容性说明（v1.6.16）**  
  https://github.com/video-dev/hls.js/tree/v1.6.16  
  https://github.com/video-dev/hls.js/blob/v1.6.16/README.md  
  访问日期：2026-10-05。
- **[S4] W3C Media Source Extensions 标准**  
  https://www.w3.org/TR/media-source-2/  
  访问日期：2026-10-05。
- **[S5] Android Developers：Supported media formats**  
  https://developer.android.com/media/platform/supported-formats  
  访问日期：2026-10-05。
- **[S6] Android Open Source Project：HDR video playback**  
  https://source.android.com/docs/core/display/hdr  
  访问日期：2026-10-05。
- **[S7] Chrome for Developers：Autoplay policy in Chrome**  
  https://developer.chrome.com/blog/autoplay/  
  访问日期：2026-10-05。
- **[S8] Android Developers：`WebSettings.setMediaPlaybackRequiresUserGesture`**  
  https://developer.android.com/reference/android/webkit/WebSettings#setMediaPlaybackRequiresUserGesture(boolean)  
  访问日期：2026-10-05。
- **[S9] Android Developers：`WebChromeClient.onShowCustomView`**  
  https://developer.android.com/reference/android/webkit/WebChromeClient#onShowCustomView(android.view.View,%20android.webkit.WebChromeClient.CustomViewCallback)  
  访问日期：2026-10-05。
- **[S10] Android Developers：`WebView.getCurrentWebViewPackage`**  
  https://developer.android.com/reference/android/webkit/WebView#getCurrentWebViewPackage()  
  访问日期：2026-10-05。

[S1]: https://www.skyworthmall.com/goods/detail/toProductDetail?skuNo=S105-000003277-001-DF
[S2]: https://www.skyworth.com/service.php
[S3]: https://github.com/video-dev/hls.js/blob/v1.6.16/README.md
[S4]: https://www.w3.org/TR/media-source-2/
[S5]: https://developer.android.com/media/platform/supported-formats
[S6]: https://source.android.com/docs/core/display/hdr
[S7]: https://developer.chrome.com/blog/autoplay/
[S8]: https://developer.android.com/reference/android/webkit/WebSettings#setMediaPlaybackRequiresUserGesture(boolean)
[S9]: https://developer.android.com/reference/android/webkit/WebChromeClient#onShowCustomView(android.view.View,%20android.webkit.WebChromeClient.CustomViewCallback)
[S10]: https://developer.android.com/reference/android/webkit/WebView#getCurrentWebViewPackage()
