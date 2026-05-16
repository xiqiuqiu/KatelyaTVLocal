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
    tool_calls?: RawToolCall[];
  };
}

interface ChatCompletionResponse {
  choices?: ChatChoice[];
  error?: {
    message?: string;
  };
}

function normalizeToolCalls(
  toolCalls: RawToolCall[] = []
): AiModelToolCall[] {
  return toolCalls
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
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        tools: tools && tools.length > 0 ? tools : undefined,
        tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
        temperature: config.temperature,
      }),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as
      | ChatCompletionResponse
      | null;

    if (!response.ok) {
      throw new Error(
        payload?.error?.message || `AI request failed: ${response.status}`
      );
    }

    const message = payload?.choices?.[0]?.message;
    if (!message) {
      throw new Error('AI response did not include a message');
    }

    return {
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: normalizeToolCalls(message.tool_calls),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
