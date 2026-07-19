# ReelFind 登录页设计 QA

## 验收范围

- 视觉源：`/var/folders/bl/f3j25y8d4jz3yldslb4vyfkw0000gn/T/codex-clipboard-31f775ca-2e82-4cbd-9a16-71a74a9f348e.png`
- 桌面登录：`output/design-qa/login-desktop-final.png`（1672 × 941，深色主题）
- 桌面注册：`output/design-qa/register-desktop-final.png`（1672 × 941，深色主题）
- 移动登录：`output/design-qa/login-mobile-final.png`（390 × 844）
- 移动注册：`output/design-qa/register-mobile-final.png`（390 × 844）
- 并排对照：`output/design-qa/login-comparison.png`
- 固定画布对照：`output/design-qa/auth-fixed-canvas-comparison.png`（登录 / 注册，1672 × 941）

## 对照记录

1. 初版：主容器偏窄、右侧表单偏小且纵向位置偏低。调整为 77.5vw 双栏容器、560px 表单宽度，并重设桌面端纵向节奏。
2. 第二轮：按原图真实像素视口复核后，放大标题、品牌字标与 60px 控件，并使用独立影院背景素材。
3. 最终轮：登录态容器测得 `x=188.1, y=153, width=1295.8, height=691`，与视觉源约 `x=188, y=153, width=1297, height=687` 一致；注册态压缩区块间距，完整保留邀请码与 Turnstile。
4. 固定画布修正：发现注册内容会把双栏容器由约 687px 拉高至 822px，造成左侧背景缩放。桌面端改为固定 `min(73vh, 840px)` 画布，右侧表单独立滚动；复测登录与注册的主容器均为约 `1295.8 × 686.9px`，左侧背景区域均为约 `692.2 × 684.9px`。

## 交互与响应式

- 登录、注册切换保持同一视觉体系，并分别呈现对应字段。
- 密码显示/隐藏按钮已验证，输入类型可在 `password` 与 `text` 间切换。
- 登录密码使用 `current-password`，注册密码使用 `new-password`。
- 390px 视口无横向溢出；注册长表单允许自然纵向滚动。
- 桌面注册内容超出时只滚动右侧表单区域，主容器与左侧背景保持原位和原尺寸。
- 浏览器控制台无运行时错误；仅出现开发环境 Fast Refresh 提示。

## 结论

未发现 P0、P1 或 P2 视觉问题。

final result: passed
