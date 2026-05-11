# Auth Security Hardening Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成第一阶段认证安全加固，移除仓库内敏感凭证、将用户密码改为非明文存储、让旧登录失效，并把登录状态改成前端脚本不可直接读取。

**Architecture:** 第一阶段不重做整套用户系统，而是在现有用户名密码登录的基础上引入两套基础能力：一套是统一的密码哈希工具，一套是统一的签名会话工具。密码继续沿用现有存储位置，但内容改为可识别的哈希串，借此避免大规模表结构变更；登录 Cookie 改为服务端签发和校验，客户端通过服务端注入的最小用户信息消费登录态，不再自己解析 Cookie。

**Tech Stack:** Next.js 14, Edge Runtime, Cloudflare Pages, D1, Redis/Kvrocks-compatible storage, Jest.

---

## 文件结构

**新增文件：**

- `src/lib/security/password.ts`
  密码哈希、校验、旧明文识别与升级辅助
- `src/lib/security/password.test.ts`
  密码工具测试
- `src/lib/security/session.ts`
  新版会话签发、解析、验签与旧格式拒绝
- `src/lib/security/session.test.ts`
  会话工具测试
- `src/app/api/session/route.ts`
  给前端返回最小必要的当前用户信息
- `src/app/api/session/route.test.ts`
  当前会话接口测试

**修改文件：**

- `src/lib/auth.ts`
  从“浏览器读 Cookie”转为“服务端 Cookie 解析 + 浏览器读 runtime user”
- `src/lib/types.ts`
  扩展用户认证与存储接口
- `src/lib/db.ts`
  暴露密码升级所需的新能力
- `src/lib/d1.db.ts`
  用哈希串替换明文密码逻辑，并增加批量升级入口
- `src/lib/redis.db.ts`
  同步改为哈希串存储，并增加批量升级入口
- `src/lib/kvrocks.db.ts`
  同步改为哈希串存储，并增加批量升级入口
- `src/lib/localstorage.db.ts`
  本地模式同步改造，避免继续写明文
- `src/app/api/login/route.ts`
  切到新版会话签发，登录时执行旧密码升级
- `src/app/api/register/route.ts`
  注册时写入哈希密码，并签发新版会话
- `src/app/api/logout/route.ts`
  用新版 Cookie 属性清理登录态
- `src/app/api/change-password/route.ts`
  改密后写入哈希，并让当前登录失效
- `src/app/api/admin/user/route.ts`
  管理员新增用户/改密改为哈希写入
- `src/app/api/admin/reset/route.ts`
  改成 `POST`，减少高风险副作用 `GET`
- `src/middleware.ts`
  验证新版会话，拒绝旧格式 Cookie
- `src/app/layout.tsx`
  注入最小当前用户信息到 `window.RUNTIME_CONFIG`
- `src/lib/db.client.ts`
  不再从浏览器 Cookie 取用户名/签名，改读 runtime user 并只靠自动携带 Cookie 调接口
- `src/components/UserMenu.tsx`
  不再直接读 Cookie，改读 runtime user
- `wrangler.toml`
  移除敏感凭证
- `wrangler.toml.example`
  保留非敏感示例，提示使用 secret
- `.env.example`
  补充 `AUTH_SIGNING_SECRET` 等说明
- `docs/CLOUDFLARE_SOURCE_RANKING.md`
  如果引用了旧的 `PASSWORD` 配置，补说明

---

### Task 1: 建立密码哈希与会话基础能力

**Files:**
- Create: `src/lib/security/password.ts`
- Create: `src/lib/security/password.test.ts`
- Create: `src/lib/security/session.ts`
- Create: `src/lib/security/session.test.ts`
- Modify: `src/lib/auth.ts`

- [ ] **Step 1: 写密码工具失败测试**

```ts
import {
  hashPassword,
  isLegacyPlaintextPassword,
  verifyPassword,
} from './password';

describe('password security helpers', () => {
  it('hashes and verifies a password', async () => {
    const hashed = await hashPassword('secret-123');

    expect(hashed).not.toBe('secret-123');
    await expect(verifyPassword(hashed, 'secret-123')).resolves.toBe(true);
    await expect(verifyPassword(hashed, 'wrong')).resolves.toBe(false);
  });

  it('detects legacy plaintext values', () => {
    expect(isLegacyPlaintextPassword('plain-text')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认当前失败**

Run:
```bash
npm test -- src/lib/security/password.test.ts --runInBand
```

Expected:
- FAIL，提示模块不存在

- [ ] **Step 3: 实现最小密码工具**

```ts
const PREFIX = 'pbkdf2_sha256';

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveKey(password, salt, 120000);
  return `${PREFIX}$120000$${toBase64(salt)}$${toBase64(derived)}`;
}

export function isLegacyPlaintextPassword(stored: string): boolean {
  return !stored.startsWith(`${PREFIX}$`);
}

export async function verifyPassword(
  stored: string,
  candidate: string
): Promise<boolean> {
  if (isLegacyPlaintextPassword(stored)) {
    return stored === candidate;
  }

  const [, iterations, salt, hash] = stored.split('$');
  const derived = await deriveKey(candidate, fromBase64(salt), Number(iterations));
  return toBase64(derived) === hash;
}
```

- [ ] **Step 4: 写会话工具失败测试**

```ts
import { createSessionCookieValue, parseSessionCookieValue } from './session';

describe('session helpers', () => {
  it('creates and parses a signed session payload', async () => {
    const cookie = await createSessionCookieValue(
      { username: 'alice', role: 'admin' },
      'signing-secret'
    );

    const parsed = await parseSessionCookieValue(cookie, 'signing-secret');

    expect(parsed?.username).toBe('alice');
    expect(parsed?.role).toBe('admin');
    expect(parsed?.version).toBe(2);
  });
});
```

- [ ] **Step 5: 跑测试确认当前失败**

Run:
```bash
npm test -- src/lib/security/session.test.ts --runInBand
```

Expected:
- FAIL，提示模块不存在

- [ ] **Step 6: 实现最小会话工具并接入服务端 Cookie 解析**

```ts
export interface SessionPayload {
  version: 2;
  username?: string;
  role: 'owner' | 'admin' | 'user';
  issuedAt: number;
}

export async function createSessionCookieValue(
  input: { username?: string; role: SessionPayload['role'] },
  secret: string
): Promise<string> {
  const payload: SessionPayload = {
    version: 2,
    username: input.username,
    role: input.role,
    issuedAt: Date.now(),
  };

  const body = JSON.stringify(payload);
  const signature = await sign(body, secret);
  return encodeURIComponent(JSON.stringify({ payload, signature }));
}
```

- [ ] **Step 7: 更新 `src/lib/auth.ts` 只保留服务端解析和 runtime user 类型**

```ts
export function getAuthInfoFromCookie(request: NextRequest): SessionPayload | null {
  const authCookie = request.cookies.get('auth');
  if (!authCookie) return null;
  return null;
}
```

要求：
- 删除浏览器端直接解析 Cookie 的主逻辑
- 旧格式 Cookie 解析失败时返回 `null`

- [ ] **Step 8: 跑测试确认通过**

Run:
```bash
npm test -- src/lib/security/password.test.ts src/lib/security/session.test.ts --runInBand
```

Expected:
- PASS

- [ ] **Step 9: 提交**

```bash
git add src/lib/security/password.ts src/lib/security/password.test.ts src/lib/security/session.ts src/lib/security/session.test.ts src/lib/auth.ts
git commit -m "feat: add secure password and session helpers"
```

---

### Task 2: 将用户存储改为非明文密码，并支持旧密码升级

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/d1.db.ts`
- Modify: `src/lib/redis.db.ts`
- Modify: `src/lib/kvrocks.db.ts`
- Modify: `src/lib/localstorage.db.ts`

- [ ] **Step 1: 写存储层失败测试，覆盖旧明文和新哈希两种校验**

```ts
import { verifyPassword } from '@/lib/security/password';

describe('password storage compatibility', () => {
  it('verifies both legacy and hashed stored passwords', async () => {
    expect(await verifyPassword('plain-pass', 'plain-pass')).toBe(true);

    const hashed = await hashPassword('new-pass');
    expect(await verifyPassword(hashed, 'new-pass')).toBe(true);
  });
});
```

- [ ] **Step 2: 扩展存储接口**

```ts
export interface IStorage {
  registerUser(userName: string, password: string): Promise<void>;
  verifyUser(userName: string, password: string): Promise<boolean>;
  changePassword(userName: string, newPassword: string): Promise<void>;
  upgradeLegacyPasswords?(): Promise<number>;
}
```

- [ ] **Step 3: 在 `DbManager` 中暴露升级入口**

```ts
async upgradeLegacyPasswords(): Promise<number> {
  if (typeof (this.storage as any).upgradeLegacyPasswords === 'function') {
    return (this.storage as any).upgradeLegacyPasswords();
  }
  return 0;
}
```

- [ ] **Step 4: 修改 D1 存储使用哈希串**

```ts
async registerUser(userName: string, password: string): Promise<void> {
  const hashedPassword = await hashPassword(password);
  await db
    .prepare('INSERT INTO users (username, password) VALUES (?, ?)')
    .bind(userName, hashedPassword)
    .run();
}

async verifyUser(userName: string, password: string): Promise<boolean> {
  const result = await db
    .prepare('SELECT password FROM users WHERE username = ?')
    .bind(userName)
    .first<{ password: string }>();

  return result ? verifyPassword(result.password, password) : false;
}
```

- [ ] **Step 5: 给 D1 增加旧明文批量升级**

```ts
async upgradeLegacyPasswords(): Promise<number> {
  const rows = await db.prepare('SELECT username, password FROM users').all<{ username: string; password: string }>();
  let upgraded = 0;

  for (const row of rows.results) {
    if (!isLegacyPlaintextPassword(row.password)) continue;
    const hashed = await hashPassword(row.password);
    await db.prepare('UPDATE users SET password = ? WHERE username = ?').bind(hashed, row.username).run();
    upgraded++;
  }

  return upgraded;
}
```

- [ ] **Step 6: 对 Redis、Kvrocks、LocalStorage 做同样替换**

要求：
- `registerUser` 写哈希串
- `verifyUser` 使用 `verifyPassword`
- `changePassword` 写哈希串
- `upgradeLegacyPasswords` 枚举用户并覆盖旧明文

- [ ] **Step 7: 跑核心测试**

Run:
```bash
npm test -- src/lib/security/password.test.ts --runInBand
```

Expected:
- PASS

- [ ] **Step 8: 提交**

```bash
git add src/lib/types.ts src/lib/db.ts src/lib/d1.db.ts src/lib/redis.db.ts src/lib/kvrocks.db.ts src/lib/localstorage.db.ts
git commit -m "feat: store user passwords as secure hashes"
```

---

### Task 3: 切换登录、注册、注销和中间件到新版会话

**Files:**
- Modify: `src/app/api/login/route.ts`
- Modify: `src/app/api/register/route.ts`
- Modify: `src/app/api/logout/route.ts`
- Modify: `src/app/api/change-password/route.ts`
- Modify: `src/app/api/admin/user/route.ts`
- Modify: `src/app/api/admin/reset/route.ts`
- Modify: `src/middleware.ts`
- Create: `src/app/api/session/route.ts`
- Create: `src/app/api/session/route.test.ts`

- [ ] **Step 1: 写当前会话接口失败测试**

```ts
describe('GET /api/session', () => {
  it('returns current user summary for a valid signed session', async () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认当前失败**

Run:
```bash
npm test -- src/app/api/session/route.test.ts --runInBand
```

Expected:
- FAIL，提示路由不存在

- [ ] **Step 3: 登录接口改为先升级旧密码，再签发新版会话**

```ts
const signingSecret = process.env.AUTH_SIGNING_SECRET;
if (!signingSecret) {
  return NextResponse.json({ error: 'AUTH_SIGNING_SECRET 未配置' }, { status: 500 });
}

await db.upgradeLegacyPasswords();

const cookieValue = await createSessionCookieValue(
  { username, role: resolvedRole },
  signingSecret
);

response.cookies.set('auth', cookieValue, {
  path: '/',
  expires,
  sameSite: 'lax',
  httpOnly: true,
  secure: req.nextUrl.protocol === 'https:',
});
```

- [ ] **Step 4: 注册、注销、管理员改密、普通改密同步切换**

要求：
- 注册后签发新版 `auth`
- 注销清理时使用 `httpOnly: true`
- 改密后直接清理当前登录，强制重新登录
- 管理员新增用户和改密走新哈希逻辑
- `admin/reset` 改为 `POST`

- [ ] **Step 5: 中间件只接受新版会话**

```ts
const authInfo = await getAuthInfoFromCookie(request);
if (!authInfo) {
  return handleAuthFailure(request, pathname);
}

if (storageType === 'localstorage') {
  return NextResponse.next();
}

return NextResponse.next();
```

要求：
- 不再接受旧的 `password/signature/timestamp` Cookie 结构
- `PASSWORD` 不再作为会话签名密钥

- [ ] **Step 6: 实现 `/api/session`**

```ts
export async function GET(request: NextRequest) {
  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      username: authInfo.username ?? null,
      role: authInfo.role,
    },
  });
}
```

- [ ] **Step 7: 跑会话与路由测试**

Run:
```bash
npm test -- src/lib/security/session.test.ts src/app/api/session/route.test.ts --runInBand
```

Expected:
- PASS

- [ ] **Step 8: 提交**

```bash
git add src/app/api/login/route.ts src/app/api/register/route.ts src/app/api/logout/route.ts src/app/api/change-password/route.ts src/app/api/admin/user/route.ts src/app/api/admin/reset/route.ts src/app/api/session/route.ts src/app/api/session/route.test.ts src/middleware.ts
git commit -m "feat: switch auth routes to secure server-side sessions"
```

---

### Task 4: 改造前端读取方式，移除浏览器对认证 Cookie 的依赖

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/db.client.ts`
- Modify: `src/components/UserMenu.tsx`

- [ ] **Step 1: 在布局中注入最小当前用户信息**

```ts
const currentUser = session
  ? { username: session.username ?? null, role: session.role }
  : null;

const runtimeConfig = {
  ...existingRuntimeConfig,
  CURRENT_USER: currentUser,
};
```

- [ ] **Step 2: 给浏览器提供新的只读入口**

```ts
export function getRuntimeCurrentUser(): {
  username?: string | null;
  role?: 'owner' | 'admin' | 'user';
} | null {
  if (typeof window === 'undefined') return null;
  return (window as any).RUNTIME_CONFIG?.CURRENT_USER || null;
}
```

- [ ] **Step 3: `db.client.ts` 全部改读 runtime user，不再发 username/signature/timestamp**

```ts
const currentUser = getRuntimeCurrentUser();
if (!currentUser?.username) {
  return null;
}

const response = await fetch('/api/skip-configs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'get', key }),
});
```

- [ ] **Step 4: `UserMenu.tsx` 改读 runtime user**

```ts
useEffect(() => {
  if (typeof window !== 'undefined') {
    setAuthInfo(getRuntimeCurrentUser());
  }
}, []);
```

- [ ] **Step 5: 跑现有核心测试**

Run:
```bash
npm test -- src/app/api/source-feedback/route.test.ts src/lib/source-preference.test.ts --runInBand
```

Expected:
- PASS

- [ ] **Step 6: 提交**

```bash
git add src/app/layout.tsx src/lib/auth.ts src/lib/db.client.ts src/components/UserMenu.tsx
git commit -m "feat: remove client-side auth cookie parsing"
```

---

### Task 5: 清理仓库凭证并完成验证

**Files:**
- Modify: `wrangler.toml`
- Modify: `wrangler.toml.example`
- Modify: `.env.example`
- Modify: `docs/superpowers/specs/2026-05-11-auth-security-hardening-design.md`

- [ ] **Step 1: 移除已提交敏感值**

要求：
- `wrangler.toml` 不再包含真实 `PASSWORD`
- 会话签名改用 `AUTH_SIGNING_SECRET`
- 需要人工在 Cloudflare secret 中配置的项，只保留说明，不保留值

- [ ] **Step 2: 补环境变量示例**

```env
AUTH_SIGNING_SECRET=replace-me
PASSWORD=replace-me-owner-login
USERNAME=admin
```

要求：
- 示例文件只保留占位值
- 正式文件不保留真实秘密

- [ ] **Step 3: 跑完整验证**

Run:
```bash
npm test -- src/lib/security/password.test.ts src/lib/security/session.test.ts src/app/api/session/route.test.ts src/lib/source-preference.test.ts src/lib/source-ranking/scheduler.test.ts src/lib/source-ranking/read.test.ts src/lib/source-ranking/cron-auth.test.ts src/app/api/source-feedback/route.test.ts --runInBand
npm run typecheck
```

Expected:
- 全部 PASS

- [ ] **Step 4: 浏览器手动验证**

Check:
- 登录后能进入首页
- 用户菜单能显示当前用户名和角色
- 登出后返回未登录状态
- 修改密码后当前登录失效，需要重新登录
- 旧 Cookie 无法继续通过中间件

- [ ] **Step 5: 提交**

```bash
git add wrangler.toml wrangler.toml.example .env.example docs/superpowers/specs/2026-05-11-auth-security-hardening-design.md
git commit -m "chore: remove committed auth secrets and verify phase 1"
```

---

## 风险与约束

- 这次把 Cookie 改成前端不可读后，任何直接读 `document.cookie` 的地方都会失效，所以必须同步改前端用户信息读取方式。
- 第一阶段不引入 `session_version`，因此“改密/封禁后使所有其他设备旧登录立即失效”保留到第二阶段；当前阶段只保证旧格式会话整体失效，以及当前改密后本次登录立即失效。
- 当前仓库没有现成的用户表迁移脚本，因此第一阶段优先复用现有 `password` 存储位，把值从明文改成哈希串，减少数据库结构风险。

## 完成标准

- 仓库中不再保存真实认证秘密
- 新注册和新改密用户不再保存明文密码
- 已有旧明文密码可被批量升级
- 登录 Cookie 变为前端脚本不可读
- 旧格式登录状态在发布后失效
- 登录、注册、登出、继续观看、收藏、跳过配置、用户菜单仍然可用
