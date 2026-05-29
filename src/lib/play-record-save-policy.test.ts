import {
  getPlayRecordHeartbeatIntervalMs,
  shouldSavePlayRecord,
  type PlayRecordSaveSnapshot,
} from '@/lib/play-record-save-policy';

function createSnapshot(
  overrides: Partial<PlayRecordSaveSnapshot> = {}
): PlayRecordSaveSnapshot {
  return {
    key: 'test-source+123',
    episodeIndex: 2,
    playTime: 120,
    totalTime: 1800,
    savedAt: 1000,
    ...overrides,
  };
}

describe('getPlayRecordHeartbeatIntervalMs', () => {
  it('uses a longer heartbeat for d1', () => {
    expect(getPlayRecordHeartbeatIntervalMs('d1')).toBe(30000);
  });

  it('keeps the upstash heartbeat unchanged', () => {
    expect(getPlayRecordHeartbeatIntervalMs('upstash')).toBe(20000);
  });

  it('falls back to the default heartbeat for other storage types', () => {
    expect(getPlayRecordHeartbeatIntervalMs('localstorage')).toBe(5000);
    expect(getPlayRecordHeartbeatIntervalMs(undefined)).toBe(5000);
  });
});

describe('shouldSavePlayRecord', () => {
  it('always saves the first snapshot', () => {
    expect(shouldSavePlayRecord(null, createSnapshot(), 'heartbeat')).toBe(
      true
    );
  });

  it('skips near-duplicate forced saves for the same record', () => {
    const previous = createSnapshot();
    const next = createSnapshot({ savedAt: 6000, playTime: 122 });

    expect(shouldSavePlayRecord(previous, next, 'pause')).toBe(false);
  });

  it('keeps forced saves when progress has moved enough', () => {
    const previous = createSnapshot();
    const next = createSnapshot({ savedAt: 6000, playTime: 126 });

    expect(shouldSavePlayRecord(previous, next, 'pause')).toBe(true);
  });

  it('keeps forced saves after the duplicate window elapses', () => {
    const previous = createSnapshot();
    const next = createSnapshot({ savedAt: 12001, playTime: 121 });

    expect(shouldSavePlayRecord(previous, next, 'visibility-hidden')).toBe(
      true
    );
  });

  it('skips heartbeat saves when progress barely changed', () => {
    const previous = createSnapshot();
    const next = createSnapshot({ savedAt: 31000, playTime: 123 });

    expect(shouldSavePlayRecord(previous, next, 'heartbeat')).toBe(false);
  });

  it('keeps heartbeat saves when progress moves enough', () => {
    const previous = createSnapshot();
    const next = createSnapshot({ savedAt: 31000, playTime: 125 });

    expect(shouldSavePlayRecord(previous, next, 'heartbeat')).toBe(true);
  });

  it('always saves when the episode changes', () => {
    const previous = createSnapshot();
    const next = createSnapshot({ episodeIndex: 3, savedAt: 3000 });

    expect(shouldSavePlayRecord(previous, next, 'pause')).toBe(true);
  });

  it('always saves when the source key changes even within the duplicate window', () => {
    const previous = createSnapshot({ key: 'source-a+100' });
    const next = createSnapshot({ key: 'source-b+100', savedAt: 2000 });

    expect(shouldSavePlayRecord(previous, next, 'pause')).toBe(true);
  });

  it('always saves when the source key changes during a heartbeat', () => {
    const previous = createSnapshot({ key: 'source-a+100' });
    const next = createSnapshot({ key: 'source-a+999', savedAt: 2000, playTime: 121 });

    expect(shouldSavePlayRecord(previous, next, 'heartbeat')).toBe(true);
  });

  it('saves forced events when total duration shifts enough within the duplicate window', () => {
    const previous = createSnapshot();
    // playTime barely moved (delta 2), but totalTime jumped 5s (e.g. late metadata load)
    const next = createSnapshot({ savedAt: 3000, playTime: 122, totalTime: 1805 });

    expect(shouldSavePlayRecord(previous, next, 'pause')).toBe(true);
  });

  it('skips forced events when neither playTime nor totalTime moved enough within the duplicate window', () => {
    const previous = createSnapshot();
    const next = createSnapshot({ savedAt: 3000, playTime: 122, totalTime: 1803 });

    expect(shouldSavePlayRecord(previous, next, 'pause')).toBe(false);
  });

  it('heartbeat ignores totalTime changes — only playTime delta matters', () => {
    const previous = createSnapshot();
    // totalTime jumped 10s but playTime barely moved
    const next = createSnapshot({ savedAt: 31000, playTime: 122, totalTime: 1810 });

    expect(shouldSavePlayRecord(previous, next, 'heartbeat')).toBe(false);
  });

  it('saves forced events at exactly the duplicate window boundary (just over)', () => {
    const previous = createSnapshot();
    // elapsedMs = 10001 > 10000  →  should save
    const next = createSnapshot({ savedAt: 11001, playTime: 121 });

    expect(shouldSavePlayRecord(previous, next, 'visibility-hidden')).toBe(true);
  });

  it('skips forced events exactly at the duplicate window edge (not yet over)', () => {
    const previous = createSnapshot();
    // elapsedMs = 10000, condition is strictly >, so this should not pass
    const next = createSnapshot({ savedAt: 11000, playTime: 121 });

    expect(shouldSavePlayRecord(previous, next, 'pause')).toBe(false);
  });

  it('skips forced saves at exactly one second below the progress threshold', () => {
    const previous = createSnapshot();
    // playTimeDelta = 4, threshold is >= 5  →  should not save
    const next = createSnapshot({ savedAt: 3000, playTime: 124 });

    expect(shouldSavePlayRecord(previous, next, 'pause')).toBe(false);
  });

  it('skips heartbeat saves at exactly one second below the progress threshold', () => {
    const previous = createSnapshot();
    const next = createSnapshot({ savedAt: 31000, playTime: 124 });

    expect(shouldSavePlayRecord(previous, next, 'heartbeat')).toBe(false);
  });
});
