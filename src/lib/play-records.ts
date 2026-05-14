import type { PlayRecord } from '@/lib/db.client';

export interface ContinueWatchingRecord extends PlayRecord {
  key: string;
  groupedKeys: string[];
}

function normalizeRecordLabel(value?: string): string {
  return value?.trim().toLowerCase().replace(/\s+/g, '') || '';
}

function getRecordKind(record: PlayRecord): 'movie' | 'tv' {
  return record.total_episodes > 1 ? 'tv' : 'movie';
}

function getRecordSignatures(record: PlayRecord): string[] {
  const year = normalizeRecordLabel(record.year);
  const kind = getRecordKind(record);
  const labels = [record.search_title, record.title]
    .map(normalizeRecordLabel)
    .filter(Boolean);

  if (labels.length === 0) {
    return [`unknown::${year}::${kind}`];
  }

  return Array.from(new Set(labels)).map(
    (label) => `${label}::${year}::${kind}`
  );
}

export function buildContinueWatchingRecords(
  allRecords: Record<string, PlayRecord>
): ContinueWatchingRecord[] {
  const sortedEntries = Object.entries(allRecords).sort(
    ([, left], [, right]) => right.save_time - left.save_time
  );
  const groupedRecords: ContinueWatchingRecord[] = [];
  const signatureToGroupIndex = new Map<string, number>();

  sortedEntries.forEach(([key, record]) => {
    const signatures = getRecordSignatures(record);
    const matchedGroupIndex = signatures.reduce<number | undefined>(
      (foundIndex, signature) =>
        foundIndex ?? signatureToGroupIndex.get(signature),
      undefined
    );

    if (matchedGroupIndex === undefined) {
      const nextGroupIndex = groupedRecords.length;
      groupedRecords.push({
        ...record,
        key,
        groupedKeys: [key],
      });

      signatures.forEach((signature) => {
        signatureToGroupIndex.set(signature, nextGroupIndex);
      });
      return;
    }

    groupedRecords[matchedGroupIndex].groupedKeys.push(key);
    signatures.forEach((signature) => {
      signatureToGroupIndex.set(signature, matchedGroupIndex);
    });
  });

  return groupedRecords;
}
