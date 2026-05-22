import { D1DatabaseLike, getD1Database } from '@/lib/d1';

export interface RegistrationSecurityConfig {
  turnstileRequired: boolean;
  turnstileSecretKey: string;
  inviteRequired: boolean;
  passwordMinLength: number;
  ipWindowSeconds: number;
  ipWindowLimit: number;
}

export interface RegistrationSecurityInput {
  username: string;
  password: string;
  ip: string;
  inviteCode?: string;
  turnstileToken?: string;
  now?: number;
  env?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export interface RegistrationSecurityResult {
  ok: boolean;
  status: number;
  error?: string;
}

interface InviteRow {
  code: string;
  max_uses: number;
  used_count: number;
  disabled: number;
  expires_at: number | null;
}

interface CountRow {
  count: number;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return value === true || value === 'true';
}

function parseNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function getEnvValue(env: Record<string, unknown>, key: string): unknown {
  return env[key] ?? (process.env as unknown as Record<string, unknown>)[key];
}

export function getRegistrationSecurityConfig(
  env: Record<string, unknown> = process.env
): RegistrationSecurityConfig {
  return {
    turnstileRequired: parseBoolean(
      getEnvValue(env, 'REGISTER_TURNSTILE_REQUIRED'),
      true
    ),
    turnstileSecretKey:
      String(getEnvValue(env, 'TURNSTILE_SECRET_KEY') || '').trim(),
    inviteRequired: parseBoolean(
      getEnvValue(env, 'REGISTER_INVITE_REQUIRED'),
      true
    ),
    passwordMinLength: parseNumber(
      getEnvValue(env, 'REGISTER_PASSWORD_MIN_LENGTH'),
      8,
      6,
      128
    ),
    ipWindowSeconds: parseNumber(
      getEnvValue(env, 'REGISTER_IP_WINDOW_SECONDS'),
      3600,
      60,
      86400
    ),
    ipWindowLimit: parseNumber(
      getEnvValue(env, 'REGISTER_IP_WINDOW_LIMIT'),
      3,
      1,
      100
    ),
  };
}

export function getRegistrationDatabase(
  env?: Record<string, unknown>
): D1DatabaseLike | null {
  return getD1Database(env);
}

export function getRequestIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'anonymous'
  );
}

async function verifyTurnstile({
  token,
  ip,
  secretKey,
  fetchImpl,
}: {
  token?: string;
  ip: string;
  secretKey: string;
  fetchImpl?: typeof fetch;
}): Promise<RegistrationSecurityResult> {
  if (!token) {
    return { ok: false, status: 400, error: '请先完成人机验证' };
  }

  if (!secretKey) {
    return { ok: false, status: 500, error: 'Turnstile 未配置' };
  }

  const verifyFetch = fetchImpl ?? fetch;

  const form = new FormData();
  form.set('secret', secretKey);
  form.set('response', token);
  if (ip && ip !== 'anonymous') {
    form.set('remoteip', ip);
  }

  const response = await verifyFetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      body: form,
    }
  );
  const result = (await response.json().catch(() => null)) as {
    success?: boolean;
  } | null;

  if (!response.ok || !result?.success) {
    return { ok: false, status: 400, error: '人机验证失败，请重试' };
  }

  return { ok: true, status: 200 };
}

async function checkInvite({
  db,
  code,
  now,
}: {
  db: D1DatabaseLike;
  code?: string;
  now: number;
}): Promise<RegistrationSecurityResult> {
  const normalizedCode = code?.trim();
  if (!normalizedCode) {
    return { ok: false, status: 400, error: '请输入邀请码' };
  }

  const invite = await db
    .prepare(
      `SELECT code, max_uses, used_count, disabled, expires_at
       FROM registration_invites
       WHERE code = ?`
    )
    .bind(normalizedCode)
    .first<InviteRow>();

  if (!invite || invite.disabled) {
    return { ok: false, status: 400, error: '邀请码无效' };
  }

  if (invite.expires_at && invite.expires_at <= now) {
    return { ok: false, status: 400, error: '邀请码已过期' };
  }

  if (invite.used_count >= invite.max_uses) {
    return { ok: false, status: 400, error: '邀请码已被使用' };
  }

  return { ok: true, status: 200 };
}

async function consumeInvite({
  db,
  code,
  now,
}: {
  db: D1DatabaseLike;
  code?: string;
  now: number;
}) {
  const normalizedCode = code?.trim();
  if (!normalizedCode) {
    return false;
  }

  const result = (await db
    .prepare(
      `UPDATE registration_invites
       SET used_count = used_count + 1, updated_at = ?
       WHERE code = ?
         AND disabled = 0
         AND used_count < max_uses
         AND (expires_at IS NULL OR expires_at > ?)`
    )
    .bind(now, normalizedCode, now)
    .run()) as { meta?: { changes?: number } } | undefined;

  return (result?.meta?.changes ?? 1) > 0;
}

export async function consumeRegistrationInvite(
  input: RegistrationSecurityInput
): Promise<RegistrationSecurityResult> {
  const config = getRegistrationSecurityConfig(input.env);
  const db = getRegistrationDatabase(input.env);
  const now = input.now ?? Date.now();

  if (!db || !config.inviteRequired) {
    return { ok: true, status: 200 };
  }

  const consumed = await consumeInvite({
    db,
    code: input.inviteCode,
    now,
  });
  if (!consumed) {
    return { ok: false, status: 400, error: '邀请码已被使用' };
  }

  return { ok: true, status: 200 };
}

async function checkIpFrequency({
  db,
  ip,
  now,
  config,
}: {
  db: D1DatabaseLike;
  ip: string;
  now: number;
  config: RegistrationSecurityConfig;
}): Promise<RegistrationSecurityResult> {
  const since = now - config.ipWindowSeconds * 1000;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM registration_audit
       WHERE ip = ? AND created_at >= ?`
    )
    .bind(ip, since)
    .first<CountRow>();

  if ((row?.count ?? 0) >= config.ipWindowLimit) {
    return { ok: false, status: 429, error: '该网络注册过于频繁，请稍后再试' };
  }

  return { ok: true, status: 200 };
}

export async function validateRegistrationSecurity(
  input: RegistrationSecurityInput
): Promise<RegistrationSecurityResult> {
  const config = getRegistrationSecurityConfig(input.env);
  const db = getRegistrationDatabase(input.env);
  const now = input.now ?? Date.now();

  if (input.password.length < config.passwordMinLength) {
    return {
      ok: false,
      status: 400,
      error: `密码长度至少 ${config.passwordMinLength} 位`,
    };
  }

  if (!db && (config.inviteRequired || config.ipWindowLimit > 0)) {
    return { ok: false, status: 500, error: '注册安全存储未配置' };
  }

  if (config.turnstileRequired) {
    const result = await verifyTurnstile({
      token: input.turnstileToken,
      ip: input.ip,
      secretKey: config.turnstileSecretKey,
      fetchImpl: input.fetchImpl,
    });
    if (!result.ok) {
      return result;
    }
  }

  if (db) {
    const frequency = await checkIpFrequency({
      db,
      ip: input.ip,
      now,
      config,
    });
    if (!frequency.ok) {
      return frequency;
    }

    if (config.inviteRequired) {
      const invite = await checkInvite({
        db,
        code: input.inviteCode,
        now,
      });
      if (!invite.ok) {
        return invite;
      }
    }
  }

  return { ok: true, status: 200 };
}

export async function recordRegistrationAudit(
  input: RegistrationSecurityInput
): Promise<RegistrationSecurityResult> {
  const db = getRegistrationDatabase(input.env);
  const now = input.now ?? Date.now();

  if (!db) {
    return { ok: true, status: 200 };
  }

  await db
    .prepare(
      `INSERT INTO registration_audit (username, ip, created_at)
       VALUES (?, ?, ?)`
    )
    .bind(input.username, input.ip, now)
    .run();

  return { ok: true, status: 200 };
}

export async function recordSuccessfulRegistration(
  input: RegistrationSecurityInput
): Promise<RegistrationSecurityResult> {
  const consumed = await consumeRegistrationInvite(input);
  if (!consumed.ok) {
    return consumed;
  }

  return recordRegistrationAudit(input);
}
