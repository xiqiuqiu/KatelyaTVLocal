import type { AiFindSavedRecord, AiFindSavedRecordSummary } from '@/lib/types';

export const AI_FIND_SAVED_RECORD_LIMIT = 30;

export type AiFindSavedRecordMap = Record<string, AiFindSavedRecord>;

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
