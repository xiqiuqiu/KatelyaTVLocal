import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import type { AiFindSavedRecord } from '@/lib/types';

class MockResponse {
  status: number;

  constructor(private readonly payload: unknown, init?: { status?: number }) {
    this.status = init?.status ?? 200;
  }

  async json(): Promise<unknown> {
    return this.payload;
  }
}

jest.mock('next/server', () => ({
  NextResponse: {
    json: (payload: unknown, init?: { status?: number }) =>
      new MockResponse(payload, init),
  },
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    deleteAiFindSavedRecord: jest.fn(),
    getAiFindSavedRecord: jest.fn(),
    touchAiFindSavedRecord: jest.fn(),
  },
}));

let GET: (
  request: unknown,
  context: { params: { id: string } }
) => Promise<MockResponse>;
let DELETE: (
  request: unknown,
  context: { params: { id: string } }
) => Promise<MockResponse>;

const record: AiFindSavedRecord = {
  id: 'rec_1',
  userName: 'alice',
  query: '90年代港片动作片',
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
    generatedAt: 1700000000000,
  },
  status: 'complete',
  createdAt: 1,
  updatedAt: 2,
  lastOpenedAt: 2,
  openedCount: 0,
};

describe('AI find single history record route', () => {
  const mockedGetAuthInfoFromCookie =
    getAuthInfoFromCookie as jest.MockedFunction<typeof getAuthInfoFromCookie>;
  const mockedDb = db as jest.Mocked<typeof db>;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET, DELETE } = require('@/app/api/ai/find/history/[id]/route'));
  });

  beforeEach(() => {
    mockedGetAuthInfoFromCookie.mockResolvedValue({
      version: 2,
      username: 'alice',
      role: 'user',
      issuedAt: 1,
    });
    mockedDb.getAiFindSavedRecord.mockResolvedValue(record);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated read requests', async () => {
    mockedGetAuthInfoFromCookie.mockResolvedValue(null);

    const response = await GET({}, { params: { id: 'rec_1' } });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mockedDb.getAiFindSavedRecord).not.toHaveBeenCalled();
  });

  it('reads and touches an owned saved record', async () => {
    const response = await GET({}, { params: { id: 'rec_1' } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ record });
    expect(mockedDb.getAiFindSavedRecord).toHaveBeenCalledWith(
      'alice',
      'rec_1'
    );
    expect(mockedDb.touchAiFindSavedRecord).toHaveBeenCalledWith(
      'alice',
      'rec_1'
    );
  });

  it('returns 404 when the record does not exist for the user', async () => {
    mockedDb.getAiFindSavedRecord.mockResolvedValue(null);

    const response = await GET({}, { params: { id: 'rec_1' } });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Not found' });
    expect(mockedDb.touchAiFindSavedRecord).not.toHaveBeenCalled();
  });

  it('deletes an owned saved record', async () => {
    const response = await DELETE({}, { params: { id: 'rec_1' } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockedDb.deleteAiFindSavedRecord).toHaveBeenCalledWith(
      'alice',
      'rec_1'
    );
  });
});
