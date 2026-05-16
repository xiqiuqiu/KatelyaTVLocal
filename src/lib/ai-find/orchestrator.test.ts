import { callOpenAiCompatibleChat } from './openai-compatible';
import { runAiFind } from './orchestrator';
import { rankPlayableResults } from './tools/rank-playable-results';
import {
  buildAiFindResultGroup,
  searchKatelyaSourcesTool,
} from './tools/search-katelya-sources';

jest.mock('./openai-compatible', () => ({
  callOpenAiCompatibleChat: jest.fn(),
}));

jest.mock('./tools/search-katelya-sources', () => {
  const actual = jest.requireActual('./tools/search-katelya-sources');

  return {
    ...actual,
    buildAiFindResultGroup: jest.fn(),
    searchKatelyaSourcesTool: jest.fn(),
  };
});

jest.mock('./tools/rank-playable-results', () => {
  const actual = jest.requireActual('./tools/rank-playable-results');

  return {
    ...actual,
    rankPlayableResults: jest.fn(),
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
  const mockedSearchKatelyaSourcesTool =
    searchKatelyaSourcesTool as jest.MockedFunction<
      typeof searchKatelyaSourcesTool
    >;
  const mockedRankPlayableResults = rankPlayableResults as jest.MockedFunction<
    typeof rankPlayableResults
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

  it('registers Katelya search and playback ranking tools and uses request origin for final groups', async () => {
    mockedCallOpenAiCompatibleChat
      .mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'search-1',
            name: 'search_katelya_sources',
            arguments: '{"query":"隐秘的角落","type":"tv","limit":5}',
          },
          {
            id: 'rank-1',
            name: 'rank_playable_results',
            arguments:
              '{"items":[{"sourceKey":"beta","id":"1","episodeUrl":"https://beta.example/1.m3u8"}],"prefer":"stable"}',
          },
        ],
      })
      .mockResolvedValueOnce({
        role: 'assistant',
        content:
          '{"answer":"已找到候选片名","candidates":[{"query":"隐秘的角落","reason":"命中站内结果","confidence":"high","type":"tv"}],"suggestions":["隐秘的角落"]}',
      });
    mockedSearchKatelyaSourcesTool.mockResolvedValue([
      {
        sourceKey: 'beta',
        sourceName: 'Beta',
        id: '1',
        title: '隐秘的角落',
        year: '2020',
        type: 'tv',
        poster: '',
        episodeCount: 12,
        firstEpisodeUrl: 'https://beta.example/1.m3u8',
      },
    ]);
    mockedRankPlayableResults.mockResolvedValue({
      orderedSourceKeys: ['beta'],
      orderedItems: [
        {
          sourceKey: 'beta',
          id: '1',
          episodeUrl: 'https://beta.example/1.m3u8',
          kind: 'direct',
          reason: '可直连',
          probeTimeMs: 120,
          cacheState: 'miss',
        },
      ],
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

    expect(mockedCallOpenAiCompatibleChat).toHaveBeenCalledTimes(2);
    expect(
      mockedCallOpenAiCompatibleChat.mock.calls[0][0].tools?.map(
        (tool) => tool.function.name
      )
    ).toEqual(
      expect.arrayContaining([
        'search_katelya_sources',
        'rank_playable_results',
      ])
    );
    expect(mockedSearchKatelyaSourcesTool).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '隐秘的角落',
        type: 'tv',
        limit: 5,
        cacheTtlSeconds: 1800,
      })
    );
    expect(mockedRankPlayableResults).toHaveBeenCalledWith({
      items: [
        {
          sourceKey: 'beta',
          id: '1',
          episodeUrl: 'https://beta.example/1.m3u8',
        },
      ],
      origin: 'https://app.example.com',
      prefer: 'stable',
    });
    expect(mockedBuildAiFindResultGroup).toHaveBeenCalledWith(
      expect.objectContaining({
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
  });

  it('degrades after repeated malformed tool arguments', async () => {
    mockedCallOpenAiCompatibleChat
      .mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'search-1',
            name: 'search_katelya_sources',
            arguments: 'not-json',
          },
        ],
      })
      .mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'search-2',
            name: 'search_katelya_sources',
            arguments: 'still-not-json',
          },
        ],
      });

    const result = await runAiFind({
      config,
      request: {
        query: '国产悬疑剧',
      },
      requestOrigin: 'https://app.example.com',
    });

    expect(result.degraded).toBe(true);
    expect(result.errorMessage).toBe('Repeated invalid tool arguments');
    expect(result.candidateQueries[0].query).toBe('国产悬疑剧');
    expect(result.toolTrace).toHaveLength(2);
  });
});
