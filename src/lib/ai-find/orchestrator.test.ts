import { callOpenAiCompatibleChat } from './openai-compatible';
import { runAiFind } from './orchestrator';
import { buildAiFindResultGroup } from './tools/search-katelya-sources';

jest.mock('./openai-compatible', () => ({
  callOpenAiCompatibleChat: jest.fn(),
}));

jest.mock('./tools/search-katelya-sources', () => {
  const actual = jest.requireActual('./tools/search-katelya-sources');

  return {
    ...actual,
    buildAiFindResultGroup: jest.fn(),
  };
});

const config = {
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
} as const;

describe('AI find orchestrator', () => {
  const mockedCallOpenAiCompatibleChat =
    callOpenAiCompatibleChat as jest.MockedFunction<
      typeof callOpenAiCompatibleChat
    >;
  const mockedBuildAiFindResultGroup =
    buildAiFindResultGroup as jest.MockedFunction<
      typeof buildAiFindResultGroup
    >;

  beforeEach(() => {
    mockedBuildAiFindResultGroup.mockResolvedValue({
      query: '隐秘的角落',
      reason: '命中站内结果',
      confidence: 'high',
      rawCount: 1,
      groupedCount: 1,
      groups: [],
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses AI only for title recognition and then builds grouped search results', async () => {
    mockedCallOpenAiCompatibleChat.mockResolvedValue({
      role: 'assistant',
      content:
        '{"answer":"已识别出更可能的片名","candidates":[{"query":"隐秘的角落","reason":"国产犯罪悬疑剧匹配度高","confidence":"high","type":"tv"}],"suggestions":["隐秘的角落"]}',
    });

    const result = await runAiFind({
      config,
      request: {
        query: '想看节奏快一点的国产悬疑剧',
        userPreference: {
          prefer: 'stable',
          type: 'tv',
        },
      },
      requestOrigin: 'https://app.example.com',
    });

    expect(mockedCallOpenAiCompatibleChat).toHaveBeenCalledTimes(1);
    expect(
      mockedCallOpenAiCompatibleChat.mock.calls[0][0].tools
    ).toBeUndefined();
    expect(mockedBuildAiFindResultGroup).toHaveBeenCalledTimes(1);
    expect(mockedBuildAiFindResultGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          query: '隐秘的角落',
          confidence: 'high',
        }),
        requestOrigin: 'https://app.example.com',
        prefer: 'stable',
      })
    );
    expect(result.candidateQueries).toEqual([
      expect.objectContaining({
        query: '隐秘的角落',
        confidence: 'high',
      }),
    ]);
    expect(result.toolTrace).toEqual([]);
  });

  it('degrades when AI does not return candidate JSON', async () => {
    mockedCallOpenAiCompatibleChat.mockResolvedValue({
      role: 'assistant',
      content: 'not-json',
    });

    await expect(
      runAiFind({
        config,
        request: {
          query: '国产悬疑剧',
        },
        requestOrigin: 'https://app.example.com',
      })
    ).rejects.toMatchObject({
      message: 'AI did not return candidate queries',
      publicMessage: 'AI 暂时无法识别你的描述，请换一种说法再试',
      status: 502,
    });
    expect(mockedBuildAiFindResultGroup).not.toHaveBeenCalled();
  });

  it('normalizes numeric year fields from AI candidate output', async () => {
    mockedCallOpenAiCompatibleChat.mockResolvedValue({
      role: 'assistant',
      content:
        '{"answer":"已识别候选片名","candidates":[{"query":"漫长的季节","reason":"年代与类型匹配","confidence":"high","year":2023,"type":"tv"}],"suggestions":["漫长的季节"]}',
    });

    const result = await runAiFind({
      config,
      request: {
        query: '想看近几年的国产犯罪悬疑剧',
      },
      requestOrigin: 'https://app.example.com',
    });

    expect(result.degraded).not.toBe(true);
    expect(result.candidateQueries).toEqual([
      expect.objectContaining({
        query: '漫长的季节',
        year: '2023',
        confidence: 'high',
      }),
    ]);
  });

  it('can return candidate queries without waiting for grouped source results', async () => {
    mockedCallOpenAiCompatibleChat.mockResolvedValue({
      role: 'assistant',
      content:
        '{"answer":"已识别候选片名","candidates":[{"query":"盗梦空间","reason":"旋转陀螺和梦境匹配","confidence":"high","year":2010,"type":"movie"}],"suggestions":["盗梦空间"]}',
    });

    const result = await runAiFind({
      config,
      request: {
        query: '梦里行动，旋转陀螺',
        resolveGroups: false,
      },
      requestOrigin: 'https://app.example.com',
    });

    expect(mockedBuildAiFindResultGroup).not.toHaveBeenCalled();
    expect(result.answer).toBe('已识别候选片名');
    expect(result.candidateQueries).toEqual([
      expect.objectContaining({
        query: '盗梦空间',
        year: '2010',
      }),
    ]);
    expect(result.groups).toEqual([]);
  });

  it('degrades instead of rejecting when one candidate group build is aborted', async () => {
    mockedCallOpenAiCompatibleChat.mockResolvedValue({
      role: 'assistant',
      content:
        '{"answer":"已识别出更可能的片名","candidates":[{"query":"隐秘的角落","reason":"国产犯罪悬疑剧匹配度高","confidence":"high","type":"tv"},{"query":"漫长的季节","reason":"同类型高口碑国产悬疑剧","confidence":"medium","type":"tv"}],"suggestions":["隐秘的角落","漫长的季节"]}',
    });
    mockedBuildAiFindResultGroup.mockReset();
    mockedBuildAiFindResultGroup
      .mockResolvedValueOnce({
        query: '隐秘的角落',
        reason: '命中站内结果',
        confidence: 'high',
        rawCount: 1,
        groupedCount: 1,
        groups: [],
      })
      .mockRejectedValueOnce(new Error('The operation was aborted'));

    const result = await runAiFind({
      config,
      request: {
        query: '想看节奏快一点的国产悬疑剧',
      },
      requestOrigin: 'https://app.example.com',
    });

    expect(mockedBuildAiFindResultGroup).toHaveBeenCalledTimes(2);
    expect(result.degraded).toBe(true);
    expect(result.errorMessage).toContain('部分候选片名');
    expect(result.groups).toEqual([
      expect.objectContaining({
        query: '隐秘的角落',
        groupedCount: 1,
      }),
      expect.objectContaining({
        query: '漫长的季节',
        groupedCount: 0,
        notFound: true,
      }),
    ]);
  });

  it('rejects when AI request aborts instead of searching the raw user query', async () => {
    mockedCallOpenAiCompatibleChat.mockRejectedValue(
      new Error('The operation was aborted')
    );

    await expect(
      runAiFind({
        config,
        request: {
          query: '有部好莱坞电影，里面坏蛋在车门上装了炸弹',
        },
        requestOrigin: 'https://app.example.com',
      })
    ).rejects.toMatchObject({
      message: 'The operation was aborted',
      publicMessage: 'AI 找片请求超时，请稍后再试',
      status: 504,
    });
    expect(mockedBuildAiFindResultGroup).not.toHaveBeenCalled();
  });

  it('treats runtime AbortError shapes as AI request timeout', async () => {
    mockedCallOpenAiCompatibleChat.mockRejectedValue(
      new DOMException('This operation was aborted', 'AbortError')
    );

    await expect(
      runAiFind({
        config,
        request: {
          query: '有部好莱坞电影，车门炸弹，苍蝇救了一个人',
        },
        requestOrigin: 'https://app.example.com',
      })
    ).rejects.toMatchObject({
      publicMessage: 'AI 找片请求超时，请稍后再试',
      status: 504,
    });
    expect(mockedBuildAiFindResultGroup).not.toHaveBeenCalled();
  });
});
