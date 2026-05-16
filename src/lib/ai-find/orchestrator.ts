import { getAiFindConfigError } from './config';
import { callOpenAiCompatibleChat } from './openai-compatible';
import { AI_FIND_SYSTEM_PROMPT, buildAiFindUserPrompt } from './prompt';
import {
  rankPlayableResults,
  rankPlayableResultsToolSchema,
} from './tools/rank-playable-results';
import {
  buildAiFindResultGroup,
  searchKatelyaSourcesTool,
  searchKatelyaSourcesToolSchema,
} from './tools/search-katelya-sources';
import { webSearchMedia, webSearchMediaToolSchema } from './tools/web-search';
import type {
  AiFindCandidateQuery,
  AiFindConfig,
  AiFindRequest,
  AiFindResponse,
  AiFindToolTrace,
  AiModelMessage,
  AiModelToolCall,
} from './types';

interface CandidatePayload {
  answer?: string;
  candidates?: Partial<AiFindCandidateQuery>[];
  suggestions?: string[];
}

function normalizeConfidence(
  value: unknown
): AiFindCandidateQuery['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

function normalizeType(value: unknown): AiFindCandidateQuery['type'] {
  return value === 'movie' || value === 'tv' || value === 'show'
    ? value
    : 'unknown';
}

function dedupeCandidates(
  candidates: Partial<AiFindCandidateQuery>[],
  maxResults: number
): AiFindCandidateQuery[] {
  const seen = new Set<string>();
  const normalized: AiFindCandidateQuery[] = [];

  candidates.forEach((candidate) => {
    const query = candidate.query?.trim();
    if (!query) return;

    const key = query.replaceAll(' ', '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    normalized.push({
      query,
      reason: candidate.reason?.trim() || '根据你的描述生成的候选片名',
      confidence: normalizeConfidence(candidate.confidence),
      verifiedTitle: candidate.verifiedTitle?.trim() || undefined,
      year: candidate.year?.trim() || undefined,
      type: normalizeType(candidate.type),
    });
  });

  return normalized.slice(0, maxResults);
}

function parseCandidatePayload(content: string | null): CandidatePayload {
  if (!content) {
    return {};
  }

  const trimmed = content.trim();
  const jsonText = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed;

  try {
    return JSON.parse(jsonText) as CandidatePayload;
  } catch {
    return {};
  }
}

function buildFallbackCandidates(
  request: AiFindRequest,
  maxResults: number
): AiFindCandidateQuery[] {
  return dedupeCandidates(
    [
      {
        query: request.query,
        reason: 'AI 暂时不可用，已直接使用原始输入搜索',
        confidence: 'low',
        type: request.userPreference?.type || 'unknown',
      },
    ],
    maxResults
  );
}

function getDefaultSuggestions(query: string): string[] {
  return [`${query} 电影`, `${query} 电视剧`, `${query} 综艺`].slice(0, 3);
}

function parseToolArguments(
  toolCall: AiModelToolCall
): Record<string, unknown> {
  try {
    return JSON.parse(toolCall.arguments || '{}') as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid tool arguments for ${toolCall.name}`);
  }
}

function parseSearchToolInput(args: Record<string, unknown>): {
  query: string;
  type?: 'movie' | 'tv' | 'show' | 'unknown';
  year?: string;
  limit: number;
} {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    throw new Error('search_katelya_sources requires a non-empty query');
  }

  const type =
    args.type === 'movie' ||
    args.type === 'tv' ||
    args.type === 'show' ||
    args.type === 'unknown'
      ? args.type
      : 'unknown';
  const year =
    typeof args.year === 'string' ? args.year.trim() || undefined : undefined;
  const limit = Number.isFinite(args.limit)
    ? Math.min(20, Math.max(1, Number(args.limit)))
    : 20;

  return {
    query,
    type,
    year,
    limit,
  };
}

function parseRankToolInput(args: Record<string, unknown>): {
  items: Array<{
    sourceKey: string;
    id: string;
    episodeUrl: string | null;
  }>;
  prefer?: 'stable' | 'fast' | 'quality';
} {
  if (!Array.isArray(args.items)) {
    throw new Error('rank_playable_results requires an items array');
  }

  const items = args.items.slice(0, 20).map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('rank_playable_results item must be an object');
    }

    const candidate = item as Record<string, unknown>;
    const sourceKey =
      typeof candidate.sourceKey === 'string' ? candidate.sourceKey.trim() : '';
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const episodeUrl =
      typeof candidate.episodeUrl === 'string'
        ? candidate.episodeUrl.trim()
        : candidate.episodeUrl === null
        ? null
        : null;

    if (!sourceKey || !id) {
      throw new Error('rank_playable_results items require sourceKey and id');
    }

    return {
      sourceKey,
      id,
      episodeUrl,
    };
  });

  const prefer =
    args.prefer === 'fast' ||
    args.prefer === 'quality' ||
    args.prefer === 'stable'
      ? args.prefer
      : undefined;

  return {
    items,
    prefer,
  };
}

function parseWebSearchToolInput(args: Record<string, unknown>): {
  query: string;
  reason: string;
  locale: string;
} {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const reason = typeof args.reason === 'string' ? args.reason.trim() : '';

  if (!query || !reason) {
    throw new Error('web_search_media requires query and reason');
  }

  return {
    query,
    reason,
    locale: typeof args.locale === 'string' ? args.locale : 'zh-CN',
  };
}

function buildToolMessage(
  toolCallId: string,
  payload: unknown
): AiModelMessage {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify(payload),
  };
}

interface ToolExecutionResult {
  message: AiModelMessage;
  malformed: boolean;
}

async function executeToolCall({
  config,
  toolCall,
  toolTrace,
  requestOrigin,
  prefer,
}: {
  config: AiFindConfig;
  toolCall: AiModelToolCall;
  toolTrace: AiFindToolTrace[];
  requestOrigin?: string;
  prefer?: 'stable' | 'fast' | 'quality';
}): Promise<ToolExecutionResult> {
  let args: Record<string, unknown>;

  try {
    args = parseToolArguments(toolCall);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid tool arguments';
    toolTrace.push({
      name: toolCall.name,
      input: toolCall.arguments,
      ok: false,
      error: message,
    });

    return {
      message: buildToolMessage(toolCall.id, { error: message }),
      malformed: true,
    };
  }

  try {
    if (toolCall.name === 'search_katelya_sources') {
      const input = parseSearchToolInput(args);
      const results = await searchKatelyaSourcesTool({
        ...input,
        cacheTtlSeconds: config.cacheTtlSeconds,
      });

      toolTrace.push({
        name: toolCall.name,
        input,
        outputCount: results.length,
        ok: true,
      });

      return {
        message: buildToolMessage(toolCall.id, { results }),
        malformed: false,
      };
    }

    if (toolCall.name === 'rank_playable_results') {
      if (!requestOrigin) {
        throw new Error('Missing request origin for rank_playable_results');
      }

      const input = parseRankToolInput(args);
      const results = await rankPlayableResults({
        items: input.items,
        origin: requestOrigin,
        prefer: input.prefer || prefer,
      });

      toolTrace.push({
        name: toolCall.name,
        input,
        outputCount: results.orderedItems.length,
        ok: true,
      });

      return {
        message: buildToolMessage(toolCall.id, results),
        malformed: false,
      };
    }

    if (toolCall.name === 'web_search_media') {
      const input = parseWebSearchToolInput(args);
      const results = await webSearchMedia({
        config,
        query: input.query,
        reason: input.reason,
        locale: input.locale,
      });

      toolTrace.push({
        name: toolCall.name,
        input,
        outputCount: results.length,
        ok: true,
      });

      return {
        message: buildToolMessage(toolCall.id, { results }),
        malformed: false,
      };
    }

    const error = `Unsupported tool: ${toolCall.name}`;
    toolTrace.push({
      name: toolCall.name,
      input: args,
      ok: false,
      error,
    });

    return {
      message: buildToolMessage(toolCall.id, { error }),
      malformed: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool failed';
    toolTrace.push({
      name: toolCall.name,
      input: args,
      ok: false,
      error: message,
    });

    return {
      message: buildToolMessage(toolCall.id, { error: message }),
      malformed:
        message.includes('requires') || message.includes('Invalid tool'),
    };
  }
}

async function generateCandidates({
  config,
  request,
  toolTrace,
  requestOrigin,
}: {
  config: AiFindConfig;
  request: AiFindRequest;
  toolTrace: AiFindToolTrace[];
  requestOrigin?: string;
}): Promise<{
  answer: string;
  candidates: AiFindCandidateQuery[];
  suggestions: string[];
  degraded?: boolean;
  errorMessage?: string;
}> {
  const configError = getAiFindConfigError(config);
  if (configError) {
    return {
      answer: 'AI 找片暂时不可用，已使用原始输入进行搜索。',
      candidates: buildFallbackCandidates(request, config.maxResults),
      suggestions: getDefaultSuggestions(request.query),
      degraded: true,
      errorMessage: configError,
    };
  }

  const messages: AiModelMessage[] = [
    {
      role: 'system',
      content: AI_FIND_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: buildAiFindUserPrompt(request.query),
    },
  ];

  try {
    let lastMessage: AiModelMessage | null = null;
    const tools = [
      searchKatelyaSourcesToolSchema,
      rankPlayableResultsToolSchema,
      ...(config.webSearchEnabled ? [webSearchMediaToolSchema] : []),
    ];
    let toolRounds = 0;
    let malformedToolCount = 0;
    let shouldContinue = true;

    while (shouldContinue) {
      lastMessage = await callOpenAiCompatibleChat({
        config,
        messages,
        tools,
      });

      messages.push(lastMessage);

      if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
        shouldContinue = false;
        continue;
      }

      if (toolRounds >= config.maxToolRounds) {
        return {
          answer: 'AI 推理轮次已达上限，已使用原始输入搜索。',
          candidates: buildFallbackCandidates(request, config.maxResults),
          suggestions: getDefaultSuggestions(request.query),
          degraded: true,
          errorMessage: 'AI tool round limit reached',
        };
      }

      toolRounds += 1;

      const toolResults = await Promise.all(
        lastMessage.tool_calls.slice(0, 3).map((toolCall) =>
          executeToolCall({
            config,
            toolCall,
            toolTrace,
            requestOrigin,
            prefer: request.userPreference?.prefer,
          })
        )
      );

      malformedToolCount += toolResults.filter(
        (result) => result.malformed
      ).length;
      messages.push(...toolResults.map((result) => result.message));

      if (malformedToolCount > 1) {
        return {
          answer: 'AI 工具参数异常，已使用原始输入搜索。',
          candidates: buildFallbackCandidates(request, config.maxResults),
          suggestions: getDefaultSuggestions(request.query),
          degraded: true,
          errorMessage: 'Repeated invalid tool arguments',
        };
      }
    }

    const payload = parseCandidatePayload(lastMessage?.content || null);
    const candidates = dedupeCandidates(
      payload.candidates || [],
      config.maxResults
    );

    if (candidates.length === 0) {
      return {
        answer: payload.answer || '没有识别出明确片名，已使用原始输入搜索。',
        candidates: buildFallbackCandidates(request, config.maxResults),
        suggestions:
          payload.suggestions || getDefaultSuggestions(request.query),
        degraded: true,
        errorMessage: 'AI did not return candidate queries',
      };
    }

    return {
      answer: payload.answer || '已根据你的描述生成候选搜索词。',
      candidates,
      suggestions: payload.suggestions || getDefaultSuggestions(request.query),
    };
  } catch (error) {
    return {
      answer: 'AI 找片暂时不可用，已使用原始输入进行搜索。',
      candidates: buildFallbackCandidates(request, config.maxResults),
      suggestions: getDefaultSuggestions(request.query),
      degraded: true,
      errorMessage:
        error instanceof Error ? error.message : 'AI request failed',
    };
  }
}

export async function runAiFind({
  config,
  request,
  requestOrigin,
}: {
  config: AiFindConfig;
  request: AiFindRequest;
  requestOrigin?: string;
}): Promise<AiFindResponse> {
  const toolTrace: AiFindToolTrace[] = [];
  const candidateResult = await generateCandidates({
    config,
    request,
    toolTrace,
    requestOrigin,
  });
  const groups = await Promise.all(
    candidateResult.candidates.map((candidate) =>
      buildAiFindResultGroup({
        candidate,
        maxGroups: 8,
        cacheTtlSeconds: config.cacheTtlSeconds,
        requestOrigin,
        prefer: request.userPreference?.prefer,
      })
    )
  );
  const foundCount = groups.reduce(
    (count, group) => count + group.groupedCount,
    0
  );

  return {
    answer:
      foundCount > 0
        ? candidateResult.answer
        : '已搜索候选片名，但当前资源站没有找到可播放结果。',
    candidateQueries: candidateResult.candidates,
    groups,
    suggestions: candidateResult.suggestions,
    toolTrace,
    generatedAt: Date.now(),
    degraded: candidateResult.degraded,
    errorMessage: candidateResult.errorMessage,
  };
}
