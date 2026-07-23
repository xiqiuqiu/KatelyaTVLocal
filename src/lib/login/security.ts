import { D1DatabaseLike, getD1Database } from '@/lib/d1';
import { verifyTurnstileToken } from '@/lib/turnstile';

export interface LoginSecurityInput {
  username: string;
  turnstileToken?: string;
  ip: string;
  now?: number;
  env?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export type LoginSecurityResult =
  | { ok: true; status: 200; attemptKey: string }
  | { ok: false; status: 400 | 429 | 500; error: string };

interface LoginSecurityConfig {
  turnstileRequired: boolean;
  turnstileSecretKey: string;
  rateWindowSeconds: number;
  rateWindowLimit: number;
}

interface CountRow {
  count: number;
}

function getEnvValue(env: Record<string, unknown>, key: string): unknown {
  return env[key] ?? (process.env as Record<string, unknown>)[key];
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

function getLoginSecurityConfig(
  env: Record<string, unknown> = process.env
): LoginSecurityConfig {
  return {
    turnstileRequired: parseBoolean(
      getEnvValue(env, 'LOGIN_TURNSTILE_REQUIRED'),
      false
    ),
    turnstileSecretKey: String(
      getEnvValue(env, 'TURNSTILE_SECRET_KEY') || ''
    ).trim(),
    rateWindowSeconds: parseNumber(
      getEnvValue(env, 'LOGIN_RATE_WINDOW_SECONDS'),
      900,
      60,
      86400
    ),
    // Default 0 keeps non-D1 deployments usable; enable explicitly on D1.
    rateWindowLimit: parseNumber(
      getEnvValue(env, 'LOGIN_RATE_WINDOW_LIMIT'),
      0,
      0,
      100
    ),
  };
}

function getLoginDatabase(
  env?: Record<string, unknown>
): D1DatabaseLike | null {
  return getD1Database(env);
}

function normalizeAttemptInput(ip: string, username: string): string {
  return `${ip.trim().toLowerCase()}\n${username.trim().toLowerCase()}`;
}

async function createAttemptKey(ip: string, username: string): Promise<string> {
  const input = new TextEncoder().encode(normalizeAttemptInput(ip, username));
  const digest = await crypto.subtle.digest('SHA-256', input);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function checkFailedAttempts({
  db,
  attemptKey,
  now,
  config,
}: {
  db: D1DatabaseLike;
  attemptKey: string;
  now: number;
  config: LoginSecurityConfig;
}): Promise<LoginSecurityResult | null> {
  const since = now - config.rateWindowSeconds * 1000;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM login_security_events
       WHERE attempt_key = ? AND success = 0 AND created_at >= ?`
    )
    .bind(attemptKey, since)
    .first<CountRow>();

  if ((row?.count ?? 0) >= config.rateWindowLimit) {
    return {
      ok: false,
      status: 429,
      error: '登录尝试过于频繁，请稍后再试',
    };
  }

  return null;
}

export async function validateLoginSecurity(
  input: LoginSecurityInput
): Promise<LoginSecurityResult> {
  const config = getLoginSecurityConfig(input.env);
  const now = input.now ?? Date.now();

  if (config.turnstileRequired) {
    const turnstile = await verifyTurnstileToken({
      token: input.turnstileToken,
      ip: input.ip,
      secretKey: config.turnstileSecretKey,
      fetchImpl: input.fetchImpl,
    });
    if (!turnstile.ok) {
      return {
        ok: false,
        status: turnstile.status === 500 ? 500 : 400,
        error: turnstile.error || '人机验证失败，请重试',
      };
    }
  }

  const attemptKey = await createAttemptKey(input.ip, input.username);
  if (config.rateWindowLimit === 0) {
    return { ok: true, status: 200, attemptKey };
  }

  const db = getLoginDatabase(input.env);
  if (!db) {
    return { ok: false, status: 500, error: '登录安全存储未配置' };
  }

  try {
    const frequency = await checkFailedAttempts({
      db,
      attemptKey,
      now,
      config,
    });
    if (frequency) {
      return frequency;
    }
  } catch {
    return { ok: false, status: 500, error: '登录安全存储不可用' };
  }

  return { ok: true, status: 200, attemptKey };
}

export async function recordLoginResult(input: {
  attemptKey: string;
  success: boolean;
  now?: number;
  env?: Record<string, unknown>;
}): Promise<void> {
  const config = getLoginSecurityConfig(input.env);
  if (config.rateWindowLimit === 0) {
    return;
  }

  const db = getLoginDatabase(input.env);
  if (!db) {
    throw new Error('登录安全存储未配置');
  }

  const now = input.now ?? Date.now();
  if (input.success) {
    await db
      .prepare('DELETE FROM login_security_events WHERE attempt_key = ?')
      .bind(input.attemptKey)
      .run();
  }

  await db
    .prepare(
      `INSERT INTO login_security_events (attempt_key, success, created_at)
       VALUES (?, ?, ?)`
    )
    .bind(input.attemptKey, input.success ? 1 : 0, now)
    .run();
}
