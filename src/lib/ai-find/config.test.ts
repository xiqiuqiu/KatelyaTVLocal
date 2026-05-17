import { getAiFindConfig, getAiFindConfigError } from './config';

describe('AI find config', () => {
  it('uses safe defaults when env vars are missing', () => {
    const config = getAiFindConfig({});

    expect(config.enabled).toBe(false);
    expect(config.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.maxResults).toBe(5);
    expect(config.requestTimeoutMs).toBe(20000);
  });

  it('normalizes configured values', () => {
    const config = getAiFindConfig({
      AI_FIND_ENABLED: 'true',
      AI_BASE_URL: 'https://example.com/v1/',
      AI_API_KEY: 'key',
      AI_MODEL: 'model',
      AI_MAX_RESULTS: '20',
      AI_REQUEST_TIMEOUT_MS: '1',
    });

    expect(config.enabled).toBe(true);
    expect(config.baseUrl).toBe('https://example.com/v1');
    expect(config.maxResults).toBe(10);
    expect(config.requestTimeoutMs).toBe(3000);
  });

  it('caps configured request timeout below edge runtime limits', () => {
    const config = getAiFindConfig({
      AI_REQUEST_TIMEOUT_MS: '45000',
    });

    expect(config.requestTimeoutMs).toBe(25000);
  });

  it('reports missing required model config only when enabled', () => {
    expect(getAiFindConfigError(getAiFindConfig({}))).toBe(
      'AI find assistant is disabled'
    );

    expect(
      getAiFindConfigError(
        getAiFindConfig({
          AI_FIND_ENABLED: 'true',
          AI_API_KEY: 'key',
        })
      )
    ).toBe('AI_MODEL is required when AI find assistant is enabled');
  });
});

