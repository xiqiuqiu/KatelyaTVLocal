import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';

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
    clearAiFindSavedRecords: jest.fn(),
    getAiFindSavedRecords: jest.fn(),
    saveAiFindSavedRecord: jest.fn(),
  },
}));

let GET: (request: { json?: () => Promise<unknown> }) => Promise<MockResponse>;
let POST: (request: { json: () => Promise<unknown> }) => Promise<MockResponse>;
let DELETE: (request: {
  json?: () => Promise<unknown>;
}) => Promise<MockResponse>;

const validResponse = {
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
};

describe('AI find history route', () => {
  const mockedGetAuthInfoFromCookie =
    getAuthInfoFromCookie as jest.MockedFunction<typeof getAuthInfoFromCookie>;
  const mockedDb = db as jest.Mocked<typeof db>;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ GET, POST, DELETE } = require('@/app/api/ai/find/history/route'));
  });

  beforeEach(() => {
    mockedGetAuthInfoFromCookie.mockResolvedValue({
      version: 2,
      username: 'alice',
      role: 'user',
      issuedAt: 1,
    });
    mockedDb.getAiFindSavedRecords.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('rejects unauthenticated list requests', async () => {
    mockedGetAuthInfoFromCookie.mockResolvedValue(null);

    const response = await GET({});

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mockedDb.getAiFindSavedRecords).not.toHaveBeenCalled();
  });

  it('lists saved record summaries for the current user', async () => {
    mockedDb.getAiFindSavedRecords.mockResolvedValue([
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

    const response = await GET({});

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      records: [
        expect.objectContaining({
          id: 'rec_1',
          query: '90年代港片动作片',
        }),
      ],
    });
    expect(mockedDb.getAiFindSavedRecords).toHaveBeenCalledWith('alice');
  });

  it('rejects invalid upsert payloads', async () => {
    const response = await POST({
      json: async () => ({ id: 'rec_1', query: '', response: null }),
    });

    expect(response.status).toBe(400);
    expect(mockedDb.saveAiFindSavedRecord).not.toHaveBeenCalled();
  });

  it('rejects empty candidate snapshots', async () => {
    const response = await POST({
      json: async () => ({
        id: 'rec_1',
        query: '90年代港片动作片',
        status: 'partial',
        response: {
          ...validResponse,
          candidateQueries: [],
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(mockedDb.saveAiFindSavedRecord).not.toHaveBeenCalled();
  });

  it('upserts a valid saved record for the current user', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000001234);

    const response = await POST({
      json: async () => ({
        id: 'rec_1',
        query: '90年代港片动作片',
        status: 'partial',
        createdAt: 1700000000000,
        response: validResponse,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      id: 'rec_1',
    });
    expect(mockedDb.saveAiFindSavedRecord).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({
        id: 'rec_1',
        userName: 'alice',
        query: '90年代港片动作片',
        status: 'partial',
        createdAt: 1700000000000,
        updatedAt: 1700000001234,
      })
    );
  });

  it('clears saved records for the current user', async () => {
    const response = await DELETE({});

    expect(response.status).toBe(200);
    expect(mockedDb.clearAiFindSavedRecords).toHaveBeenCalledWith('alice');
  });
});
