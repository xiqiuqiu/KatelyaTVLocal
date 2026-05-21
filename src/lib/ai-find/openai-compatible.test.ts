import { callOpenAiCompatibleChat } from './openai-compatible';
import type { AiFindConfig } from './types';

const config: AiFindConfig = {
  enabled: true,
  baseUrl: 'https://ai.example/v1',
  apiKey: 'key',
  model: 'model',
  debug: false,
  temperature: 0.2,
  maxToolRounds: 4,
  requestTimeoutMs: 5000,
  maxTokens: 800,
  thinkingMode: 'auto',
  maxResults: 5,
  webSearchEnabled: false,
  webSearchProvider: 'none',
  webSearchEndpoint: '',
  webSearchApiKey: '',
  dailyLimitPerUser: 20,
  dailyLimitPerIp: 60,
  dailyLimitGlobal: 500,
  groupDailyLimitPerUser: 100,
  groupDailyLimitPerIp: 300,
  groupDailyLimitGlobal: 2500,
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
              reasoning_content: '先分析用户意图',
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
    expect(response.reasoning_content).toBe('先分析用户意图');
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

  it('serializes assistant tool calls for follow-up requests', async () => {
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

    await callOpenAiCompatibleChat({
      config,
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          reasoning_content: '先整理站内候选片名',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              name: 'search_katelya_sources',
              arguments: '{"query":"隐秘的角落"}',
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call-1',
          content: '{"results":[]}',
        },
      ],
    });

    const request = (global.fetch as jest.Mock).mock.calls[0][1] as {
      body: string;
    };
    const payload = JSON.parse(request.body) as {
      messages: Array<Record<string, unknown>>;
    };

    expect(payload.messages[1]).toEqual({
      role: 'assistant',
      reasoning_content: '先整理站内候选片名',
      content: null,
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'search_katelya_sources',
            arguments: '{"query":"隐秘的角落"}',
          },
        },
      ],
    });
    expect(payload.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: '{"results":[]}',
    });
  });

  it('sends bounded JSON output and DeepSeek thinking controls when configured', async () => {
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

    await callOpenAiCompatibleChat({
      config: {
        ...config,
        maxTokens: 600,
        thinkingMode: 'disabled',
      },
      messages: [{ role: 'user', content: 'hello' }],
    });

    const request = (global.fetch as jest.Mock).mock.calls[0][1] as {
      body: string;
    };
    const payload = JSON.parse(request.body) as Record<string, unknown>;

    expect(payload.max_tokens).toBe(600);
    expect(payload.response_format).toEqual({ type: 'json_object' });
    expect(payload.thinking).toEqual({ type: 'disabled' });
  });
});
