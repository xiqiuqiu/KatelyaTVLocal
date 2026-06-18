export const DEFAULT_RECENT_PLAY_RECORD_LIMIT = 50;
export const MAX_RECENT_PLAY_RECORD_LIMIT = 200;

export interface ParsedPlayRecordKey {
  source: string;
  id: string;
}

export function parsePlayRecordKey(key: string): ParsedPlayRecordKey | null {
  const separatorIndex = key.indexOf('+');
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return null;
  }

  return {
    source: key.slice(0, separatorIndex),
    id: key.slice(separatorIndex + 1),
  };
}

export function normalizePlayRecordLimit(
  rawLimit: string | number | null | undefined
): number | undefined {
  if (rawLimit === null || rawLimit === undefined || rawLimit === '') {
    return undefined;
  }

  const parsed =
    typeof rawLimit === 'number' ? rawLimit : Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_RECENT_PLAY_RECORD_LIMIT;
  }

  return Math.min(Math.floor(parsed), MAX_RECENT_PLAY_RECORD_LIMIT);
}

export function getRecentPlayRecordsFromAll<T extends { save_time: number }>(
  records: Record<string, T>,
  limit: number
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(records)
      .sort(([, left], [, right]) => right.save_time - left.save_time)
      .slice(0, limit)
  );
}
