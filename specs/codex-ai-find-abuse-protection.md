# Code Review: `codex/ai-find-abuse-protection`

**审查日期:** 2026-05-22  
**分支:** `codex/ai-find-abuse-protection` vs `main`  
**变更规模:** 8 commits, 35 files changed, ~3,882 new lines, 71 deleted lines

---

## 概述

该分支添加了三个功能：AI 查找接口的 D1 配额计费、Turnstile + 邀请码注册安全、以及管理后台监控页面。整体架构清晰，分层合理（request guard → API handler）。但存在**两个严重 Bug**（配额检查的竞态条件和注册流程的顺序问题）以及大量重复代码需要重构。

---

## CRITICAL

### 1. 注册流程 order-of-operations Bug

**文件:** `src/app/api/register/route.ts:98-112`

**问题:** 第 98 行先创建用户（`db.registerUser`），第 100 行再消耗邀请码（`recordSuccessfulRegistration`）。如果邀请码消耗失败（例如一次性邀请码被并发使用），用户已经持久化到数据库，但 API 返回错误。用户账号被孤立：数据库中存在该用户，但请求方收到"邀请码已被使用"错误，无法登录。

**修复:** 将 `recordSuccessfulRegistration`（邀请码消耗）移到 `db.registerUser` 之前。正确顺序：
1. 验证注册安全性（邀请码检查是只读的）
2. 原子消耗邀请码（`consumeInvite` 已通过 `WHERE` 条件实现原子操作）
3. 消耗成功 → 创建用户 + 审计记录
4. 消耗失败 → 不创建用户，直接返回错误

---

### 2. 配额计费 TOCTOU 竞态条件

**文件:** `src/lib/ai-find/usage-quota.ts:187-234`

**问题:** `checkAndConsumeAiFindQuota` 先读取三个用量计数（第 187-191 行），检查是否超限（第 195-197 行），然后分别递增三个计数（第 208-212 行）。在读取和写入之间，同一用户的并发请求都可以看到低于限制的计数并同时通过检查。虽然单个 `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1` 对单行是原子的，但"先检查三行，再递增三行"的模式不保证原子性。

例如：Alice 剩余 `user` 配额为 1，同时发起两个请求，两者都会看到 count < limit，都通过检查，都递增计数——导致她实际使用了 3 次而不是 2 次。

**修复:** 利用 D1 (SQLite) 的 `ON CONFLICT DO UPDATE SET ... WHERE count < ?` 在 DO UPDATE 子句中加条件。如果 D1 不完全支持此语法，至少应在代码中明确注释此竞态窗口的存在。

---

## HIGH

### 3. 重复的 `requireAdmin` 函数

**文件:** `src/app/api/admin/ai-usage/route.ts:8-24` 和 `src/app/api/admin/registration-invites/route.ts:8-24`

两个文件定义了完全相同的 `requireAdmin` 函数。任何对管理员认证逻辑的修改都需要在两个地方同步进行。

**修复:** 提取到共享模块，如 `src/lib/admin-auth.ts`。

---

### 4. 重复的 D1 接口类型和 `getXxxDatabase` 函数

四个文件定义了几乎相同的模式：

| 文件 | 接口 | Getter 函数 |
|------|------|-------------|
| `usage-quota.ts` | `D1PreparedStatementLike`, `D1DatabaseLike` | `getQuotaDatabase` |
| `usage-report.ts` | `D1PreparedStatementLike`, `D1DatabaseLike` | `getReportDatabase` |
| `security.ts` | `D1PreparedStatementLike`, `D1DatabaseLike` | `getRegistrationDatabase` |
| `invite-admin.ts` | `D1PreparedStatementLike`, `D1DatabaseLike` | `getInviteDatabase` |

所有 `getXxxDatabase` 函数除了变量名外完全相同。

**修复:** 提取单个 `getD1Database(env?)` 函数和 D1 接口到共享模块（如 `src/lib/db-helpers.ts`）。

---

## MEDIUM

### 5. 邀请码验证与消耗之间的竞态窗口

**文件:** `src/lib/registration/security.ts:177-203` vs `213-239`

`checkInvite`（`validateRegistrationSecurity` 中的只读验证）与 `consumeInvite`（`recordSuccessfulRegistration` 中的原子 UPDATE）之间存在竞态窗口。两个请求可能在各自调用 `recordSuccessfulRegistration` 之前，同时对同一邀请码通过 `validateRegistrationSecurity`。

这被 `consumeInvite` 中的 `WHERE used_count < max_uses` 条件部分缓解。对于注册这种低吞吐场景可以接受，但应考虑完全不使用只读检查，直接依赖原子 UPDATE 的结果。

---

### 6. 测试覆盖不足

- **并发配额竞态:** `usage-quota.test.ts` 只测试了顺序请求，未测试 `Promise.all` 并发场景
- **注册孤立用户:** `register/route.test.ts` 未测试 `validateRegistrationSecurity` 通过但 `recordSuccessfulRegistration` 在 `registerUser` 成功后失败的场景
- **邀请码管理 GET 成功:** `admin/registration-invites/route.test.ts` 只测试了 401 情况，未测试认证成功后 GET 返回邀请码列表
- **AI 用量错误响应:** `admin/ai-usage/route.test.ts` 未测试 `getAiFindUsageReport` 抛出异常时返回 500 的场景

---

## LOW

### 7. 用量报告返回重复字段

**文件:** `src/lib/ai-find/usage-report.ts:228-238`

`today.find.total` 和 `today.find.global` 总是设置为相同值（`todayFindGlobal`），`group` 同理。如果目的是未来扩展，应加注释说明；否则合并为单一字段。

---

### 8. `getUtcDayKey` 实现不一致

**文件:** `usage-quota.ts` 和 `usage-report.ts`

两个文件中的 `getUtcDayKey` 实现方式不同。虽然 `offsetDays=0` 时结果相同，但应统一到共享工具函数。

---

### 9. `formatTime(0)` 返回 `'-'`

**文件:** `src/app/admin/page.tsx` AiUsageMonitor 组件

`formatTime(value)` 在 `value` 为 `0` 时返回 `'-'`。如果 `report.generatedAt` 或 `topSubject.updatedAt` 恰好为 0，UI 会显示 `-` 而非时间戳。建议使用 `null` 检查而非 falsiness 检查。

---

### 10. 单行 SELECT 缺少 `LIMIT 1`

**文件:** `usage-quota.ts`, `readUsageCount`

虽然 PRIMARY KEY 保证唯一性，但添加 `LIMIT 1` 有助于向读者和查询计划器表达意图。

---

## 正面评价

1. **`consumeInvite` 的深度防御做得很好:** UPDATE 使用了 `WHERE disabled = 0 AND used_count < max_uses AND (expires_at IS NULL OR expires_at > ?)` —— 正确的原子检查并消耗模式。

2. **正确的 IP 头部优先级:** `getAiFindClientIp` 和 `getRequestIp` 都优先使用 Cloudflare 的 `cf-connecting-ip` 头部，该头部无法被 Cloudflare 代理后的客户端伪造。

3. **可配置的限制与安全的默认值:** 所有配额限制都通过环境变量配置，并使用 `parseNumber` 限制在合理范围内。

4. **缺失 D1 时 Fails-closed:** 当 D1 不可用时，配额检查返回 `allowed: false` 而非允许无限制访问。这是安全的默认行为。

5. **良好的测试结构:** 测试使用依赖注入（`env` 参数）而非直接 mock `process.env`，使测试隔离且可靠。

6. **清晰的管理后台 UI:** 邀请码管理具有适当的禁用状态、确认对话框和清晰的状态指示。

7. **Turnstile token 重置:** 登录页面在注册失败时重置 Turnstile 小部件并清除 token，防止 token 重用问题。

---

## 合并建议

两个 CRITICAL 问题应在合并前修复。HIGH 级别的代码重复可以后续重构，但建议在技术债务累积前解决。测试覆盖缺口应逐步补齐。
