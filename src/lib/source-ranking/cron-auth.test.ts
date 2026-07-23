import {
  isAuthorizedCronRequest,
  readCronApiToken,
  readCronRequestToken,
} from './cron-auth';

function createRequest(headers: Record<string, string>) {
  return {
    headers: {
      get(key: string) {
        return headers[key.toLowerCase()] || headers[key] || null;
      },
    },
  } as Pick<Request, 'headers'>;
}

describe('cron auth helpers', () => {
  it('reads cron token from runtime source', () => {
    expect(readCronApiToken({ CRON_API_TOKEN: 'secret-token' })).toBe(
      'secret-token'
    );
    expect(readCronApiToken({ CRON_API_TOKEN: '   ' })).toBeNull();
  });

  it('reads token from explicit cron header first', () => {
    expect(
      readCronRequestToken(
        createRequest({
          'x-cron-token': 'header-token',
          authorization: 'Bearer ignored-token',
        })
      )
    ).toBe('header-token');
  });

  it('falls back to bearer authorization token', () => {
    expect(
      readCronRequestToken(
        createRequest({
          authorization: 'Bearer bearer-token',
        })
      )
    ).toBe('bearer-token');
  });

  it('denies requests when no cron token is configured', () => {
    expect(isAuthorizedCronRequest(createRequest({}), {})).toBe(false);
  });

  it('denies requests when configured cron token is blank', () => {
    expect(
      isAuthorizedCronRequest(createRequest({}), { CRON_API_TOKEN: '   ' })
    ).toBe(false);
  });

  it('denies requests when request token is absent', () => {
    expect(
      isAuthorizedCronRequest(createRequest({}), {
        CRON_API_TOKEN: 'secret-token',
      })
    ).toBe(false);
  });

  it('rejects requests with a wrong token', () => {
    expect(
      isAuthorizedCronRequest(
        createRequest({
          'x-cron-token': 'wrong-token',
        }),
        { CRON_API_TOKEN: 'secret-token' }
      )
    ).toBe(false);
  });

  it('accepts requests with a matching token', () => {
    expect(
      isAuthorizedCronRequest(
        createRequest({
          'x-cron-token': 'secret-token',
        }),
        { CRON_API_TOKEN: 'secret-token' }
      )
    ).toBe(true);
  });
});
