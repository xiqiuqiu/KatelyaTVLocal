# AI Find Saved Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save each successful AI find session as a user-private result snapshot so users can reopen prior AI find results without spending another AI call.

**Architecture:** Keep candidate count controlled only by the existing `AI_MAX_RESULTS` setting. The first AI endpoint still returns up to `AI_MAX_RESULTS` candidate titles, the browser still loads source groups progressively, and the browser persists a snapshot as those groups arrive. Saved records are separate from normal keyword search history because they contain AI candidates plus grouped source results.

**Tech Stack:** Next.js App Router edge routes, React client components, TypeScript, existing storage adapters, D1 migration SQL, Jest and React Testing Library.

---

## File Structure

- Modify `src/lib/types.ts`: add `AiFindSavedRecord`, `AiFindSavedRecordSummary`, `AiFindSavedRecordStatus`, and storage interface methods.
- Modify `src/lib/db.ts`: expose saved AI find methods through `DbManager`.
- Modify `src/lib/d1.db.ts`: persist saved AI find records in D1.
- Modify `src/lib/localstorage.db.ts`, `src/lib/redis.db.ts`, `src/lib/kvrocks.db.ts`, `src/lib/upstash.db.ts`: add equivalent storage methods so the feature works across current storage modes.
- Create `migrations/2026-05-22_ai_find_saved_records.sql`: D1 table and indexes.
- Create `src/app/api/ai/find/history/route.ts`: list summaries, create or update a record, and clear records for the logged-in user.
- Create `src/app/api/ai/find/history/[id]/route.ts`: read, update, or delete one saved record owned by the logged-in user.
- Create `src/lib/ai-find/history-client.ts`: browser helpers for saving and loading history.
- Modify `src/components/AiFindPanel.tsx`: show recent records, save snapshots, reopen saved records, and refresh only when the user asks.
- Create `src/components/AiFindPanel.test.tsx`: cover the user-visible history behavior.
- Modify `specs/features/AI_FIND_ASSISTANT.md`: document saved records and clarify that `AI_MAX_RESULTS` remains the single candidate-count control.

## Behavior Rules

- Candidate count is not split by "guessing a title" versus "recommendation list". `/api/ai/find` continues to use `config.maxResults`, which is loaded from `AI_MAX_RESULTS`.
- Opening a saved record must not call `/api/ai/find` or `/api/ai/find/group`.
- Pressing "刷新结果" runs the normal AI find flow again and updates the saved snapshot.
- Records are private to the logged-in user.
- Empty candidate responses are not saved.
- Records with candidates but no source groups may be saved as `partial` so users can reopen the candidate list after a page interruption.
- Keep at most 30 records per user in storage. When adding a new record, delete older records beyond the newest 30.

---

### Task 1: Add Saved Record Types and Storage Interface

**Files:**

- Modify: `src/lib/types.ts`
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Add shared types to `src/lib/types.ts`**

Add these imports and interfaces after the existing `SearchResult` import/type area is available. If `AiFindResponse` cannot be imported without a circular dependency, use `import type`.

```ts
import type { AiFindResponse } from '@/lib/ai-find/types';

export type AiFindSavedRecordStatus = 'partial' | 'complete';

export interface AiFindSavedRecord {
  id: string;
  userName: string;
  query: string;
  response: AiFindResponse;
  status: AiFindSavedRecordStatus;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  openedCount: number;
}

export interface AiFindSavedRecordSummary {
  id: string;
  query: string;
  answer: string;
  candidateCount: number;
  foundGroupCount: number;
  status: AiFindSavedRecordStatus;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  openedCount: number;
}
```

Then add these methods to `IStorage`:

```ts
getAiFindSavedRecords(userName: string): Promise<AiFindSavedRecordSummary[]>;
getAiFindSavedRecord(
  userName: string,
  id: string
): Promise<AiFindSavedRecord | null>;
upsertAiFindSavedRecord(
  userName: string,
  record: AiFindSavedRecord
): Promise<void>;
touchAiFindSavedRecord(userName: string, id: string): Promise<void>;
deleteAiFindSavedRecord(userName: string, id: string): Promise<void>;
clearAiFindSavedRecords(userName: string): Promise<void>;
```

- [ ] **Step 2: Run typecheck and verify the interface failure**

Run:

```bash
pnpm typecheck
```

Expected: fail because storage classes do not yet implement the new `IStorage` methods.

- [ ] **Step 3: Expose methods in `src/lib/db.ts`**

Update imports:

```ts
import {
  AiFindSavedRecord,
  AiFindSavedRecordSummary,
  Favorite,
  IStorage,
  PlayRecord,
} from './types';
```

Add these methods to `DbManager` after search history methods:

```ts
async getAiFindSavedRecords(
  userName: string
): Promise<AiFindSavedRecordSummary[]> {
  return this.storage.getAiFindSavedRecords(userName);
}

async getAiFindSavedRecord(
  userName: string,
  id: string
): Promise<AiFindSavedRecord | null> {
  return this.storage.getAiFindSavedRecord(userName, id);
}

async saveAiFindSavedRecord(
  userName: string,
  record: AiFindSavedRecord
): Promise<void> {
  await this.storage.upsertAiFindSavedRecord(userName, record);
}

async touchAiFindSavedRecord(userName: string, id: string): Promise<void> {
  await this.storage.touchAiFindSavedRecord(userName, id);
}

async deleteAiFindSavedRecord(userName: string, id: string): Promise<void> {
  await this.storage.deleteAiFindSavedRecord(userName, id);
}

async clearAiFindSavedRecords(userName: string): Promise<void> {
  await this.storage.clearAiFindSavedRecords(userName);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/db.ts
git commit -m "feat: define ai find saved record storage contract"
```

---

### Task 2: Add D1 Schema and Storage Implementations

**Files:**

- Create: `migrations/2026-05-22_ai_find_saved_records.sql`
- Modify: `src/lib/d1.db.ts`
- Modify: `src/lib/localstorage.db.ts`
- Modify: `src/lib/redis.db.ts`
- Modify: `src/lib/kvrocks.db.ts`
- Modify: `src/lib/upstash.db.ts`

- [ ] **Step 1: Create D1 migration**

Create `migrations/2026-05-22_ai_find_saved_records.sql`:

```sql
CREATE TABLE IF NOT EXISTS ai_find_saved_records (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  query TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL,
  opened_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ai_find_saved_records_user_updated
ON ai_find_saved_records(username, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_find_saved_records_user_opened
ON ai_find_saved_records(username, last_opened_at DESC);
```

- [ ] **Step 2: Implement D1 methods in `src/lib/d1.db.ts`**

Add these helpers near existing search history helpers:

```ts
private summarizeAiFindRecord(row: {
  id: string;
  query: string;
  response_json: string;
  status: string;
  created_at: number;
  updated_at: number;
  last_opened_at: number;
  opened_count: number;
}): AiFindSavedRecordSummary {
  const response = JSON.parse(row.response_json) as AiFindResponse;
  return {
    id: row.id,
    query: row.query,
    answer: response.answer,
    candidateCount: response.candidateQueries.length,
    foundGroupCount: response.groups.reduce(
      (count, group) => count + group.groupedCount,
      0
    ),
    status: row.status === 'complete' ? 'complete' : 'partial',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    openedCount: row.opened_count,
  };
}
```

Add the storage methods:

```ts
async getAiFindSavedRecords(
  userName: string
): Promise<AiFindSavedRecordSummary[]> {
  const db = await this.getDb();
  const result = await db
    .prepare(
      `SELECT id, query, response_json, status, created_at, updated_at,
              last_opened_at, opened_count
       FROM ai_find_saved_records
       WHERE username = ?
       ORDER BY updated_at DESC
       LIMIT 30`
    )
    .bind(userName)
    .all();

  return (result.results || []).map((row: any) =>
    this.summarizeAiFindRecord(row)
  );
}

async getAiFindSavedRecord(
  userName: string,
  id: string
): Promise<AiFindSavedRecord | null> {
  const db = await this.getDb();
  const row = await db
    .prepare(
      `SELECT id, username, query, response_json, status, created_at,
              updated_at, last_opened_at, opened_count
       FROM ai_find_saved_records
       WHERE username = ? AND id = ?`
    )
    .bind(userName, id)
    .first<any>();

  if (!row) return null;

  return {
    id: row.id,
    userName: row.username,
    query: row.query,
    response: JSON.parse(row.response_json) as AiFindResponse,
    status: row.status === 'complete' ? 'complete' : 'partial',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    openedCount: row.opened_count,
  };
}

async upsertAiFindSavedRecord(
  userName: string,
  record: AiFindSavedRecord
): Promise<void> {
  const db = await this.getDb();
  await db
    .prepare(
      `INSERT INTO ai_find_saved_records (
         id, username, query, response_json, status, created_at,
         updated_at, last_opened_at, opened_count
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         query = excluded.query,
         response_json = excluded.response_json,
         status = excluded.status,
         updated_at = excluded.updated_at`
    )
    .bind(
      record.id,
      userName,
      record.query,
      JSON.stringify(record.response),
      record.status,
      record.createdAt,
      record.updatedAt,
      record.lastOpenedAt,
      record.openedCount
    )
    .run();

  await db
    .prepare(
      `DELETE FROM ai_find_saved_records
       WHERE username = ?
       AND id NOT IN (
         SELECT id FROM ai_find_saved_records
         WHERE username = ?
         ORDER BY updated_at DESC
         LIMIT 30
       )`
    )
    .bind(userName, userName)
    .run();
}

async touchAiFindSavedRecord(userName: string, id: string): Promise<void> {
  const db = await this.getDb();
  await db
    .prepare(
      `UPDATE ai_find_saved_records
       SET last_opened_at = ?, opened_count = opened_count + 1
       WHERE username = ? AND id = ?`
    )
    .bind(Date.now(), userName, id)
    .run();
}

async deleteAiFindSavedRecord(userName: string, id: string): Promise<void> {
  const db = await this.getDb();
  await db
    .prepare(`DELETE FROM ai_find_saved_records WHERE username = ? AND id = ?`)
    .bind(userName, id)
    .run();
}

async clearAiFindSavedRecords(userName: string): Promise<void> {
  const db = await this.getDb();
  await db
    .prepare(`DELETE FROM ai_find_saved_records WHERE username = ?`)
    .bind(userName)
    .run();
}
```

- [ ] **Step 3: Implement non-D1 adapters with each backend's existing list pattern**

For `localstorage.db.ts`, store a JSON object under key `ai_find_saved_records:${userName}`. Use newest-first summaries and keep 30 records:

```ts
private getAiFindRecordsKey(userName: string): string {
  return `ai_find_saved_records:${userName}`;
}

async getAiFindSavedRecords(
  userName: string
): Promise<AiFindSavedRecordSummary[]> {
  const records = await this.getAiFindRecordMap(userName);
  return Object.values(records)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 30)
    .map((record) => ({
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
    }));
}
```

Use the same object-map logic in Redis, Kvrocks, and Upstash with their current JSON get/set helpers. The stored value shape is:

```ts
Record<string, AiFindSavedRecord>;
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add migrations/2026-05-22_ai_find_saved_records.sql src/lib/d1.db.ts src/lib/localstorage.db.ts src/lib/redis.db.ts src/lib/kvrocks.db.ts src/lib/upstash.db.ts
git commit -m "feat: persist ai find saved records"
```

---

### Task 3: Add Saved Record API Routes

**Files:**

- Create: `src/app/api/ai/find/history/route.ts`
- Create: `src/app/api/ai/find/history/[id]/route.ts`
- Create: `src/app/api/ai/find/history/route.test.ts`
- Create: `src/app/api/ai/find/history/[id]/route.test.ts`

- [ ] **Step 1: Write route tests for list and upsert**

Create `src/app/api/ai/find/history/route.test.ts`:

```ts
import { NextRequest } from 'next/server';

import { GET, POST } from './route';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    getAiFindSavedRecords: jest.fn(),
    saveAiFindSavedRecord: jest.fn(),
  },
}));

const { getAuthInfoFromCookie } = jest.requireMock('@/lib/auth');
const { db } = jest.requireMock('@/lib/db');

function request(body?: unknown) {
  return new NextRequest('https://example.com/api/ai/find/history', {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : undefined,
  });
}

describe('AI find history route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAuthInfoFromCookie.mockResolvedValue({ username: 'alice' });
  });

  it('lists saved record summaries for the current user', async () => {
    db.getAiFindSavedRecords.mockResolvedValue([
      {
        id: 'rec_1',
        query: '90年代港片动作片',
        answer: '已根据你的描述生成候选搜索词。',
        candidateCount: 5,
        foundGroupCount: 12,
        status: 'complete',
        createdAt: 1,
        updatedAt: 2,
        lastOpenedAt: 2,
        openedCount: 0,
      },
    ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      records: [
        expect.objectContaining({
          id: 'rec_1',
          query: '90年代港片动作片',
        }),
      ],
    });
    expect(db.getAiFindSavedRecords).toHaveBeenCalledWith('alice');
  });

  it('rejects invalid upsert payloads', async () => {
    const response = await POST(request({ query: '', response: null }));

    expect(response.status).toBe(400);
    expect(db.saveAiFindSavedRecord).not.toHaveBeenCalled();
  });

  it('upserts a valid saved record for the current user', async () => {
    const now = 1700000000000;
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const response = await POST(
      request({
        id: 'rec_1',
        query: '90年代港片动作片',
        status: 'partial',
        response: {
          answer: '已根据你的描述生成候选搜索词。',
          candidateQueries: [
            {
              query: '英雄本色',
              reason: '经典港片动作片',
              confidence: 'high',
              type: 'movie',
            },
          ],
          groups: [],
          suggestions: [],
          toolTrace: [],
          generatedAt: now,
        },
      })
    );

    expect(response.status).toBe(200);
    expect(db.saveAiFindSavedRecord).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({
        id: 'rec_1',
        userName: 'alice',
        query: '90年代港片动作片',
        status: 'partial',
      })
    );
  });
});
```

- [ ] **Step 2: Implement `src/app/api/ai/find/history/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import type { AiFindResponse } from '@/lib/ai-find/types';
import type { AiFindSavedRecordStatus } from '@/lib/types';

export const runtime = 'edge';

function isValidStatus(value: unknown): value is AiFindSavedRecordStatus {
  return value === 'partial' || value === 'complete';
}

function isValidResponse(value: unknown): value is AiFindResponse {
  const response = value as Partial<AiFindResponse> | null;
  return Boolean(
    response &&
      typeof response.answer === 'string' &&
      Array.isArray(response.candidateQueries) &&
      Array.isArray(response.groups) &&
      Array.isArray(response.suggestions) &&
      Array.isArray(response.toolTrace) &&
      typeof response.generatedAt === 'number'
  );
}

export async function GET(request: NextRequest) {
  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const records = await db.getAiFindSavedRecords(authInfo.username);
  return NextResponse.json({ records }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const id = typeof body.id === 'string' ? body.id.trim().slice(0, 80) : '';
  const query =
    typeof body.query === 'string' ? body.query.trim().slice(0, 200) : '';

  if (
    !id ||
    !query ||
    !isValidStatus(body.status) ||
    !isValidResponse(body.response)
  ) {
    return NextResponse.json(
      { error: 'Invalid saved record' },
      { status: 400 }
    );
  }

  const now = Date.now();
  await db.saveAiFindSavedRecord(authInfo.username, {
    id,
    userName: authInfo.username,
    query,
    response: body.response,
    status: body.status,
    createdAt: typeof body.createdAt === 'number' ? body.createdAt : now,
    updatedAt: now,
    lastOpenedAt:
      typeof body.lastOpenedAt === 'number' ? body.lastOpenedAt : now,
    openedCount: typeof body.openedCount === 'number' ? body.openedCount : 0,
  });

  return NextResponse.json({ success: true, id }, { status: 200 });
}

export async function DELETE(request: NextRequest) {
  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await db.clearAiFindSavedRecords(authInfo.username);
  return NextResponse.json({ success: true }, { status: 200 });
}
```

- [ ] **Step 3: Write and implement single-record route tests**

Create `src/app/api/ai/find/history/[id]/route.test.ts` with tests for unauthorized access, owned-record read, missing record 404, and delete. Then implement `src/app/api/ai/find/history/[id]/route.ts` with:

```ts
export async function GET(
  request: NextRequest,
  context: { params: { id: string } }
) {
  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const record = await db.getAiFindSavedRecord(
    authInfo.username,
    context.params.id
  );
  if (!record) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await db.touchAiFindSavedRecord(authInfo.username, context.params.id);
  return NextResponse.json({ record }, { status: 200 });
}

export async function DELETE(
  request: NextRequest,
  context: { params: { id: string } }
) {
  const authInfo = await getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await db.deleteAiFindSavedRecord(authInfo.username, context.params.id);
  return NextResponse.json({ success: true }, { status: 200 });
}
```

- [ ] **Step 4: Run API tests**

Run:

```bash
pnpm exec jest --runInBand src/app/api/ai/find/history/route.test.ts src/app/api/ai/find/history/[id]/route.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/find/history
git commit -m "feat: add ai find saved record api"
```

---

### Task 4: Add Browser History Helpers

**Files:**

- Create: `src/lib/ai-find/history-client.ts`
- Create: `src/lib/ai-find/history-client.test.ts`

- [ ] **Step 1: Write client helper tests**

Create tests that mock `global.fetch` and verify:

```ts
await listAiFindSavedRecords();
await getAiFindSavedRecord('rec_1');
await saveAiFindSavedRecordSnapshot({ id, query, response, status, createdAt });
await deleteAiFindSavedRecord('rec_1');
```

Expected URLs:

```text
/api/ai/find/history
/api/ai/find/history/rec_1
```

- [ ] **Step 2: Implement `src/lib/ai-find/history-client.ts`**

```ts
import type { AiFindResponse } from './types';
import type {
  AiFindSavedRecord,
  AiFindSavedRecordStatus,
  AiFindSavedRecordSummary,
} from '@/lib/types';

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
```

- [ ] **Step 3: Run helper tests**

Run:

```bash
pnpm exec jest --runInBand src/lib/ai-find/history-client.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai-find/history-client.ts src/lib/ai-find/history-client.test.ts
git commit -m "feat: add ai find history browser helpers"
```

---

### Task 5: Connect History to `AiFindPanel`

**Files:**

- Modify: `src/components/AiFindPanel.tsx`
- Create: `src/components/AiFindPanel.test.tsx`

- [ ] **Step 1: Add UI tests**

Create `src/components/AiFindPanel.test.tsx` that verifies:

```ts
it('loads a saved record without calling AI find endpoints', async () => {
  // mock listAiFindSavedRecords to return one summary
  // mock getAiFindSavedRecord to return its full response
  // click the saved record
  // expect fetch not to be called with /api/ai/find or /api/ai/find/group
  // expect the saved candidate title to appear
});

it('uses AI_MAX_RESULTS output as-is and does not branch by query type', async () => {
  // mock /api/ai/find response with 7 candidateQueries
  // submit query
  // expect seven candidate pills or seven pending groups
});
```

- [ ] **Step 2: Import history helpers in `AiFindPanel.tsx`**

```ts
import {
  createAiFindSavedRecordId,
  deleteAiFindSavedRecord,
  getAiFindSavedRecord,
  listAiFindSavedRecords,
  saveAiFindSavedRecordSnapshot,
} from '@/lib/ai-find/history-client';
import type { AiFindSavedRecordSummary } from '@/lib/types';
```

- [ ] **Step 3: Add state**

```ts
const [savedRecords, setSavedRecords] = useState<AiFindSavedRecordSummary[]>(
  []
);
const [activeSavedRecordId, setActiveSavedRecordId] = useState<string | null>(
  null
);
const activeSavedRecordCreatedAtRef = useRef<number | null>(null);
```

- [ ] **Step 4: Load recent records on mount**

```ts
useEffect(() => {
  let mounted = true;
  void listAiFindSavedRecords().then((records) => {
    if (mounted) setSavedRecords(records);
  });
  return () => {
    mounted = false;
  };
}, []);
```

- [ ] **Step 5: Save a partial snapshot after candidates arrive**

After `setResult({ ...candidatePayload, groups: pendingGroups })`, add:

```ts
const recordId = activeSavedRecordId || createAiFindSavedRecordId();
const createdAt = activeSavedRecordCreatedAtRef.current || Date.now();
setActiveSavedRecordId(recordId);
activeSavedRecordCreatedAtRef.current = createdAt;

void saveAiFindSavedRecordSnapshot({
  id: recordId,
  query: trimmedQuery,
  response: {
    ...candidatePayload,
    groups: pendingGroups,
  },
  status: 'partial',
  createdAt,
}).then(async () => {
  setSavedRecords(await listAiFindSavedRecords());
});
```

- [ ] **Step 6: Save updated snapshots as groups arrive**

Inside the `setResult((current) => { ... })` callback in `loadCandidateGroup`, compute `next` and save it:

```ts
const next = {
  ...current,
  groups: current.groups.map((group) =>
    group.query === candidate.query ? receivedGroup : group
  ),
  degraded: current.degraded || Boolean(payload.failed),
  errorMessage:
    current.errorMessage ||
    (payload.failed ? '部分候选片名查询失败。' : undefined),
};

const stillPending = next.groups.some(
  (group) =>
    group.groups.length === 0 &&
    !group.notFound &&
    group.query !== receivedGroup.query
);

if (activeSavedRecordId) {
  void saveAiFindSavedRecordSnapshot({
    id: activeSavedRecordId,
    query,
    response: next,
    status: stillPending ? 'partial' : 'complete',
    createdAt: activeSavedRecordCreatedAtRef.current || Date.now(),
  }).then(async () => {
    setSavedRecords(await listAiFindSavedRecords());
  });
}

return next;
```

If TypeScript scope blocks access to `query`, pass the original submitted query into `loadCandidateGroups` and `loadCandidateGroup` as `originalQuery`.

- [ ] **Step 7: Add a saved-record section above the form**

Render only when `savedRecords.length > 0`:

```tsx
<Surface className='p-4 sm:p-5' variant='plain'>
  <div className='space-y-3'>
    <div className='text-sm font-medium text-[rgb(var(--ui-text))]'>
      最近 AI 找片
    </div>
    <div className='flex flex-wrap gap-2'>
      {savedRecords.slice(0, 8).map((record) => (
        <button
          className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[rgb(var(--ui-text))] transition hover:bg-white/10'
          key={record.id}
          onClick={async () => {
            const saved = await getAiFindSavedRecord(record.id);
            if (!saved) return;
            setQuery(saved.query);
            setResult(saved.response);
            setActiveSavedRecordId(saved.id);
            activeSavedRecordCreatedAtRef.current = saved.createdAt;
            setLoading(false);
            setLoadingGroups([]);
            setGroupErrors({});
            setError(null);
            setSavedRecords(await listAiFindSavedRecords());
          }}
          type='button'
        >
          {record.query}
        </button>
      ))}
    </div>
  </div>
</Surface>
```

- [ ] **Step 8: Add refresh and delete actions for the active saved record**

When `activeSavedRecordId` is set and `result` exists, render:

```tsx
<div className='flex flex-wrap gap-2'>
  <button
    className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[rgb(var(--ui-text))] transition hover:bg-white/10'
    onClick={() => {
      setResult(null);
      setLoadingGroups([]);
      setGroupErrors({});
      document.querySelector<HTMLFormElement>('form')?.requestSubmit();
    }}
    type='button'
  >
    刷新结果
  </button>
  <button
    className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[rgb(var(--ui-text-muted))] transition hover:bg-white/10'
    onClick={async () => {
      if (!activeSavedRecordId) return;
      await deleteAiFindSavedRecord(activeSavedRecordId);
      setActiveSavedRecordId(null);
      activeSavedRecordCreatedAtRef.current = null;
      setSavedRecords(await listAiFindSavedRecords());
    }}
    type='button'
  >
    删除记录
  </button>
</div>
```

- [ ] **Step 9: Run component tests**

Run:

```bash
pnpm exec jest --runInBand src/components/AiFindPanel.test.tsx src/app/search/page.test.tsx
```

Expected: pass.

- [ ] **Step 10: Commit**

```bash
git add src/components/AiFindPanel.tsx src/components/AiFindPanel.test.tsx
git commit -m "feat: show and reuse ai find saved results"
```

---

### Task 6: Document and Verify

**Files:**

- Modify: `specs/features/AI_FIND_ASSISTANT.md`

- [ ] **Step 1: Update documentation**

Add a section after the existing cache description:

```md
## Saved Result Records

AI find saves successful user sessions as private result records. A saved record
contains the original query, the AI-generated candidate titles, suggestions, and
the progressively loaded KatelyaTV source groups.

Opening a saved record reuses the saved response and does not call the AI model
or source group endpoints. Users can manually refresh a saved record when they
want current results.

`AI_MAX_RESULTS` remains the only setting that controls how many candidate
titles the AI returns. The app does not use a separate result count for title
guessing versus recommendation-style queries.
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm exec jest --runInBand src/lib/ai-find/history-client.test.ts src/app/api/ai/find/history/route.test.ts src/app/api/ai/find/history/[id]/route.test.ts src/components/AiFindPanel.test.tsx src/app/search/page.test.tsx
```

Expected: all tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 4: Run build**

Run:

```bash
pnpm build
```

Expected: pass.

- [ ] **Step 5: Browser verification**

Start the app:

```bash
pnpm dev
```

Verify in browser:

1. Login.
2. Open `/search`.
3. Switch to `AI 找片`.
4. Search `90年代经典港片动作片`.
5. Confirm the candidate title count matches the configured `AI_MAX_RESULTS` value.
6. Wait for progressive source groups to load.
7. Reload the page.
8. Open the saved record from `最近 AI 找片`.
9. Confirm old results appear without a visible new AI search.
10. Click `刷新结果`.
11. Confirm the normal AI find flow runs again and the saved record updates.

- [ ] **Step 6: Commit**

```bash
git add specs/features/AI_FIND_ASSISTANT.md
git commit -m "docs: describe ai find saved records"
```

---

## Self-Review

- Spec coverage: The plan saves AI find records, lets users reopen prior results, avoids extra AI calls on reopen, and keeps result count controlled only by `AI_MAX_RESULTS`.
- Placeholder scan: No task depends on an unspecified file or unnamed behavior. Where implementation differs by backend, the storage shape and behavior are explicitly defined.
- Type consistency: `AiFindSavedRecord`, `AiFindSavedRecordSummary`, and `AiFindSavedRecordStatus` are introduced once and reused by API, storage, and client helpers.
