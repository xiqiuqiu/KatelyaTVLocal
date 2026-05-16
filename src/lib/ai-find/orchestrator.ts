import { getAiFindConfigError } from './config';
import { callOpenAiCompatibleChat } from './openai-compatible';
import { AI_FIND_SYSTEM_PROMPT, buildAiFindUserPrompt } from './prompt';
import { buildAiFindResultGroup } from './tools/search-katelya-sources';
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

function normalizeConfidence(value: unknown): AiFindCandidateQuery['confidence'] {
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
  const jsonText =
    trimmed.startsWith('```')
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
  return [
    `${query} 电影`,
    `${query} 电视剧`,
    `${query} 综艺`,
  ].slice(0, 3);
}

function parseToolArguments(toolCall: AiModelToolCall): Record<string, unknown> {
  try {
    return JSON.parse(toolCall.arguments || '{}') as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid tool arguments for ${toolCall.name}`);
  }
}

async function executeToolCall({
  config,
  toolCall,
  toolTrace,
}: {
  config: AiFindConfig;
  toolCall: AiModelToolCall;
  toolTrace: AiFindToolTrace[];
}): Promise<AiModelMessage> {
  const args = parseToolArguments(toolCall);

  if (toolCall.name !== 'web_search_media') {
    const error = `Unsupported tool: ${toolCall.name}`;
    toolTrace.push({
      name: toolCall.name,
      input: args,
      ok: false,
      error,
    });

    return {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error }),
    };
  }

  try {
    const results = await webSearchMedia({
      config,
      query: String(args.query || ''),
      reason: String(args.reason || ''),
      locale: String(args.locale || 'zh-CN'),
    });

    toolTrace.push({
      name: toolCall.name,
      input: args,
      outputCount: results.length,
      ok: true,
    });

    return {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify({ results }),
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
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: message }),
    };
  }
}

async function generateCandidates({
  config,
  request,
  toolTrace,
}: {
  config: AiFindConfig;
  request: AiFindRequest;
  toolTrace: AiFindToolTrace[];
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
    const tools = config.webSearchEnabled ? [webSearchMediaToolSchema] : [];

    for (let round = 0; round <= config.maxToolRounds; round += 1) {
      lastMessage = await callOpenAiCompatibleChat({
        config,
        messages,
        tools,
      });

      messages.push(lastMessage);

      if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
        break;
      }

      const toolMessages = await Promise.all(
        lastMessage.tool_calls
          .slice(0, 3)
          .map((toolCall) =>
            executeToolCall({
              config,
              toolCall,
              toolTrace,
            })
          )
      );
      messages.push(...toolMessages);
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
        suggestions: payload.suggestions || getDefaultSuggestions(request.query),
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
      errorMessage: error instanceof Error ? error.message : 'AI request failed',
    };
  }
}

export async function runAiFind({
  config,
  request,
}: {
  config: AiFindConfig;
  request: AiFindRequest;
}): Promise<AiFindResponse> {
  const toolTrace: AiFindToolTrace[] = [];
  const candidateResult = await generateCandidates({
    config,
    request,
    toolTrace,
  });
  const groups = await Promise.all(
    candidateResult.candidates.map((candidate) =>
      buildAiFindResultGroup({
        candidate,
        maxGroups: 8,
        cacheTtlSeconds: config.cacheTtlSeconds,
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

