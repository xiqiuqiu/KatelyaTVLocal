import { normalizeDoubanScore } from '@/lib/downstream';

describe('normalizeDoubanScore', () => {
  it('keeps valid scores with one decimal place', () => {
    expect(normalizeDoubanScore(8.6)).toBe('8.6');
    expect(normalizeDoubanScore('7.9')).toBe('7.9');
    expect(normalizeDoubanScore(9)).toBe('9.0');
  });

  it('drops empty, zero and out-of-range values', () => {
    expect(normalizeDoubanScore(undefined)).toBeUndefined();
    expect(normalizeDoubanScore(null)).toBeUndefined();
    expect(normalizeDoubanScore('')).toBeUndefined();
    expect(normalizeDoubanScore(0)).toBeUndefined();
    expect(normalizeDoubanScore('0.0')).toBeUndefined();
    expect(normalizeDoubanScore(10.5)).toBeUndefined();
    expect(normalizeDoubanScore('暂无')).toBeUndefined();
  });
});
