interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  first: <T = unknown>() => Promise<T | null>;
  run: () => Promise<unknown>;
}

interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike;
}

type AiFindQuotaEndpoint = 'find' | 'group';

export interface AiFindQuotaConfig {
  dailyLimitPerUser: number;
  dailyLimitPerIp: number;
  dailyLimitGlobal: number;
  groupDailyLimitPerUser: number;
  groupDailyLimitPerIp: number;
  groupDailyLimitGlobal: number;
}

export interface AiFindQuotaInput {
  username: string;
  ip: string;
  endpoint: AiFindQuotaEndpoint;
  config: AiFindQuotaConfig;
  now?: number;
  env?: { DB?: D1DatabaseLike } | Record<string, unknown>;
}

export interface AiFindQuotaResult {
  allowed: boolean;
  status: number;
  reason?: 'missing-d1' | 'user-limit' | 'ip-limit' | 'global-limit';
  message?: string;
  resetAt: number;
  remaining: {
    user: number;
    ip: number;
    global: number;
  };
}

interface UsageScope {
  scope: 'user' | 'ip' | 'global';
  subject: string;
  limit: number;
}

interface UsageRow {
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function getQuotaDatabase(
  source?: AiFindQuotaInput['env']
): D1DatabaseLike | null {
  const db =
    (source as { DB?: D1DatabaseLike } | undefined)?.DB ||
    ((process.env as unknown as { DB?: D1DatabaseLike }).DB ?? null);

  if (db && typeof db.prepare === 'function') {
    return db;
  }

  return null;
}

function getUtcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function getNextUtcDayStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1
  );
}

function getScopes(input: AiFindQuotaInput): UsageScope[] {
  const isGroup = input.endpoint === 'group';
  return [
    {
      scope: 'user',
      subject: input.username,
      limit: isGroup
        ? input.config.groupDailyLimitPerUser
        : input.config.dailyLimitPerUser,
    },
    {
      scope: 'ip',
      subject: input.ip,
      limit: isGroup
        ? input.config.groupDailyLimitPerIp
        : input.config.dailyLimitPerIp,
    },
    {
      scope: 'global',
      subject: 'global',
      limit: isGroup
        ? input.config.groupDailyLimitGlobal
        : input.config.dailyLimitGlobal,
    },
  ];
}

function getScopeKey(endpoint: AiFindQuotaEndpoint, scope: UsageScope['scope']) {
  return `ai-find:${endpoint}:${scope}`;
}

async function readUsageCount({
  db,
  endpoint,
  scope,
  dayKey,
}: {
  db: D1DatabaseLike;
  endpoint: AiFindQuotaEndpoint;
  scope: UsageScope;
  dayKey: string;
}): Promise<number> {
  const row = await db
    .prepare(
      `SELECT count
       FROM ai_find_usage_daily
       WHERE scope = ? AND subject = ? AND day_key = ?`
    )
    .bind(getScopeKey(endpoint, scope.scope), scope.subject, dayKey)
    .first<UsageRow>();

  return row?.count ?? 0;
}

async function incrementUsage({
  db,
  endpoint,
  scope,
  dayKey,
  now,
}: {
  db: D1DatabaseLike;
  endpoint: AiFindQuotaEndpoint;
  scope: UsageScope;
  dayKey: string;
  now: number;
}) {
  await db
    .prepare(
      `INSERT INTO ai_find_usage_daily
       (scope, subject, day_key, count, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(scope, subject, day_key)
       DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`
    )
    .bind(getScopeKey(endpoint, scope.scope), scope.subject, dayKey, now)
    .run();
}

export async function checkAndConsumeAiFindQuota(
  input: AiFindQuotaInput
): Promise<AiFindQuotaResult> {
  const db = getQuotaDatabase(input.env);
  const now = input.now ?? Date.now();
  const resetAt = getNextUtcDayStart(now);
  const emptyRemaining = { user: 0, ip: 0, global: 0 };

  if (!db) {
    return {
      allowed: false,
      status: 503,
      reason: 'missing-d1',
      message: 'AI 找片额度存储未配置',
      resetAt,
      remaining: emptyRemaining,
    };
  }

  const dayKey = getUtcDayKey(now);
  const scopes = getScopes(input);
  const counts = await Promise.all(
    scopes.map((scope) =>
      readUsageCount({ db, endpoint: input.endpoint, scope, dayKey })
    )
  );
  const remaining = {
    user: Math.max(0, scopes[0].limit - counts[0]),
    ip: Math.max(0, scopes[1].limit - counts[1]),
    global: Math.max(0, scopes[2].limit - counts[2]),
  };

  const blockedIndex = counts.findIndex(
    (count, index) => count >= scopes[index].limit
  );

  if (blockedIndex >= 0) {
    const blockedScope = scopes[blockedIndex].scope;
    const reason =
      blockedScope === 'user'
        ? 'user-limit'
        : blockedScope === 'ip'
        ? 'ip-limit'
        : 'global-limit';

    return {
      allowed: false,
      status: 429,
      reason,
      message:
        blockedScope === 'global'
          ? 'AI 找片今日全站次数已达到上限'
          : 'AI 找片次数已达到今日上限',
      resetAt,
      remaining,
    };
  }

  await Promise.all(
    scopes.map((scope) =>
      incrementUsage({ db, endpoint: input.endpoint, scope, dayKey, now })
    )
  );

  return {
    allowed: true,
    status: 200,
    resetAt,
    remaining: {
      user: Math.max(0, remaining.user - 1),
      ip: Math.max(0, remaining.ip - 1),
      global: Math.max(0, remaining.global - 1),
    },
  };
}

export function getAiFindQuotaResetMs(now = Date.now()): number {
  return Math.max(0, getNextUtcDayStart(now) - now || DAY_MS);
}
