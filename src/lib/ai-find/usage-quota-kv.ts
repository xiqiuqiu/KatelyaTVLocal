import { Redis } from '@upstash/redis';

import { getUtcDayKey } from '@/lib/utc-day';

type QuotaEndpoint = 'find' | 'group';
type QuotaScopeName = 'user' | 'ip' | 'global';

interface QuotaScopeRef {
  scope: QuotaScopeName;
  subject: string;
  limit: number;
}

const COUNTER_TTL_SECONDS = 3 * 24 * 60 * 60;

let client: Redis | null = null;

function getClient(): Redis | null {
  // Upstash 客户端依赖 fetch；测试环境与老 Node 没有全局 fetch 时退回 D1 缺失提示
  if (typeof fetch !== 'function') return null;
  if (process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'upstash') return null;
  const url = process.env.UPSTASH_URL;
  const token = process.env.UPSTASH_TOKEN;
  if (!url || !token) return null;
  if (!client) {
    client = new Redis({ url, token });
  }
  return client;
}

function counterKey(
  endpoint: QuotaEndpoint,
  scopeName: QuotaScopeName,
  subject: string,
  dayKey: string
): string {
  return `ai-find:usage:${endpoint}:${scopeName}:${subject}:${dayKey}`;
}

export type KvQuotaOps = {
  readCounts: (
    endpoint: QuotaEndpoint,
    scopes: QuotaScopeRef[],
    dayKey: string
  ) => Promise<number[]>;
  incrementIfUnderLimit: (
    endpoint: QuotaEndpoint,
    scope: QuotaScopeRef,
    dayKey: string,
    now?: number
  ) => Promise<boolean>;
  decrement: (
    endpoint: QuotaEndpoint,
    scope: QuotaScopeRef,
    dayKey: string,
    now?: number
  ) => Promise<void>;
};

/**
 * Upstash 计数器版本：仅当本地/自托管使用 upstash 存储且没有 D1 时启用，
 * 让 AI 找片在没有 D1 的环境里也能按日限流，而不是直接 503。
 */
export function createKvQuotaOps(): KvQuotaOps | null {
  if (!getClient()) return null;

  return {
    async readCounts(endpoint, scopes, dayKey) {
      const redis = getClient();
      if (!redis) return scopes.map(() => 0);
      const keys = scopes.map((scope) =>
        counterKey(endpoint, scope.scope, scope.subject, dayKey)
      );
      const values = await redis.mget<(number | string | null)[]>(...keys);
      return values.map((value) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      });
    },

    async incrementIfUnderLimit(endpoint, scope, dayKey) {
      const redis = getClient();
      if (!redis) return true;
      const key = counterKey(endpoint, scope.scope, scope.subject, dayKey);
      const next = await redis.incr(key);
      if (next === 1) {
        await redis.expire(key, COUNTER_TTL_SECONDS);
      }
      if (next > scope.limit) {
        await redis.decr(key);
        return false;
      }
      return true;
    },

    async decrement(endpoint, scope, dayKey) {
      const redis = getClient();
      if (!redis) return;
      const key = counterKey(endpoint, scope.scope, scope.subject, dayKey);
      const current = Number((await redis.get<number | string>(key)) ?? 0);
      if (current <= 1) {
        await redis.del(key);
        return;
      }
      await redis.decr(key);
    },
  };
}

export function getKvQuotaDayKey(now: number): string {
  return getUtcDayKey(now);
}
