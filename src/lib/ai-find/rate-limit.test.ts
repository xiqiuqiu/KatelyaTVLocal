import {
  checkAiFindRateLimit,
  clearAiFindRateLimits,
} from './rate-limit';

describe('AI find rate limit', () => {
  afterEach(() => {
    clearAiFindRateLimits();
  });

  it('allows requests until the daily limit is reached', () => {
    expect(
      checkAiFindRateLimit({ key: 'user:a', limit: 2, now: 1000 })
    ).toMatchObject({
      allowed: true,
      remaining: 1,
    });

    expect(
      checkAiFindRateLimit({ key: 'user:a', limit: 2, now: 2000 })
    ).toMatchObject({
      allowed: true,
      remaining: 0,
    });

    expect(
      checkAiFindRateLimit({ key: 'user:a', limit: 2, now: 3000 })
    ).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });
});

