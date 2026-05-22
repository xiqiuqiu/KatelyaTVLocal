import type {
  AiFindSavedRecord,
  AiFindSavedRecordStatus,
  AiFindSavedRecordSummary,
} from '@/lib/types';

import type { AiFindResponse } from './types';

export function createAiFindSavedRecordId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function listAiFindSavedRecords(): Promise<
  AiFindSavedRecordSummary[]
> {
  const response = await fetch('/api/ai/find/history');
  if (!response.ok) return [];

  const payload = (await response.json()) as {
    records?: AiFindSavedRecordSummary[];
  };
  return payload.records || [];
}

export async function getAiFindSavedRecord(
  id: string
): Promise<AiFindSavedRecord | null> {
  const response = await fetch(
    `/api/ai/find/history/${encodeURIComponent(id)}`
  );
  if (!response.ok) return null;

  const payload = (await response.json()) as { record?: AiFindSavedRecord };
  return payload.record || null;
}

export async function saveAiFindSavedRecordSnapshot({
  id,
  query,
  response,
  status,
  createdAt,
}: {
  id: string;
  query: string;
  response: AiFindResponse;
  status: AiFindSavedRecordStatus;
  createdAt: number;
}): Promise<void> {
  await fetch('/api/ai/find/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, query, response, status, createdAt }),
  });
}

export async function deleteAiFindSavedRecord(id: string): Promise<void> {
  await fetch(`/api/ai/find/history/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
