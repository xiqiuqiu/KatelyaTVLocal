import type { SearchResult } from '@/lib/types';

export type AiFindConfidence = 'low' | 'medium' | 'high';
export type AiFindMediaType = 'movie' | 'tv' | 'show' | 'unknown';

export interface AiFindRequest {
  query: string;
  mode?: 'find' | 'browse';
  userPreference?: {
    prefer?: 'stable' | 'fast' | 'quality';
    type?: AiFindMediaType;
  };
}

export interface AiFindCandidateQuery {
  query: string;
  reason: string;
  confidence: AiFindConfidence;
  verifiedTitle?: string;
  year?: string;
  type?: AiFindMediaType;
}

export interface AiFindAggregatedResult {
  groupKey: string;
  title: string;
  year: string;
  type?: string;
  poster?: string;
  items: SearchResult[];
  playbackHint?: 'direct' | 'proxy' | 'unknown';
}

export interface AiFindResultGroup {
  query: string;
  reason: string;
  confidence: AiFindConfidence;
  rawCount: number;
  groupedCount: number;
  groups: AiFindAggregatedResult[];
  notFound?: boolean;
}

export interface AiFindToolTrace {
  name: string;
  input?: unknown;
  outputCount?: number;
  ok: boolean;
  error?: string;
}

export interface AiFindResponse {
  answer: string;
  candidateQueries: AiFindCandidateQuery[];
  groups: AiFindResultGroup[];
  suggestions: string[];
  toolTrace: AiFindToolTrace[];
  generatedAt: number;
  degraded?: boolean;
  errorMessage?: string;
}

export interface AiFindConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  debug: boolean;
  temperature: number;
  maxToolRounds: number;
  requestTimeoutMs: number;
  maxTokens: number;
  thinkingMode: 'auto' | 'enabled' | 'disabled';
  maxResults: number;
  webSearchEnabled: boolean;
  webSearchProvider: string;
  webSearchEndpoint: string;
  webSearchApiKey: string;
  dailyLimitPerUser: number;
  cacheTtlSeconds: number;
}

export interface AiModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AiModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  reasoning_content?: string | null;
  tool_calls?: AiModelToolCall[];
  tool_call_id?: string;
}

export interface AiModelToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
  source?: string;
}
