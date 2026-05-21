interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  all: <T = unknown>() => Promise<{ results?: T[] }>;
}

interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike;
}

type UsageScope = 'user' | 'ip' | 'global';
type UsageEndpoint = 'find' | 'group';

export interface AiFindUsageRow {
  dayKey: string;
  endpoint: UsageEndpoint;
  scope: UsageScope;
  subject: string;
  count: number;
  updatedAt: number;
}

export interface AiFindUsageSummary {
  dayKey: string;
  find: number;
  group: number;
  total: number;
}

export interface AiFindUsageSubject {
  subject: string;
  scope: UsageScope;
  endpoint: UsageEndpoint;
  count: number;
  updatedAt: number;
}

export interface AiFindUsageReport {
  generatedAt: number;
  days: AiFindUsageSummary[];
  today: {
    dayKey: string;
    find: {
      total: number;
      global: number;
    };
    group: {
      total: number;
      global: number;
    };
  };
  topSubjects: AiFindUsageSubject[];
}

export interface AiFindUsageReportInput {
  env?: { DB?: D1DatabaseLike } | Record<string, unknown>;
  now?: number;
  days?: number;
  subjectLimit?: number;
}

function getReportDatabase(
  source?: AiFindUsageReportInput['env']
): D1DatabaseLike | null {
  const db =
    (source as { DB?: D1DatabaseLike } | undefined)?.DB ||
    ((process.env as unknown as { DB?: D1DatabaseLike }).DB ?? null);

  if (db && typeof db.prepare === 'function') {
    return db;
  }

  return null;
}

function getUtcDayKey(now: number, offsetDays = 0): string {
  const date = new Date(now);
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + offsetDays
    )
  )
    .toISOString()
    .slice(0, 10);
}

function parseScope(value: string): {
  endpoint: UsageEndpoint;
  scope: UsageScope;
} | null {
  const match = /^ai-find:(find|group):(user|ip|global)$/.exec(value);
  if (!match) {
    return null;
  }

  return {
    endpoint: match[1] as UsageEndpoint,
    scope: match[2] as UsageScope,
  };
}

function normalizeRows(
  rows: Array<{
    scope: string;
    subject: string;
    day_key: string;
    count: number;
    updated_at: number;
  }>
): AiFindUsageRow[] {
  return rows.flatMap((row) => {
    const parsed = parseScope(row.scope);
    if (!parsed) {
      return [];
    }

    return [
      {
        dayKey: row.day_key,
        endpoint: parsed.endpoint,
        scope: parsed.scope,
        subject: row.subject,
        count: Number(row.count) || 0,
        updatedAt: Number(row.updated_at) || 0,
      },
    ];
  });
}

function summarizeDays(
  rows: AiFindUsageRow[],
  startDayKey: string,
  endDayKey: string
): AiFindUsageSummary[] {
  const summaries = new Map<string, AiFindUsageSummary>();

  for (const row of rows) {
    if (row.scope !== 'global') {
      continue;
    }

    const summary =
      summaries.get(row.dayKey) ||
      ({
        dayKey: row.dayKey,
        find: 0,
        group: 0,
        total: 0,
      } satisfies AiFindUsageSummary);

    summary[row.endpoint] += row.count;
    summary.total = summary.find + summary.group;
    summaries.set(row.dayKey, summary);
  }

  const ordered: AiFindUsageSummary[] = [];
  const start = new Date(`${startDayKey}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDayKey}T00:00:00.000Z`).getTime();

  for (let cursor = start; cursor <= end; cursor += 24 * 60 * 60 * 1000) {
    const dayKey = new Date(cursor).toISOString().slice(0, 10);
    ordered.push(
      summaries.get(dayKey) || {
        dayKey,
        find: 0,
        group: 0,
        total: 0,
      }
    );
  }

  return ordered;
}

export async function getAiFindUsageReport(
  input: AiFindUsageReportInput = {}
): Promise<AiFindUsageReport> {
  const db = getReportDatabase(input.env);
  if (!db) {
    throw new Error('AI 找片用量存储未配置');
  }

  const now = input.now ?? Date.now();
  const days = Math.min(Math.max(input.days ?? 7, 1), 31);
  const subjectLimit = Math.min(Math.max(input.subjectLimit ?? 20, 1), 100);
  const todayKey = getUtcDayKey(now);
  const startDayKey = getUtcDayKey(now, -(days - 1));

  const result = await db
    .prepare(
      `SELECT scope, subject, day_key, count, updated_at
       FROM ai_find_usage_daily
       WHERE day_key >= ? AND day_key <= ?
       ORDER BY day_key DESC, count DESC`
    )
    .bind(startDayKey, todayKey)
    .all<{
      scope: string;
      subject: string;
      day_key: string;
      count: number;
      updated_at: number;
    }>();

  const rows = normalizeRows(result.results || []);
  const daySummaries = summarizeDays(rows, startDayKey, todayKey);
  const todayRows = rows.filter((row) => row.dayKey === todayKey);

  const todayFindGlobal =
    todayRows.find(
      (row) => row.endpoint === 'find' && row.scope === 'global'
    )?.count ?? 0;
  const todayGroupGlobal =
    todayRows.find(
      (row) => row.endpoint === 'group' && row.scope === 'global'
    )?.count ?? 0;

  return {
    generatedAt: now,
    days: daySummaries,
    today: {
      dayKey: todayKey,
      find: {
        total: todayFindGlobal,
        global: todayFindGlobal,
      },
      group: {
        total: todayGroupGlobal,
        global: todayGroupGlobal,
      },
    },
    topSubjects: todayRows
      .filter((row) => row.scope !== 'global')
      .sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt)
      .slice(0, subjectLimit)
      .map((row) => ({
        subject: row.subject,
        scope: row.scope,
        endpoint: row.endpoint,
        count: row.count,
        updatedAt: row.updatedAt,
      })),
  };
}
