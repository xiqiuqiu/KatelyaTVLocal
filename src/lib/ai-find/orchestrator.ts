import { mapWithConcurrency } from './concurrency';
import { getAiFindConfigError } from './config';
import type { AiFindDebugContext } from './debug';
import { logAiFindDebug } from './debug';
import { callOpenAiCompatibleChat } from './openai-compatible';
import { AI_FIND_SYSTEM_PROMPT, buildAiFindUserPrompt } from './prompt';
import { buildAiFindResultGroup } from './tools/search-katelya-sources';
import type {
  AiFindCandidateQuery,
  AiFindConfig,
  AiFindRequest,
  AiFindResponse,
  AiFindToolTrace,
  AiModelMessage,
} from './types';

interface CandidatePayload {
  answer?: string;
  candidates?: Partial<AiFindCandidateQuery>[];
  suggestions?: string[];
}

const AI_FIND_CANDIDATE_CONCURRENCY = 2;

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

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
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
      verifiedTitle: normalizeOptionalText(candidate.verifiedTitle),
      year: normalizeOptionalText(candidate.year),
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

async function generateCandidates({
  config,
  request,
  debugContext,
}: {
  config: AiFindConfig;
  request: AiFindRequest;
  debugContext?: AiFindDebugContext;
}): Promise<{
  answer: string;
  candidates: AiFindCandidateQuery[];
  suggestions: string[];
  degraded?: boolean;
  errorMessage?: string;
}> {
  const configError = getAiFindConfigError(config);
  if (configError) {
    logAiFindDebug({
      configDebug: config.debug,
      context: debugContext,
      event: 'candidate generation skipped',
      details: {
        reason: configError,
      },
    });
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
    logAiFindDebug({
      configDebug: config.debug,
      context: debugContext,
      event: 'candidate generation started',
      details: {
        query: request.query,
        mode: 'candidate-only',
        maxResults: config.maxResults,
      },
    });
    const response = await callOpenAiCompatibleChat({
      config,
      messages,
      debugContext,
    });

    logAiFindDebug({
      configDebug: config.debug,
      context: debugContext,
      event: 'candidate generation response',
      details: {
        contentLength: response.content?.length ?? 0,
        reasoningLength: response.reasoning_content?.length ?? 0,
        toolCallCount: response.tool_calls?.length ?? 0,
      },
    });

    const payload = parseCandidatePayload(response.content || null);
    const candidates = dedupeCandidates(
      payload.candidates || [],
      config.maxResults
    );

    if (candidates.length === 0) {
      logAiFindDebug({
        configDebug: config.debug,
        context: debugContext,
        event: 'candidate generation degraded',
        details: {
          reason: 'AI did not return candidate queries',
          suggestions:
            payload.suggestions || getDefaultSuggestions(request.query),
        },
      });
      return {
        answer: payload.answer || '没有识别出明确片名，已使用原始输入搜索。',
        candidates: buildFallbackCandidates(request, config.maxResults),
        suggestions:
          payload.suggestions || getDefaultSuggestions(request.query),
        degraded: true,
        errorMessage: 'AI did not return candidate queries',
      };
    }

    logAiFindDebug({
      configDebug: config.debug,
      context: debugContext,
      event: 'candidate generation completed',
      details: {
        candidateCount: candidates.length,
        candidateQueries: candidates.map((candidate) => candidate.query),
        suggestions:
          payload.suggestions || getDefaultSuggestions(request.query),
      },
    });

    return {
      answer: payload.answer || '已根据你的描述生成候选搜索词。',
      candidates,
      suggestions: payload.suggestions || getDefaultSuggestions(request.query),
    };
  } catch (error) {
    logAiFindDebug({
      configDebug: config.debug,
      context: debugContext,
      event: 'candidate generation degraded',
      details: {
        reason: error instanceof Error ? error.message : 'AI request failed',
      },
    });
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
  debugContext,
}: {
  config: AiFindConfig;
  request: AiFindRequest;
  requestOrigin?: string;
  debugContext?: AiFindDebugContext;
}): Promise<AiFindResponse> {
  const toolTrace: AiFindToolTrace[] = [];
  const candidateResult = await generateCandidates({
    config,
    request,
    debugContext,
  });
  const groupResults = await mapWithConcurrency(
    candidateResult.candidates,
    AI_FIND_CANDIDATE_CONCURRENCY,
    async (candidate) => {
      logAiFindDebug({
        configDebug: config.debug,
        context: debugContext,
        event: 'candidate group build started',
        details: {
          query: candidate.query,
          confidence: candidate.confidence,
          year: candidate.year,
          type: candidate.type,
        },
      });

      try {
        const group = await buildAiFindResultGroup({
          candidate,
          maxGroups: 8,
          cacheTtlSeconds: config.cacheTtlSeconds,
          requestOrigin,
          prefer: request.userPreference?.prefer,
          debugContext,
        });

        logAiFindDebug({
          configDebug: config.debug,
          context: debugContext,
          event: 'candidate group build completed',
          details: {
            query: candidate.query,
            rawCount: group.rawCount,
            groupedCount: group.groupedCount,
            notFound: Boolean(group.notFound),
          },
        });

        return {
          group,
          failed: false,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : '候选片名处理失败';

        logAiFindDebug({
          configDebug: config.debug,
          context: debugContext,
          event: 'candidate group degraded',
          details: {
            query: candidate.query,
            errorMessage,
          },
        });

        return {
          group: {
            query: candidate.query,
            reason: candidate.reason,
            confidence: candidate.confidence,
            rawCount: 0,
            groupedCount: 0,
            groups: [],
            notFound: true,
          },
          failed: true,
        };
      }
    }
  );
  const groups = groupResults.map((item) => item.group);
  const partialFailureCount = groupResults.filter((item) => item.failed).length;
  const foundCount = groups.reduce(
    (count, group) => count + group.groupedCount,
    0
  );
  const partialFailureMessage =
    partialFailureCount > 0
      ? '部分候选片名在站内搜索或可播探测阶段失败，已返回其余可用结果。'
      : undefined;
  const errorMessages = [
    candidateResult.errorMessage,
    partialFailureMessage,
  ].filter(Boolean) as string[];

  logAiFindDebug({
    configDebug: config.debug,
    context: debugContext,
    event: 'ai find completed',
    details: {
      candidateCount: candidateResult.candidates.length,
      foundCount,
      degraded: Boolean(candidateResult.degraded || partialFailureCount > 0),
      partialFailureCount,
      toolTraceCount: toolTrace.length,
    },
  });

  return {
    answer:
      foundCount > 0
        ? candidateResult.answer
        : partialFailureCount > 0
        ? '部分候选片名查询失败，当前仅返回可用结果。'
        : '已搜索候选片名，但当前资源站没有找到可播放结果。',
    candidateQueries: candidateResult.candidates,
    groups,
    suggestions: candidateResult.suggestions,
    toolTrace,
    generatedAt: Date.now(),
    degraded: candidateResult.degraded || partialFailureCount > 0,
    errorMessage:
      errorMessages.length > 0 ? errorMessages.join('；') : undefined,
  };
}
