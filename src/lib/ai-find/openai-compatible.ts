import type {
  AiFindConfig,
  AiModelMessage,
  AiModelToolCall,
  AiModelToolSchema,
} from './types';

interface RawToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ChatChoice {
  message?: {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: RawToolCall[];
  };
}

interface ChatCompletionResponse {
  choices?: ChatChoice[];
  error?: {
    message?: string;
  };
}

function logAiFindDebug(
  enabled: boolean,
  event: string,
  details: Record<string, unknown>
): void {
  if (!enabled) return;
  console.log(`[ai-find] ${event}`, details);
}

function summarizeMessage(message: AiModelMessage) {
  return {
    role: message.role,
    contentLength: message.content?.length ?? 0,
    reasoningLength: message.reasoning_content?.length ?? 0,
    toolCallNames: message.tool_calls?.map((toolCall) => toolCall.name) ?? [],
    hasToolCallId: Boolean(message.tool_call_id),
  };
}

function serializeMessages(messages: AiModelMessage[]) {
  return messages.map((message) => {
    if (message.role === 'assistant') {
      return {
        role: 'assistant' as const,
        content: message.content,
        reasoning_content: message.reasoning_content,
        tool_calls: message.tool_calls?.map((toolCall) => ({
          id: toolCall.id,
          type: 'function' as const,
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        })),
      };
    }

    if (message.role === 'tool') {
      return {
        role: 'tool' as const,
        tool_call_id: message.tool_call_id,
        content: message.content ?? '',
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}

function normalizeToolCalls(
  toolCalls?: RawToolCall[] | null
): AiModelToolCall[] {
  const safeToolCalls = Array.isArray(toolCalls) ? toolCalls : [];

  return safeToolCalls
    .map((toolCall, index) => ({
      id: toolCall.id || `tool-call-${index}`,
      name: toolCall.function?.name || '',
      arguments: toolCall.function?.arguments || '{}',
    }))
    .filter((toolCall) => toolCall.name);
}

export async function callOpenAiCompatibleChat({
  config,
  messages,
  tools,
}: {
  config: AiFindConfig;
  messages: AiModelMessage[];
  tools?: AiModelToolSchema[];
}): Promise<AiModelMessage> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    config.requestTimeoutMs
  );

  try {
    logAiFindDebug(config.debug, 'chat completion request', {
      model: config.model,
      baseUrl: config.baseUrl,
      messageCount: messages.length,
      toolCount: tools?.length ?? 0,
      messages: messages.map(summarizeMessage),
    });

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: serializeMessages(messages),
        tools: tools && tools.length > 0 ? tools : undefined,
        tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
        temperature: config.temperature,
      }),
      signal: controller.signal,
    });

    const payload = (await response
      .json()
      .catch(() => null)) as ChatCompletionResponse | null;

    if (!response.ok) {
      const errorMessage =
        payload?.error?.message || `AI request failed: ${response.status}`;
      logAiFindDebug(config.debug, 'chat completion response error', {
        status: response.status,
        errorMessage,
      });
      throw new Error(errorMessage);
    }

    const message = payload?.choices?.[0]?.message;
    if (!message) {
      throw new Error('AI response did not include a message');
    }

    logAiFindDebug(config.debug, 'chat completion response', {
      contentLength: message.content?.length ?? 0,
      reasoningLength: message.reasoning_content?.length ?? 0,
      toolCallCount: message.tool_calls?.length ?? 0,
    });

    return {
      role: 'assistant',
      content: message.content ?? null,
      reasoning_content: message.reasoning_content ?? null,
      tool_calls: normalizeToolCalls(message.tool_calls),
    };
  } catch (error) {
    logAiFindDebug(config.debug, 'chat completion request failed', {
      errorMessage:
        error instanceof Error ? error.message : 'Unknown AI request failure',
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
