export interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  all: <T = unknown>() => Promise<{ results?: T[] }>;
  first: <T = unknown>() => Promise<T | null>;
  run: () => Promise<{ meta?: { changes?: number } } | unknown>;
}

export interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike;
}

export function getD1Database(
  env?: Record<string, unknown>
): D1DatabaseLike | null {
  const db =
    (env as { DB?: D1DatabaseLike } | undefined)?.DB ||
    ((process.env as unknown as { DB?: D1DatabaseLike }).DB ?? null);

  if (db && typeof db.prepare === 'function') {
    return db;
  }

  return null;
}
