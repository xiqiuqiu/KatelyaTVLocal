import {
  getRecentPlayRecordsFromAll,
  normalizePlayRecordLimit,
  parsePlayRecordKey,
} from './play-record-key';

describe('play record key helpers', () => {
  it('parses source ids containing plus signs', () => {
    expect(parsePlayRecordKey('source-a+video+part+1')).toEqual({
      source: 'source-a',
      id: 'video+part+1',
    });
  });

  it('rejects invalid storage keys', () => {
    expect(parsePlayRecordKey('missing-separator')).toBeNull();
    expect(parsePlayRecordKey('+missing-source')).toBeNull();
    expect(parsePlayRecordKey('missing-id+')).toBeNull();
  });

  it('normalizes explicit recent limits with safe bounds', () => {
    expect(normalizePlayRecordLimit(null)).toBeUndefined();
    expect(normalizePlayRecordLimit('2')).toBe(2);
    expect(normalizePlayRecordLimit('0')).toBe(50);
    expect(normalizePlayRecordLimit('bad')).toBe(50);
    expect(normalizePlayRecordLimit('999')).toBe(200);
  });

  it('returns recent records ordered by save time', () => {
    expect(
      Object.keys(
        getRecentPlayRecordsFromAll(
          {
            old: { save_time: 1 },
            newest: { save_time: 3 },
            middle: { save_time: 2 },
          },
          2
        )
      )
    ).toEqual(['newest', 'middle']);
  });
});
