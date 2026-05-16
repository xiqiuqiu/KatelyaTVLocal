import { clearAiFindCache, getAiFindCache, setAiFindCache } from './cache';

describe('AI find cache', () => {
  afterEach(() => {
    clearAiFindCache();
  });

  it('returns cached values before expiry', () => {
    setAiFindCache('key', { value: 1 }, 60, 1000);

    expect(getAiFindCache('key', 2000)).toEqual({ value: 1 });
  });

  it('expires cached values', () => {
    setAiFindCache('key', { value: 1 }, 1, 1000);

    expect(getAiFindCache('key', 3000)).toBeNull();
  });
});

