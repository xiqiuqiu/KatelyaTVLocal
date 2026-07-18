import type { PlayRecord } from '@/lib/db.client';
import {
  buildWatchProgressContentKey,
  isWatchProgressStorageKey,
  parseWatchProgressStorageKey,
} from '@/lib/watch-progress';

export interface ContinueWatchingRecord extends PlayRecord {
  key: string;
  groupedKeys: string[];
}

function getRecordKind(record: PlayRecord): 'movie' | 'tv' {
  return record.total_episodes > 1 ? 'tv' : 'movie';
}

function getRecordSignatures(record: PlayRecord, key: string): string[] {
  const kind = getRecordKind(record);
  const contentKeys = new Set<string>();

  // wp: 主键在写入时把 contentKey 嵌入 key（基于 videoTitle）。
  const parsed = parseWatchProgressStorageKey(key);
  if (parsed) {
    contentKeys.add(parsed.contentKey);
  }

  // 同时基于记录自身的 search_title 与 title 推导 contentKey，
  // 使 dual-write 出的 wp 主键与 legacy 记录（源返回名与搜索词不一致时）仍能归并到同一张卡。
  [record.search_title, record.title].forEach((title) => {
    if (title) {
      contentKeys.add(buildWatchProgressContentKey({ title, year: record.year }));
    }
  });

  if (contentKeys.size === 0) {
    contentKeys.add(buildWatchProgressContentKey({ title: '', year: record.year }));
  }

  return Array.from(contentKeys).map((contentKey) => `${contentKey}::${kind}`);
}

/**
 * Continue Watching groups by Watch Progress content identity.
 * Entry card uses the newest save_time record; route comes from route_* or legacy key.
 */
export function buildContinueWatchingRecords(
  allRecords: Record<string, PlayRecord>
): ContinueWatchingRecord[] {
  const sortedEntries = Object.entries(allRecords).sort(
    ([, left], [, right]) => right.save_time - left.save_time
  );
  const groupedRecords: ContinueWatchingRecord[] = [];
  const signatureToGroupIndex = new Map<string, number>();

  sortedEntries.forEach(([key, record]) => {
    const signatures = getRecordSignatures(record, key);
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

export function resolveContinueWatchingRoute(
  record: ContinueWatchingRecord
): { source: string; id: string } | null {
  if (record.route_source && record.route_id) {
    return { source: record.route_source, id: record.route_id };
  }

  if (isWatchProgressStorageKey(record.key)) {
    for (const groupedKey of record.groupedKeys) {
      if (isWatchProgressStorageKey(groupedKey)) {
        continue;
      }
      const plusIndex = groupedKey.indexOf('+');
      if (plusIndex > 0) {
        return {
          source: groupedKey.slice(0, plusIndex),
          id: groupedKey.slice(plusIndex + 1),
        };
      }
    }
    return null;
  }

  const plusIndex = record.key.indexOf('+');
  if (plusIndex <= 0) {
    return null;
  }
  return {
    source: record.key.slice(0, plusIndex),
    id: record.key.slice(plusIndex + 1),
  };
}
