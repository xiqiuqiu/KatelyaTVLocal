import {
  createAiFindSavedRecordId,
  deleteAiFindSavedRecord,
  getAiFindSavedRecord,
  listAiFindSavedRecords,
  saveAiFindSavedRecordSnapshot,
} from './history-client';
import type { AiFindResponse } from './types';

const aiFindResponse: AiFindResponse = {
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

function mockFetch(payload: unknown, ok = true) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok,
    json: async () => payload,
  });
  (global as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;
  return fetchMock;
}

describe('AI find history client helpers', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates a saved record id', () => {
    const id = createAiFindSavedRecordId();

    expect(id.length).toBeGreaterThan(8);
  });

  it('lists saved records', async () => {
    const fetchMock = mockFetch({
      records: [
        {
          id: 'rec_1',
          query: '90年代港片动作片',
          answer: '已根据你的描述生成候选搜索词。',
          candidateCount: 5,
          foundGroupCount: 10,
          status: 'complete',
          createdAt: 1,
          updatedAt: 2,
          lastOpenedAt: 2,
          openedCount: 0,
        },
      ],
    });

    await expect(listAiFindSavedRecords()).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/find/history');
  });

  it('returns an empty list when listing fails', async () => {
    mockFetch({ error: 'Unauthorized' }, false);

    await expect(listAiFindSavedRecords()).resolves.toEqual([]);
  });

  it('gets one saved record', async () => {
    const fetchMock = mockFetch({
      record: {
        id: 'rec_1',
        userName: 'alice',
        query: '90年代港片动作片',
        response: aiFindResponse,
        status: 'complete',
        createdAt: 1,
        updatedAt: 2,
        lastOpenedAt: 2,
        openedCount: 0,
      },
    });

    await expect(getAiFindSavedRecord('rec_1')).resolves.toMatchObject({
      id: 'rec_1',
      query: '90年代港片动作片',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/find/history/rec_1');
  });

  it('saves a snapshot', async () => {
    const fetchMock = mockFetch({ success: true });

    await saveAiFindSavedRecordSnapshot({
      id: 'rec_1',
      query: '90年代港片动作片',
      response: aiFindResponse,
      status: 'partial',
      createdAt: 1,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/ai/find/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'rec_1',
        query: '90年代港片动作片',
        response: aiFindResponse,
        status: 'partial',
        createdAt: 1,
      }),
    });
  });

  it('deletes a saved record', async () => {
    const fetchMock = mockFetch({ success: true });

    await deleteAiFindSavedRecord('rec_1');

    expect(fetchMock).toHaveBeenCalledWith('/api/ai/find/history/rec_1', {
      method: 'DELETE',
    });
  });
});
