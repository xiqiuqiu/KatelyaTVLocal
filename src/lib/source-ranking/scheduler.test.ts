import { runLowFrequencySourceRankingCheck } from '@/lib/source-ranking/scheduler';
import { PlayRecord, SearchResult } from '@/lib/types';

interface StatementRecord {
  sql: string;
  values: unknown[];
}

function createFakeDatabase(
  records: StatementRecord[],
  allResults: Array<{ results?: unknown[] }> = []
) {
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              records.push({ sql, values });
              return { success: true };
            },
            async all<T = unknown>() {
              return (allResults.shift() || { results: [] }) as {
                results?: T[];
              };
            },
          };
        },
      };
    },
  };
}

function createPlayRecord(overrides: Partial<PlayRecord> = {}): PlayRecord {
  return {
    title: '示例标题',
    source_name: '示例源',
    cover: '',
    year: '2025',
    index: 1,
    total_episodes: 12,
    play_time: 120,
    total_time: 1800,
    save_time: 1,
    search_title: '示例标题',
    ...overrides,
  };
}

describe('source ranking scheduler', () => {
  it('skips safely when d1 binding is missing', async () => {
    await expect(
      runLowFrequencySourceRankingCheck({
        origin: 'https://app.example.com',
      })
    ).resolves.toMatchObject({
      triggered: false,
      status: 'skipped',
      reason: 'missing D1 binding',
    });
  });

  it('builds low-frequency probe tasks from recent play records and writes snapshots', async () => {
    const originalUsername = process.env.USERNAME;
    delete process.env.USERNAME;
    const statements: StatementRecord[] = [];
    const persistedTasks: Array<{
      runId: string;
      sourceKey: string;
      episodeUrl: string;
      kind: string;
      measuredAt: number | undefined;
    }> = [];
    let currentTime = 1710000000000;
    const now = () => ++currentTime;

    const fetchDetail = jest.fn<
      Promise<SearchResult>,
      [{ source: string; id: string; fallbackTitle?: string }]
    >(({ source, id }) => {
      if (source === 'alpha') {
        return Promise.resolve({
          id,
          title: 'Alpha Show',
          poster: '',
          episodes: [
            'https://alpha.example.com/ep1.m3u8',
            'https://alpha.example.com/ep2.m3u8',
            'https://alpha.example.com/ep3.m3u8',
            'https://alpha.example.com/ep4.m3u8',
          ],
          source,
          source_name: 'Alpha Source',
          year: '2025',
        });
      }

      return Promise.resolve({
        id,
        title: 'Beta Show',
        poster: '',
        episodes: [
          'https://beta.example.com/ep1.m3u8',
          'https://beta.example.com/ep2.m3u8',
        ],
        source,
        source_name: 'Beta Source',
        year: '2025',
      });
    });
    const probePlayback = jest.fn(async (episodeUrl: string) => ({
      kind: 'direct' as const,
      domain: new URL(episodeUrl).hostname,
      reason: '可直连',
      upstreamStatus: 200,
      probeTimeMs: 100,
      resolutionLabel: null,
      firstSegmentLatencyMs: null,
      firstSegmentSpeedKbps: null,
    }));

    try {
      const result = await runLowFrequencySourceRankingCheck({
        env: { DB: createFakeDatabase(statements) },
        origin: 'https://app.example.com',
        triggerType: 'cron',
        idFactory: () => 'run-123',
        now,
        getUsers: async () => ['alice'],
        getPlayRecords: async () => ({
          'alpha+video-1': createPlayRecord({
            title: 'Alpha Show',
            source_name: 'Alpha Source',
            index: 2,
            save_time: 200,
            search_title: 'Alpha Show',
          }),
          'beta+video-2': createPlayRecord({
            title: 'Beta Show',
            source_name: 'Beta Source',
            index: 1,
            save_time: 100,
            search_title: 'Beta Show',
          }),
        }),
        fetchDetail,
        probePlayback,
        persistProbeResult: async (
          _env,
          runId,
          task,
          probeResult,
          measuredAt
        ) => {
          persistedTasks.push({
            runId,
            sourceKey: task.sourceKey,
            episodeUrl: task.episodeUrl,
            kind: probeResult.kind,
            measuredAt,
          });
        },
      });

      expect(result).toMatchObject({
        triggered: true,
        status: 'completed',
        runId: 'run-123',
        sampledRecordCount: 2,
        taskCount: 2,
        probeCount: 2,
        snapshotCount: 2,
        errorCount: 0,
      });

      expect(fetchDetail).toHaveBeenNthCalledWith(1, {
        source: 'alpha',
        id: 'video-1',
        fallbackTitle: 'Alpha Show',
      });
      expect(fetchDetail).toHaveBeenNthCalledWith(2, {
        source: 'beta',
        id: 'video-2',
        fallbackTitle: 'Beta Show',
      });

      expect(persistedTasks.map((task) => task.episodeUrl)).toEqual([
        'https://alpha.example.com/ep2.m3u8',
        'https://beta.example.com/ep1.m3u8',
      ]);

      const runInsert = statements.find((statement) =>
        statement.sql.includes('INSERT INTO source_probe_runs')
      );
      const runUpdate = statements.find((statement) =>
        statement.sql.includes('UPDATE source_probe_runs')
      );
      const snapshotWrites = statements.filter((statement) =>
        statement.sql.includes('INSERT OR REPLACE INTO source_rank_snapshots')
      );
      const alphaSnapshot = snapshotWrites.find(
        (statement) => statement.values[1] === 'alpha-video-1'
      );
      const betaSnapshot = snapshotWrites.find(
        (statement) => statement.values[1] === 'beta-video-2'
      );

      expect(runInsert?.values).toEqual([
        'run-123',
        'cron',
        1710000000001,
        'running',
        'bounded multi-user source check',
      ]);
      expect(runUpdate?.values?.[1]).toBe('completed');
      expect(snapshotWrites).toHaveLength(2);
      expect(alphaSnapshot?.values.slice(1, 14)).toEqual([
        'alpha-video-1',
        'alpha.example.com',
        '24h',
        80,
        35,
        35,
        100,
        55.25,
        100,
        100,
        0,
        0,
        1,
      ]);
      expect(betaSnapshot?.values.slice(1, 14)).toEqual([
        'beta-video-2',
        'beta.example.com',
        '24h',
        80,
        35,
        35,
        100,
        55.25,
        100,
        100,
        0,
        0,
        1,
      ]);
    } finally {
      process.env.USERNAME = originalUsername;
    }
  });

  it('uses the recent play record loader and preserves plus signs in ids', async () => {
    const statements: StatementRecord[] = [];
    const fetchDetail = jest.fn(async () => ({
      id: 'video+part+1',
      title: 'Plus Show',
      poster: '',
      episodes: ['https://plus.example.com/ep1.m3u8'],
      source: 'alpha',
      source_name: 'Alpha Source',
      year: '2025',
    }));
    const getPlayRecords = jest.fn(async () => ({}));
    const getRecentPlayRecords = jest.fn(async () => ({
      'alpha+video+part+1': createPlayRecord({
        title: 'Plus Show',
        source_name: 'Alpha Source',
        index: 1,
        save_time: 200,
        search_title: 'Plus Show',
      }),
    }));

    await runLowFrequencySourceRankingCheck({
      env: { DB: createFakeDatabase(statements) },
      origin: 'https://app.example.com',
      triggerType: 'cron',
      idFactory: () => 'run-plus',
      now: () => 1710000000000,
      getUsers: async () => ['alice'],
      getPlayRecords,
      getRecentPlayRecords,
      fetchDetail,
      probePlayback: async () => ({
        kind: 'direct',
        domain: 'plus.example.com',
        reason: '可直连',
        upstreamStatus: 200,
        probeTimeMs: 100,
        resolutionLabel: null,
        firstSegmentLatencyMs: null,
        firstSegmentSpeedKbps: null,
      }),
      persistProbeResult: async () => undefined,
    });

    expect(getRecentPlayRecords).toHaveBeenCalledWith('alice', 50);
    expect(getPlayRecords).not.toHaveBeenCalled();
    expect(fetchDetail).toHaveBeenCalledWith({
      source: 'alpha',
      id: 'video+part+1',
      fallbackTitle: 'Plus Show',
    });
  });

  it('falls back to recent playback feedback when play records are unavailable', async () => {
    const statements: StatementRecord[] = [];
    const persistedTasks: string[] = [];

    const result = await runLowFrequencySourceRankingCheck({
      env: {
        DB: createFakeDatabase(statements, [
          {
            results: [
              {
                sourceKey: 'mdzy-16302',
                title: '庆余年',
                recordedAt: 1710000500000,
              },
            ],
          },
        ]),
      },
      origin: 'https://app.example.com',
      triggerType: 'cron',
      idFactory: () => 'run-feedback',
      now: () => 1710000600000,
      getUsers: async () => [],
      getPlayRecords: async () => ({}),
      fetchDetail: async () => ({
        id: '16302',
        title: '庆余年',
        poster: '',
        episodes: ['https://media.example.com/qyn-1.m3u8'],
        source: 'mdzy',
        source_name: '魔都资源',
        year: '2019',
      }),
      probePlayback: async () => ({
        kind: 'direct',
        domain: 'media.example.com',
        reason: '可直连',
        upstreamStatus: 200,
        probeTimeMs: 123,
        resolutionLabel: null,
        firstSegmentLatencyMs: null,
        firstSegmentSpeedKbps: null,
      }),
      persistProbeResult: async (_env, _runId, task) => {
        persistedTasks.push(task.sourceKey);
      },
    });

    expect(result).toMatchObject({
      triggered: true,
      status: 'completed',
      sampledRecordCount: 1,
      taskCount: 1,
      probeCount: 1,
      snapshotCount: 1,
      errorCount: 0,
    });
    expect(persistedTasks).toEqual(['mdzy-16302']);
  });

  it.each([
    {
      status: 'completed_with_errors',
      taskCount: 2,
      snapshotCount: 2,
      errorCount: 1,
    },
    { status: 'failed', taskCount: 0, snapshotCount: 0, errorCount: 3 },
    { status: 'failed', taskCount: 2, snapshotCount: 0, errorCount: 3 },
  ])(
    'records $status when $taskCount tasks yield $snapshotCount snapshots after a detail failure',
    async (expected) => {
      const statements: StatementRecord[] = [];
      const fetchDetail = jest.fn(async ({ source, id }) => {
        if (expected.taskCount === 0 || id === 'bad') {
          throw new Error(
            'Detail HTTP 503 https://media.example.com/?token=secret'
          );
        }
        return {
          id,
          source,
          source_name: source,
          title: 'Example',
          year: '2026',
          poster: '',
          episodes: [`https://media.example.com/${id}.m3u8`],
        };
      });
      const probePlayback = jest.fn(async () => ({
        kind: 'direct' as const,
        domain: 'media.example.com',
        reason: '可直连',
        upstreamStatus: 200,
        probeTimeMs: 100,
        resolutionLabel: null,
        firstSegmentLatencyMs: null,
        firstSegmentSpeedKbps: null,
      }));
      const result = await runLowFrequencySourceRankingCheck({
        env: { DB: createFakeDatabase(statements) },
        origin: 'https://app.example.com',
        getUsers: async () => ['alice', 'bob'],
        getPlayRecords: async (user): Promise<Record<string, PlayRecord>> =>
          user === 'alice'
            ? {
                'source+first': createPlayRecord({ save_time: 3 }),
                'source+bad': createPlayRecord({ save_time: 2 }),
              }
            : user === 'bob'
            ? { 'source+last': createPlayRecord({ save_time: 1 }) }
            : {},
        fetchDetail,
        probePlayback,
        persistProbeResult: async () => {
          if (expected.snapshotCount === 0) {
            throw new Error('Could not persist probe result');
          }
        },
      });

      expect(fetchDetail.mock.calls.map(([sample]) => sample.id)).toEqual([
        'first',
        'bad',
        'last',
      ]);
      expect(result).toMatchObject({
        ...expected,
        sampledRecordCount: 3,
      });
      expect(probePlayback).toHaveBeenCalledTimes(expected.taskCount);
      expect(
        statements
          .filter(({ sql }) =>
            sql.includes('INSERT OR REPLACE INTO source_rank_snapshots')
          )
          .map(({ values }) => values[1])
      ).toEqual(expected.snapshotCount ? ['source-first', 'source-last'] : []);
      const finalized = statements.find(({ sql }) =>
        sql.includes('UPDATE source_probe_runs')
      );
      expect(finalized?.values[1]).toBe(result.status);
      expect(finalized?.values[2]).toBe(result.notes);
      expect(JSON.parse(result.notes ?? '{}')).toMatchObject({
        errorCount: expected.errorCount,
        attemptedSourceKeys: ['source-first', 'source-bad', 'source-last'],
      });
      expect(result.notes).toContain('source-bad');
      expect(result.notes).toContain('HTTP 503');
      expect(result.notes).not.toContain('token=secret');
    }
  );

  it('stores valid probes before the budget runs out and skips platform failures', async () => {
    const statements: StatementRecord[] = [];
    const fetchDetail = jest.fn(async ({ source, id }) => ({
      id,
      source,
      source_name: source,
      title: 'Example',
      year: '2026',
      poster: '',
      episodes: [
        'https://media.example.com/one.m3u8',
        'https://media.example.com/two.m3u8',
      ],
    }));
    const persistProbeResult = jest.fn(async () => undefined);
    const probePlayback = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'direct', domain: 'media.example.com' })
      .mockResolvedValueOnce({
        kind: 'unavailable',
        reason: 'Too many subrequests.',
      });

    const result = await runLowFrequencySourceRankingCheck({
      env: { DB: createFakeDatabase(statements) },
      origin: 'https://app.example.com',
      getUsers: async () => ['alice'],
      getPlayRecords: async (user): Promise<Record<string, PlayRecord>> =>
        user === 'alice'
          ? {
              'source+first': createPlayRecord({ save_time: 2 }),
              'source+next': createPlayRecord({ save_time: 1 }),
            }
          : {},
      fetchDetail,
      probePlayback,
      persistProbeResult,
    });

    expect(fetchDetail).toHaveBeenCalledTimes(2);
    expect(persistProbeResult).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'completed_with_errors',
      sampledRecordCount: 2,
      taskCount: 2,
      probeCount: 1,
      snapshotCount: 1,
      errorCount: 1,
    });
    const snapshot = statements.find(({ sql }) =>
      sql.includes('INSERT OR REPLACE INTO source_rank_snapshots')
    );
    expect(snapshot?.values[12]).toBe(0);
    expect(snapshot?.values[13]).toBe(1);
  });

  it('samples content-key records and counts dual writes once per user', async () => {
    const fetchDetail = jest.fn(async ({ source, id }) => ({
      id,
      source,
      source_name: source,
      title: 'Example',
      year: '2026',
      poster: '',
      episodes: [],
    }));
    const result = await runLowFrequencySourceRankingCheck({
      env: { DB: createFakeDatabase([]) },
      origin: 'https://app.example.com',
      getUsers: async () => ['alice'],
      getPlayRecords: async (user): Promise<Record<string, PlayRecord>> =>
        user === 'alice'
          ? {
              'wp:missing+route::2026#0': createPlayRecord({ save_time: 4 }),
              'wp:show+plus::2026#1': createPlayRecord({
                route_source: 'alpha',
                route_id: 'video+part',
                save_time: 3,
                search_title: 'Content title',
              }),
              'alpha+video+part': createPlayRecord({ save_time: 2 }),
              'beta+other': createPlayRecord({ save_time: 1 }),
            }
          : {},
      fetchDetail,
    });
    expect(fetchDetail.mock.calls).toEqual([
      [{ source: 'alpha', id: 'video+part', fallbackTitle: 'Content title' }],
      [{ source: 'beta', id: 'other', fallbackTitle: '示例标题' }],
    ]);
    expect(result).toMatchObject({
      status: 'skipped',
      sampledRecordCount: 2,
      errorCount: 0,
    });
  });

  it('caps each batch and rotates untested and oldest ranked candidates first', async () => {
    const originalUsername = process.env.USERNAME;
    delete process.env.USERNAME;
    const statements: StatementRecord[] = [];
    const persistedTasks: string[] = [];
    const fetchDetail = jest.fn<
      Promise<SearchResult>,
      [{ source: string; id: string; fallbackTitle?: string }]
    >(({ source, id }) =>
      Promise.resolve({
        id,
        title: `${source}-${id}`,
        poster: '',
        episodes: [
          `https://${source}.example.com/${id}-1.m3u8`,
          `https://${source}.example.com/${id}-2.m3u8`,
          `https://${source}.example.com/${id}-3.m3u8`,
        ],
        source,
        source_name: source,
        year: '2026',
      })
    );

    try {
      const runBatch = (
        ages: Array<{ sourceKey: string; servicedAt: number }>
      ) =>
        runLowFrequencySourceRankingCheck({
          env: {
            DB: createFakeDatabase(statements, [{}, {}, { results: ages }]),
          },
          origin: 'https://app.example.com',
          idFactory: () => 'run-budget',
          now: () => 1710000000000,
          getUsers: async () =>
            Array.from({ length: 10 }, (_, index) => `user-${index}`),
          getPlayRecords: async (userName) => {
            const userIndex = Number(userName.split('-')[1]);
            return Object.fromEntries(
              Array.from({ length: 5 }, (_, index) => [
                `src${userIndex}-${index}+video-${index}`,
                createPlayRecord({
                  title: `${userName}-${index}`,
                  source_name: `src${userIndex}-${index}`,
                  save_time: 1000 - index,
                  search_title: `${userName}-${index}`,
                }),
              ])
            );
          },
          fetchDetail,
          probePlayback: async () => ({
            kind: 'direct',
            domain: 'media.example.com',
            reason: '可直连',
            upstreamStatus: 200,
            probeTimeMs: 100,
            resolutionLabel: '1080p',
            firstSegmentLatencyMs: 120,
            firstSegmentSpeedKbps: 4000,
          }),
          persistProbeResult: async (_env, _runId, task) => {
            persistedTasks.push(task.sourceKey);
          },
        });

      const ages = Array.from({ length: 9 }, (_, index) => ({
        sourceKey: `src${index}-0-video-0`,
        servicedAt: 100 + index,
      }));
      const visited = (result: { notes?: string }) =>
        JSON.parse(result.notes ?? '{}').attemptedSourceKeys;

      const result = await runBatch(ages);
      expect(result.sampledRecordCount).toBe(20);
      expect(result.taskCount).toBe(6);
      expect(persistedTasks).toHaveLength(6);
      expect(visited(result)).toEqual([
        'src9-0-video-0',
        'src0-1-video-1',
        'src1-1-video-1',
        'src2-1-video-1',
        'src3-1-video-1',
        'src4-1-video-1',
      ]);
      expect(
        statements.filter((statement) =>
          statement.sql.includes('DELETE FROM source_probe_results')
        )
      ).toHaveLength(1);
      expect(
        statements.filter((statement) =>
          statement.sql.includes('DELETE FROM playback_feedback_events')
        )
      ).toHaveLength(1);
      expect(
        statements.filter((statement) =>
          statement.sql.includes('DELETE FROM source_probe_runs')
        )
      ).toHaveLength(1);
      const previousBatch = visited(result) as string[];
      const next = await runBatch([
        ...ages,
        ...previousBatch.map((sourceKey) => ({ sourceKey, servicedAt: 200 })),
        ...Array.from({ length: 4 }, (_, index) => ({
          sourceKey: `src${index + 6}-1-video-1`,
          servicedAt: 300,
        })),
      ]);
      expect(visited(next)).toEqual([
        'src5-1-video-1',
        'src0-0-video-0',
        'src1-0-video-0',
        'src2-0-video-0',
        'src3-0-video-0',
        'src4-0-video-0',
      ]);
    } finally {
      process.env.USERNAME = originalUsername;
    }
  });
});
