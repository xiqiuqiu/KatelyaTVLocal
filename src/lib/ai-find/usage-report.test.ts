import { getAiFindUsageReport } from './usage-report';

function createDb(rows: unknown[]) {
  const bind = jest.fn().mockReturnThis();
  const all = jest.fn().mockResolvedValue({ results: rows });

  return {
    prepare: jest.fn(() => ({ bind, all })),
    bind,
    all,
  };
}

describe('AI find usage report', () => {
  it('summarizes global usage by day and lists top today subjects', async () => {
    const now = Date.UTC(2026, 4, 21, 9, 0, 0);
    const db = createDb([
      {
        scope: 'ai-find:find:global',
        subject: 'global',
        day_key: '2026-05-21',
        count: 6,
        updated_at: now,
      },
      {
        scope: 'ai-find:group:global',
        subject: 'global',
        day_key: '2026-05-21',
        count: 12,
        updated_at: now,
      },
      {
        scope: 'ai-find:find:user',
        subject: 'alice',
        day_key: '2026-05-21',
        count: 3,
        updated_at: now,
      },
      {
        scope: 'ai-find:group:ip',
        subject: '203.0.113.10',
        day_key: '2026-05-21',
        count: 8,
        updated_at: now - 1000,
      },
      {
        scope: 'ai-find:find:global',
        subject: 'global',
        day_key: '2026-05-20',
        count: 2,
        updated_at: now - 86400000,
      },
      {
        scope: 'unknown',
        subject: 'ignored',
        day_key: '2026-05-21',
        count: 999,
        updated_at: now,
      },
    ]);

    const report = await getAiFindUsageReport({
      env: { DB: db },
      now,
      days: 2,
      subjectLimit: 10,
    });

    expect(db.bind).toHaveBeenCalledWith('2026-05-20', '2026-05-21');
    expect(report.today).toEqual({
      dayKey: '2026-05-21',
      find: { total: 6, global: 6 },
      group: { total: 12, global: 12 },
    });
    expect(report.days).toEqual([
      { dayKey: '2026-05-20', find: 2, group: 0, total: 2 },
      { dayKey: '2026-05-21', find: 6, group: 12, total: 18 },
    ]);
    expect(report.topSubjects).toEqual([
      {
        subject: '203.0.113.10',
        scope: 'ip',
        endpoint: 'group',
        count: 8,
        updatedAt: now - 1000,
      },
      {
        subject: 'alice',
        scope: 'user',
        endpoint: 'find',
        count: 3,
        updatedAt: now,
      },
    ]);
  });

  it('fails closed when D1 is missing', async () => {
    await expect(getAiFindUsageReport({ env: {} })).rejects.toThrow(
      'AI 找片用量存储未配置'
    );
  });
});
