import {
  cleanupPlaybackQuality,
  playbackQualityDayKey,
  readPlaybackQualitySummary,
  savePlaybackQuality,
} from './playback-quality.server';

describe('playback quality storage', () => {
  it('uses Taipei date boundaries independently of host timezone', () => {
    expect(playbackQualityDayKey(Date.parse('2026-10-25T15:59:59Z'))).toBe(
      '2026-10-25'
    );
    expect(playbackQualityDayKey(Date.parse('2026-10-25T16:00:00Z'))).toBe(
      '2026-10-26'
    );
  });
  it('skips storage without creating fake zero metrics when D1 is absent', async () => {
    await expect(savePlaybackQuality({}, 'alice', [])).resolves.toBe('no-d1');
    await expect(readPlaybackQualitySummary({}, 7)).resolves.toBeNull();
    await expect(cleanupPlaybackQuality({})).resolves.toBeUndefined();
  });
  it('returns null rates for empty denominators and keeps latency evidence separate', async () => {
    const all = jest
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            completed: 0,
            within30: 0,
            completedChains: 0,
            successfulChains: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce({ results: [] });
    const statement = { bind: jest.fn().mockReturnThis(), all };
    const db = { prepare: jest.fn(() => statement) };
    const result = await readPlaybackQualitySummary(
      { DB: db },
      7,
      Date.parse('2026-10-26T00:00:00Z')
    );
    expect(result?.groups[0]).toMatchObject({
      firstRoundWithin30Rate: null,
      finalSuccessRate: null,
    });
    expect(result?.latency).toEqual([]);
    expect(statement.bind).toHaveBeenNthCalledWith(
      1,
      '2026-10-20',
      expect.any(Number),
      expect.any(Number)
    );
  });
  it('bounds scheduled cleanup work', async () => {
    const run = jest.fn().mockResolvedValue({ meta: { changes: 0 } });
    const statement = { bind: jest.fn().mockReturnThis(), run };
    const db = { prepare: jest.fn(() => statement) };
    await cleanupPlaybackQuality({ DB: db }, 40 * 86_400_000);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT 2000')
    );
    expect(statement.bind).toHaveBeenCalledWith(10 * 86_400_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
