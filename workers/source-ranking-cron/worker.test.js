/* eslint-env jest */
import worker from './worker';

describe('scheduled Pages invocations', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it.each([
    ['0 3 * * *', ['ranking', 'maintenance']],
    ['0 11,19 * * *', ['ranking']],
  ])('isolates subrequest budgets for %s', async (cron, expected) => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const ctx = { waitUntil: jest.fn() };
    await worker.scheduled(
      { cron },
      { CRON_TARGET_URL: 'https://example.test/api/cron' },
      ctx
    );
    await ctx.waitUntil.mock.calls[0][0];
    expect(
      global.fetch.mock.calls.map(([url]) =>
        new URL(url).searchParams.get('mode')
      )
    ).toEqual(expected);
  });
});
