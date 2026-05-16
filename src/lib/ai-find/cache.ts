interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

export function getAiFindCache<T>(key: string, now = Date.now()): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= now) {
    memoryCache.delete(key);
    return null;
  }

  return entry.value as T;
}

export function setAiFindCache<T>(
  key: string,
  value: T,
  ttlSeconds: number,
  now = Date.now()
): void {
  memoryCache.set(key, {
    value,
    expiresAt: now + ttlSeconds * 1000,
  });
}

export function clearAiFindCache(): void {
  memoryCache.clear();
}

