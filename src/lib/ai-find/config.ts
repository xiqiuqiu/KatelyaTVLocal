import type { AiFindConfig } from './types';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true';
}

function parseNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeBaseUrl(value: string | undefined): string {
  const baseUrl = value?.trim() || 'https://api.openai.com/v1';
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function normalizeThinkingMode(
  value: string | undefined,
  baseUrl: string,
  model: string
): AiFindConfig['thinkingMode'] {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === 'auto' ||
    normalized === 'enabled' ||
    normalized === 'disabled'
  ) {
    return normalized;
  }

  if (/deepseek/i.test(baseUrl) && /deepseek-v4/i.test(model)) {
    return 'disabled';
  }

  return 'auto';
}

export function getAiFindConfig(
  env: Record<string, string | undefined> = process.env
): AiFindConfig {
  const baseUrl = normalizeBaseUrl(env.AI_BASE_URL);
  const model = env.AI_MODEL?.trim() || '';

  return {
    enabled: parseBoolean(env.AI_FIND_ENABLED, false),
    baseUrl,
    apiKey: env.AI_API_KEY?.trim() || '',
    model,
    debug: parseBoolean(env.AI_FIND_DEBUG, false),
    temperature: parseNumber(env.AI_TEMPERATURE, 0.2, 0, 2),
    maxToolRounds: parseNumber(env.AI_MAX_TOOL_ROUNDS, 4, 0, 8),
    requestTimeoutMs: parseNumber(
      env.AI_REQUEST_TIMEOUT_MS,
      20000,
      3000,
      25000
    ),
    maxTokens: parseNumber(env.AI_MAX_TOKENS, 800, 128, 4096),
    thinkingMode: normalizeThinkingMode(env.AI_THINKING_MODE, baseUrl, model),
    maxResults: parseNumber(env.AI_MAX_RESULTS, 5, 1, 10),
    webSearchEnabled: parseBoolean(env.AI_WEB_SEARCH_ENABLED, false),
    webSearchProvider: env.AI_WEB_SEARCH_PROVIDER?.trim() || 'none',
    webSearchEndpoint: env.AI_WEB_SEARCH_ENDPOINT?.trim() || '',
    webSearchApiKey: env.AI_WEB_SEARCH_API_KEY?.trim() || '',
    dailyLimitPerUser: parseNumber(env.AI_DAILY_LIMIT_PER_USER, 20, 1, 1000),
    cacheTtlSeconds: parseNumber(env.AI_CACHE_TTL_SECONDS, 1800, 30, 86400),
  };
}

export function getAiFindConfigError(config: AiFindConfig): string | null {
  if (!config.enabled) {
    return 'AI find assistant is disabled';
  }

  if (!config.apiKey) {
    return 'AI_API_KEY is required when AI find assistant is enabled';
  }

  if (!config.model) {
    return 'AI_MODEL is required when AI find assistant is enabled';
  }

  return null;
}
