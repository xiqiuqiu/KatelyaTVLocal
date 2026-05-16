import { callOpenAiCompatibleChat } from './openai-compatible';
import type { AiFindConfig } from './types';

const config: AiFindConfig = {
  enabled: true,
  baseUrl: 'https://ai.example/v1',
  apiKey: 'key',
  model: 'model',
  temperature: 0.2,
  maxToolRounds: 4,
  requestTimeoutMs: 5000,
  maxResults: 5,
  webSearchEnabled: false,
  webSearchProvider: 'none',
  webSearchEndpoint: '',
  webSearchApiKey: '',
  dailyLimitPerUser: 20,
  cacheTtlSeconds: 1800,
};

describe('OpenAI-compatible client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('normalizes plain assistant messages', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"answer":"ok"}',
            },
          },
        ],
      }),
    });

    const response = await callOpenAiCompatibleChat({
      config,
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(response.content).toBe('{"answer":"ok"}');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://ai.example/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('normalizes tool calls', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  function: {
                    name: 'web_search_media',
                    arguments: '{"query":"test"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    const response = await callOpenAiCompatibleChat({
      config,
      messages: [{ role: 'user', content: 'hello' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'web_search_media',
            description: '',
            parameters: {},
          },
        },
      ],
    });

    expect(response.tool_calls?.[0]).toEqual({
      id: 'call-1',
      name: 'web_search_media',
      arguments: '{"query":"test"}',
    });
  });
});

