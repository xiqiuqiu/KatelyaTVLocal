import { D1DatabaseLike, getD1Database } from '@/lib/d1';
import { getUtcDayKey } from '@/lib/utc-day';

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
  return getD1Database(source);
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
       WHERE scope = ? AND subject = ? AND day_key = ?
       LIMIT 1`
    )
    .bind(getScopeKey(endpoint, scope.scope), scope.subject, dayKey)
    .first<UsageRow>();

  return row?.count ?? 0;
}

function getRemaining(scopes: UsageScope[], counts: number[]) {
  return {
    user: Math.max(0, scopes[0].limit - counts[0]),
    ip: Math.max(0, scopes[1].limit - counts[1]),
    global: Math.max(0, scopes[2].limit - counts[2]),
  };
}

function getLimitReason(scope: UsageScope['scope']) {
  return scope === 'user'
    ? 'user-limit'
    : scope === 'ip'
    ? 'ip-limit'
    : 'global-limit';
}

async function readUsageCounts({
  db,
  endpoint,
  scopes,
  dayKey,
}: {
  db: D1DatabaseLike;
  endpoint: AiFindQuotaEndpoint;
  scopes: UsageScope[];
  dayKey: string;
}): Promise<number[]> {
  return Promise.all(
    scopes.map((scope) => readUsageCount({ db, endpoint, scope, dayKey }))
  );
}

async function incrementUsageIfUnderLimit({
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
}): Promise<boolean> {
  const result = (await db
    .prepare(
      `INSERT INTO ai_find_usage_daily
       (scope, subject, day_key, count, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(scope, subject, day_key)
       DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
       WHERE count < ?`
    )
    .bind(
      getScopeKey(endpoint, scope.scope),
      scope.subject,
      dayKey,
      now,
      scope.limit
    )
    .run()) as { meta?: { changes?: number } } | undefined;

  return (result?.meta?.changes ?? 1) > 0;
}

async function decrementUsage({
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
      `UPDATE ai_find_usage_daily
       SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END,
           updated_at = ?
       WHERE scope = ? AND subject = ? AND day_key = ?`
    )
    .bind(now, getScopeKey(endpoint, scope.scope), scope.subject, dayKey)
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
  const counts = await readUsageCounts({
    db,
    endpoint: input.endpoint,
    scopes,
    dayKey,
  });
  const remaining = getRemaining(scopes, counts);

  const blockedIndex = counts.findIndex(
    (count, index) => count >= scopes[index].limit
  );

  if (blockedIndex >= 0) {
    const blockedScope = scopes[blockedIndex].scope;

    return {
      allowed: false,
      status: 429,
      reason: getLimitReason(blockedScope),
      message:
        blockedScope === 'global'
          ? 'AI 找片今日全站次数已达到上限'
          : 'AI 找片次数已达到今日上限',
      resetAt,
      remaining,
    };
  }

  const consumedScopes: UsageScope[] = [];
  for (const scope of scopes) {
    const consumed = await incrementUsageIfUnderLimit({
      db,
      endpoint: input.endpoint,
      scope,
      dayKey,
      now,
    });

    if (!consumed) {
      await Promise.all(
        consumedScopes.map((consumedScope) =>
          decrementUsage({
            db,
            endpoint: input.endpoint,
            scope: consumedScope,
            dayKey,
            now,
          })
        )
      );

      const latestCounts = await readUsageCounts({
        db,
        endpoint: input.endpoint,
        scopes,
        dayKey,
      });
      const blockedScope = scope.scope;

      return {
        allowed: false,
        status: 429,
        reason: getLimitReason(blockedScope),
        message:
          blockedScope === 'global'
            ? 'AI 找片今日全站次数已达到上限'
            : 'AI 找片次数已达到今日上限',
        resetAt,
        remaining: getRemaining(scopes, latestCounts),
      };
    }

    consumedScopes.push(scope);
  }

  const latestCounts = await readUsageCounts({
    db,
    endpoint: input.endpoint,
    scopes,
    dayKey,
  });

  return {
    allowed: true,
    status: 200,
    resetAt,
    remaining: getRemaining(scopes, latestCounts),
  };
}

export function getAiFindQuotaResetMs(now = Date.now()): number {
  return Math.max(0, getNextUtcDayStart(now) - now || DAY_MS);
}
