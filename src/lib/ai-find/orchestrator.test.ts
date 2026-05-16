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
  maxResults: 5,
  webSearchEnabled: false,
  webSearchProvider: 'none',
  webSearchEndpoint: '',
  webSearchApiKey: '',
  dailyLimitPerUser: 20,
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

    const result = await runAiFind({
      config,
      request: {
        query: '国产悬疑剧',
      },
      requestOrigin: 'https://app.example.com',
    });

    expect(result.degraded).toBe(true);
    expect(result.errorMessage).toBe('AI did not return candidate queries');
    expect(result.candidateQueries[0].query).toBe('国产悬疑剧');
    expect(result.toolTrace).toEqual([]);
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
});
