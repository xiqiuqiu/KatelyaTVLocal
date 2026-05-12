# 安全审查：认证强化改造

**日期：** 2026-05-11  
**分支：** main（未提交变更）  
**审查范围：** PBKDF2 密码哈希、HMAC 会话签名、遗留密码迁移、中间件加固

---

## 变更概要

29个文件，+397 / -404 行。本次改造引入了三项核心安全升级：

- **PBKDF2-SHA256 密码哈希**（120,000 次迭代，16 字节随机盐）— 覆盖全部 5 个存储后端
- **HMAC-SHA256 签名会话 Cookie**（version: 2）— 替代旧版无签名 Cookie
- **渐进式遗留密码迁移** — `upgradeLegacyPasswords()` 在登录/注册流程中静默升级

新增文件：

| 文件 | 用途 |
|------|------|
| `src/lib/security/password.ts` | `hashPassword` / `verifyPassword` / `isLegacyPlaintextPassword` |
| `src/lib/security/session.ts` | `createSessionCookieValue` / `parseSessionCookieValue` |
| `src/lib/security/password.test.ts` | 哈希与验证的单元测试 |
| `src/lib/security/session.test.ts` | 会话签名与防篡改的单元测试 |
| `src/app/api/session/route.ts` | 返回当前用户会话信息的 API 端点 |

---

## 严重性分级

### HIGH

**1. localstorage 模式下 owner 密码仍明文比较**

`src/app/api/login/route.ts:64` — 当存储类型为 localstorage 时，登录接口直接比较 `password !== process.env.PASSWORD`。原因在于：单用户模式下不存在数据库，密码只能以环境变量形式存在。因此无法对 `PASSWORD` 进行哈希后再比较。

影响：`process.env.PASSWORD` 在服务端存在期间始终是明文的。

缓解措施：确保该环境变量不在客户端打包中泄露（`middleware.ts` 中 `process.env.PASSWORD` 仅在服务端引用）。

**2. skip-configs 路由修复了用户名伪造漏洞**

`src/app/api/skip-configs/route.ts` — 该路由此前允许客户端在请求体中传入任意 `username` 参数。改造后强制使用来自已签名认证 Cookie 的 `authInfo.username`。

本改造修复了一个可用于水平越权的高危漏洞（用户通过伪造 `username` 读写他人数据）。

**3. 多个 API 路由修复了缺失的 `await`**

所有受保护路由（admin、favorites、playrecords、searchhistory、skip-configs）此前调用 `getAuthInfoFromCookie` 时均未加 `await`。由于该函数现已成为异步（需进行 HMAC 验证），若不添加 `await`，`authInfo` 将是一个 Promise 对象而非期望的会话载荷。Promise 上的 `.username` 为 `undefined`，因此检查仍返回 401，但路由会对所有请求无差别拒绝。

---

### MEDIUM

**4. 会话未设置服务端过期时间**

`src/lib/security/session.ts:80-100` — `parseSessionCookieValue()` 仅在以下情况拒绝：
- 签名无效（被篡改）
- `version` 不是 2
- JSON 解析失败

但不会检查 `issuedAt`，因此 Cookie 只要未过期且签名有效，就永久有效。令牌本身的 7 天到期由 `Set-Cookie` 的 `expires` 控制，然而服务器端没有最大有效时长校验。

影响：无法实现服务端会话失效（除非轮换 `AUTH_SIGNING_SECRET`），被盗 Cookie 在到期前始终有效。

建议：增加基于 `issuedAt` 的可配置 `maxAge` 检查。

**5. 遗留明文密码比较未使用恒定时间**

`src/lib/security/password.ts:83` — `return stored === candidate;` 使用的是严格相等而非恒定时间比较。正常哈希路径使用 Web Crypto API（恒定时间），但明文回退路径没有。

实际风险：低。该路径仅用于尚未迁移的遗留密码，且网络环境下的时序攻击噪声极大。

**6. 未限制密码强度**

`src/app/api/register/route.ts:60` 仅检查密码为非空字符串。用户可以注册 "a" 作为密码。建议增加最低长度要求。

---

### LOW

**7. 响应中的死字段**

`src/app/api/change-password/route.ts:59` — 响应包含 `reauthRequired: true`，但 `UserMenu.tsx` 中提交密码修改后始终会登出（不依赖该字段），属于无意义的返回字段。

**8. 客户端运行时暴露用户信息于 HTML 源码**

`src/app/layout.tsx:117-119` — `window.RUNTIME_CONFIG.CURRENT_USER` 通过内联脚本注入页面 HTML 源码。任何 XSS 均可读取用户名与角色。但会话 Cookie 本身为 httpOnly，无法通过 JS 访问，因此实际影响较低。这是为 SPA 提供用户信息所做的可接受权衡。

**9. 所有 5 个存储后端实现一致**

`LocalStorage`、`D1Storage`、`RedisStorage`、`KvrocksStorage`、`UpstashRedisStorage` 在 `registerUser`、`verifyUser`、`changePassword`、`upgradeLegacyPasswords` 和 `deleteUser` 中一致实现了 `hashPassword`/`verifyPassword`。各实现的差异仅在于底层存储引擎，架构上值得肯定。

---

## 前后对比

| 方面 | 之前 | 之后 |
|------|------|------|
| 密码存储 | 明文（所有后端） | PBKDF2-SHA256，120K 次迭代 |
| 会话集成 | 无加密签名 | HMAC-SHA256 签名，version: 2 |
| 防篡改 | 无 | `parseSessionCookieValue` 验证失败返回 `null` |
| Cookie 属性 | 无明确约束 | `httpOnly`、`sameSite: lax`、条件性 `secure` |
| 用户名枚举防护 | 不一致的错误信息 | 所有分支统一返回"用户名或密码错误" |
| 跨账户访问 | 客户端提供的 `username`（skip-configs） | 强制使用签名 Cookie 中的身份 |

---

## 测试覆盖

`password.test.ts` 和 `session.test.ts` 覆盖了核心路径：

| 测试 | 状态 |
|------|------|
| 密码哈希与验证 — 正确密码 | ✅ 通过 |
| 密码哈希与验证 — 错误密码被拒绝 | ✅ 通过 |
| 遗留明文密码检测 | ✅ 通过 |
| 会话签名与解析 — 正常往返 | ✅ 通过 |
| 会话签名 — 篡改后被拒绝 | ✅ 通过 |

建议补充：

- 对已在 `upgradeLegacyPasswords` 中将明文密码升级为哈希密钥的用户，测试其登录流程
- 在会话解析中增加 `maxAge` 检查，并覆盖过期拒绝的测试用例

---

## 结论

本次改造整体方向正确——显著改善了明文密码和未签名会话带来的安全风险。`skip-configs` 中移除由客户端提供用户名是最重要的未声明安全修复。遗留密码的渐进式迁移模式设计得当。

**合并前需优先处理：**

1. localstorage 模式下 owner 的明文密码 — 架构限制，短期无可行方案，属于已知且可接受的风险
2. 建议：在 `parseSessionCookieValue` 中增加基于 `issuedAt` 的可配置 `maxAge` 检查
3. 建议：在注册流程中增加最低密码长度要求（如 6 个字符）

当前无阻塞性安全问题，变更可以合并。
