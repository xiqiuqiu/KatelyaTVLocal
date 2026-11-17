import type { AiFindSavedRecord, AiFindSavedRecordSummary } from '@/lib/types';

export const AI_FIND_SAVED_RECORD_LIMIT = 30;

export type AiFindSavedRecordMap = Record<string, AiFindSavedRecord>;

const SAVED_RECORD_POSTER_LIMIT = 3;

/** 按查询返回顺序取前几张可用海报（去重、跳过空值）。 */
function collectSavedRecordPosters(
  response: AiFindSavedRecord['response']
): string[] {
  const posters: string[] = [];
  const seen = new Set<string>();

  for (const group of response.groups) {
    for (const aggregated of group.groups) {
      const poster = aggregated.poster?.trim();
      if (!poster || seen.has(poster)) continue;
      seen.add(poster);
      posters.push(poster);
      if (posters.length >= SAVED_RECORD_POSTER_LIMIT) return posters;
    }
  }

  return posters;
}

export function summarizeAiFindSavedRecord(
  record: AiFindSavedRecord
): AiFindSavedRecordSummary {
  return {
    id: record.id,
    query: record.query,
    answer: record.response.answer,
    candidateCount: record.response.candidateQueries.length,
    foundGroupCount: record.response.groups.reduce(
      (count, group) => count + group.groupedCount,
      0
    ),
    posters: collectSavedRecordPosters(record.response),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastOpenedAt: record.lastOpenedAt,
    openedCount: record.openedCount,
  };
}

export function listAiFindSavedRecordSummaries(
  records: AiFindSavedRecordMap
): AiFindSavedRecordSummary[] {
  return Object.values(records)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, AI_FIND_SAVED_RECORD_LIMIT)
    .map(summarizeAiFindSavedRecord);
}

export function pruneAiFindSavedRecords(
  records: AiFindSavedRecordMap
): AiFindSavedRecordMap {
  const entries = Object.entries(records)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, AI_FIND_SAVED_RECORD_LIMIT);

  return Object.fromEntries(entries);
}
