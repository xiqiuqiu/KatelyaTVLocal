const mockGetOptionalRequestContext = jest.fn();
jest.mock(
  '@cloudflare/next-on-pages',
  () => ({ getOptionalRequestContext: () => mockGetOptionalRequestContext() }),
  { virtual: true }
);

import { getTmdbCredentials, isTmdbConfigured } from '@/lib/tmdb/env';

describe('getTmdbCredentials', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockGetOptionalRequestContext.mockReset();
    delete process.env.TMDB_READ_TOKEN;
    delete process.env.TMDB_API_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reads runtime env from the Cloudflare request context first', () => {
    mockGetOptionalRequestContext.mockReturnValue({
      env: { TMDB_READ_TOKEN: 'runtime-token' },
    });
    process.env.TMDB_READ_TOKEN = 'build-token';

    expect(getTmdbCredentials()).toEqual({
      readToken: 'runtime-token',
      apiKey: undefined,
    });
  });

  it('falls back to process.env outside Cloudflare', () => {
    mockGetOptionalRequestContext.mockImplementation(() => {
      throw new Error('not on cloudflare');
    });
    process.env.TMDB_API_KEY = 'v3-key';

    expect(getTmdbCredentials()).toEqual({
      readToken: undefined,
      apiKey: 'v3-key',
    });
  });

  it('trims whitespace and treats blank values as missing', () => {
    mockGetOptionalRequestContext.mockReturnValue({
      env: { TMDB_READ_TOKEN: '  token-with-spaces \n' },
    });
    process.env.TMDB_API_KEY = '   ';

    expect(getTmdbCredentials()).toEqual({
      readToken: 'token-with-spaces',
      apiKey: undefined,
    });
  });

  it('reports whether TMDB is configured at all', () => {
    mockGetOptionalRequestContext.mockReturnValue({ env: {} });
    expect(isTmdbConfigured({})).toBe(false);
    expect(isTmdbConfigured({ readToken: 'x' })).toBe(true);
    expect(isTmdbConfigured({ apiKey: 'y' })).toBe(true);
  });
});
