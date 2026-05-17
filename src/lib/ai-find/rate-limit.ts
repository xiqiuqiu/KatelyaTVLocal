interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const rateLimitStore = new Map<string, RateLimitEntry>();

export function checkAiFindRateLimit({
  key,
  limit,
  now = Date.now(),
}: {
  key: string;
  limit: number;
  now?: number;
}): { allowed: boolean; remaining: number; resetAt: number } {
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart >= DAY_MS) {
    rateLimitStore.set(key, {
      count: 1,
      windowStart: now,
    });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      resetAt: now + DAY_MS,
    };
  }

  if (entry.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.windowStart + DAY_MS,
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.windowStart + DAY_MS,
  };
}

export function clearAiFindRateLimits(): void {
  rateLimitStore.clear();
}

