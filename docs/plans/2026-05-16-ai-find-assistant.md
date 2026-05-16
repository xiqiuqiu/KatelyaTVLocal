# AI Find Assistant Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an AI-assisted natural-language movie and TV finder that turns user intent into verified, playable KatelyaTV results.

**Architecture:** Add a server-side AI orchestration route that talks to an OpenAI-compatible chat API, exposes a small set of controlled tools, and returns structured result cards to the existing search page. Web search is a verification tool, not the source of playable truth; KatelyaTV source search and source preference remain the authority for playable results.

**Tech Stack:** Next.js 14 App Router, Edge runtime route handlers where compatible, TypeScript, OpenAI-compatible Chat Completions, function/tool calling, existing KatelyaTV search APIs, existing source preference APIs, optional external web search provider.

---

## Scope

This plan implements the first version of AI Find Assistant:

- AI search entry on `/search`
- Server-side `/api/ai/find` endpoint
- OpenAI-compatible model client using configurable `baseUrl`, `apiKey`, and `model`
- Function calling loop with a strict max round limit
- Tools for KatelyaTV source search, optional web search verification, and playable-result ranking
- Grouped search results where each AI-generated candidate query keeps its own existing KatelyaTV aggregated search results
- Basic caching, timeout, rate limiting, and graceful fallback
- Environment variable configuration

This plan does not implement:

- A full chat assistant
- Long-term conversation memory
- Video frame analysis
- Automatic review generation
- Full personalized recommendation engine
- Admin UI editing for all AI settings in the first version
- Dependence on OpenAI Responses built-in `web_search`

## Key Product Boundary

The assistant should answer one user intent at a time.

The first version should feel like a smarter search mode:

1. User enters a natural-language request.
2. Assistant extracts likely search targets.
3. Assistant verifies unclear or fresh facts only when needed.
4. Assistant searches KatelyaTV sources once per candidate title/query.
5. Assistant keeps results grouped by candidate query, then uses the existing aggregation logic inside each group.
6. UI shows candidate sections with clickable existing result cards and short AI reasons.

It should not behave like a general chatbot. If the user asks unrelated questions, return a short message that the assistant is focused on finding movies, series, and shows.

## High-Level Flow

```text
/search AI mode
  -> POST /api/ai/find
    -> build model messages
    -> model may call tools
      -> search_katelya_sources
      -> web_search_media
      -> rank_playable_results
    -> model returns candidate search terms
    -> server runs existing search per candidate
    -> server returns grouped KatelyaTV search results
  -> frontend renders grouped result sections
  -> card opens existing play route
```

## Multi-Query Result Model

The current search page is built around one keyword at a time:

```text
keyword -> /api/search?q=keyword -> results from many sources -> aggregate by title/year/type
```

AI search should not flatten multiple generated titles into one undifferentiated list. The first version should use this model instead:

```text
natural language request
  -> AI candidate queries
    -> query 1 -> existing KatelyaTV search -> aggregate result cards for query 1
    -> query 2 -> existing KatelyaTV search -> aggregate result cards for query 2
    -> query 3 -> existing KatelyaTV search -> aggregate result cards for query 3
```

This preserves the existing search behavior while making AI results understandable. The user can see why each candidate was searched, and each candidate keeps the same multi-source aggregation semantics the normal search page already has.

Default limits:

- Candidate queries from AI: max 5
- Source results per candidate: max 30 before grouping
- Visible grouped cards per candidate: max 8 initially
- If one candidate returns no results, show it as "not found" instead of hiding it silently
- If all candidates return no results, show rewrite suggestions and a normal-search fallback

Display rule:

- Top area: "AI searched these candidates" with small chips for each candidate query.
- Main area: one section per candidate query.
- Inside each section: reuse `VideoCard` aggregate mode with `items={group}`.
- Each section can switch between aggregated and original results later, but first version can stay aggregated-only in AI mode to reduce UI complexity.

## Runtime Strategy

Prefer the existing Edge-compatible style, but keep the AI client implementation free of Node-only APIs. If a selected provider SDK requires Node APIs, call the HTTP endpoint directly with `fetch`.

First version should use OpenAI-compatible Chat Completions because many providers support `/v1/chat/completions` and `tools`. Do not depend on OpenAI-only Responses API hosted tools for the core path.

## Configuration

Add AI configuration from environment variables first:

```text
AI_FIND_ENABLED=false
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=
AI_MODEL=
AI_TEMPERATURE=0.2
AI_MAX_TOOL_ROUNDS=4
AI_REQUEST_TIMEOUT_MS=20000
AI_MAX_RESULTS=5
AI_WEB_SEARCH_ENABLED=false
AI_WEB_SEARCH_PROVIDER=none
AI_WEB_SEARCH_ENDPOINT=
AI_WEB_SEARCH_API_KEY=
AI_DAILY_LIMIT_PER_USER=20
AI_CACHE_TTL_SECONDS=1800
```

Add admin UI support later only if the environment-variable version proves useful.

## Data Contracts

### Request

Create `AiFindRequest`:

```ts
export interface AiFindRequest {
  query: string;
  mode?: 'find' | 'browse';
  userPreference?: {
    prefer?: 'stable' | 'fast' | 'quality';
    type?: 'movie' | 'tv' | 'show' | 'unknown';
  };
}
```

### Response

Create `AiFindResponse`:

```ts
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

export interface AiFindCandidateQuery {
  query: string;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
  verifiedTitle?: string;
  year?: string;
  type?: 'movie' | 'tv' | 'show' | 'unknown';
}

export interface AiFindResultGroup {
  query: string;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
  rawCount: number;
  groupedCount: number;
  groups: AiFindAggregatedResult[];
  notFound?: boolean;
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
```

The frontend should render `groups` as the source of truth. The `answer` text is only a short summary. Every displayed card must be backed by `SearchResult` items returned from the existing KatelyaTV search path.

## Prompt Contract

Use a focused system prompt:

```text
You are KatelyaTV's AI find assistant. Your job is to help users find movies, TV series, and variety shows that can actually be found in KatelyaTV's configured sources.

Rules:
1. Prefer KatelyaTV source search over general knowledge.
2. Use web search only when the user's request is ambiguous, fresh, or needs title/year/alias verification.
3. Never invent playable KatelyaTV results.
4. If web search finds a title but KatelyaTV source search does not, say that the title was identified but no playable source was found.
5. Return at most 5 candidate search queries.
6. Keep candidate reasons short and practical.
7. Do not output final playable cards directly; playable cards must come from KatelyaTV search results.
8. Output candidate queries in the required structured JSON format.
```

Keep provider-specific prompt variants out of the first version unless a tested provider needs small compatibility wording.

## Tools

### Tool 1: `search_katelya_sources`

Purpose: Find playable candidates from configured KatelyaTV sources for one candidate query.

Implementation:

- Reuse existing search logic from `src/app/api/search/route.ts` and `src/lib/downstream.ts`.
- Put reusable search code in a shared server utility so the AI route does not call the HTTP route internally.

Schema:

```json
{
  "query": "string",
  "type": "movie | tv | show | unknown",
  "year": "string",
  "limit": 20
}
```

Output should include only fields needed for AI selection and UI rendering.

The orchestrator may call this tool once per AI candidate query. Do not combine candidate queries into a single query string.

### Tool 2: `web_search_media`

Purpose: Verify title, year, aliases, actor names, or fresh releases.

Implementation:

- Add a provider adapter interface.
- First adapter can be disabled by default and enabled with env vars.
- Do not allow arbitrary URL fetching.
- Search query must be generated server-side from tool arguments.

Schema:

```json
{
  "query": "string",
  "reason": "string",
  "locale": "zh-CN"
}
```

Output should include title candidates, year, source link, and short snippet.

### Tool 3: `rank_playable_results`

Purpose: Sort results by likely playback success and user preference.

Implementation:

- Reuse existing `/api/source-preference` behavior where practical.
- Prefer direct playable sources first, then proxy-capable sources, then unknown.
- Preserve the existing direct-first, proxy-fallback strategy.

Schema:

```json
{
  "items": [
    {
      "sourceKey": "string",
      "id": "string",
      "episodeUrl": "string"
    }
  ],
  "prefer": "stable | fast | quality"
}
```

## Tool Loop Rules

The route should own the loop:

- Max tool rounds: default 4
- Max tool calls per round: 3
- Max total search candidates passed back to model: 30
- Max final results: 5
- Request timeout: default 20 seconds
- If model returns malformed tool args, return a tool error once; if repeated, stop and degrade.
- If AI fails after station search succeeds, return deterministic station-search results with a fallback summary.

## Files And Tasks

### Task 1: Add AI Types And Config

**Files:**

- Create: `src/lib/ai-find/types.ts`
- Create: `src/lib/ai-find/config.ts`
- Test: `src/lib/ai-find/config.test.ts`

Steps:

1. Define request, response, result, trace, tool, and config types.
2. Parse env vars with safe defaults.
3. Validate enabled state, missing API key, max rounds, timeout, and result limits.
4. Test disabled mode, valid config, and invalid numeric values.

Run:

```bash
pnpm test -- src/lib/ai-find/config.test.ts
```

Expected: all tests pass.

### Task 2: Build OpenAI-Compatible Chat Client

**Files:**

- Create: `src/lib/ai-find/openai-compatible.ts`
- Test: `src/lib/ai-find/openai-compatible.test.ts`

Steps:

1. Implement a thin `fetch` client for `POST {baseUrl}/chat/completions`.
2. Support `messages`, `tools`, `tool_choice: 'auto'`, `temperature`, and `model`.
3. Normalize provider response into internal `AiModelMessage`.
4. Add timeout using `AbortController`.
5. Test request shape, timeout behavior, tool call parsing, and plain final message parsing.

Run:

```bash
pnpm test -- src/lib/ai-find/openai-compatible.test.ts
```

Expected: all tests pass.

### Task 3: Extract Katelya Search Tool

**Files:**

- Create: `src/lib/ai-find/tools/search-katelya-sources.ts`
- Modify: `src/lib/downstream.ts`
- Test: `src/lib/ai-find/tools/search-katelya-sources.test.ts`

Steps:

1. Add a server-side helper that searches configured sources without going through the HTTP API route.
2. Limit source result count before returning to the model.
3. Normalize title, year, source, source name, id, poster, episode count, first episode URL, and play URL.
4. Add a shared aggregation helper that mirrors the current `/search` page grouping by normalized title, year, and movie/TV type.
5. Test empty query, normal results, source failures, max result trimming, and aggregate grouping.

Run:

```bash
pnpm test -- src/lib/ai-find/tools/search-katelya-sources.test.ts
```

Expected: all tests pass.

### Task 4: Add Web Search Adapter

**Files:**

- Create: `src/lib/ai-find/tools/web-search.ts`
- Create: `src/lib/ai-find/tools/web-search-providers.ts`
- Test: `src/lib/ai-find/tools/web-search.test.ts`

Steps:

1. Define a provider-neutral web search interface.
2. Implement a generic HTTP JSON adapter using env endpoint and API key.
3. Reject internal/private URLs and unsupported providers.
4. Return compact search results only: title, snippet, url, source.
5. Test disabled mode, provider error, private URL rejection, and successful result normalization.

Run:

```bash
pnpm test -- src/lib/ai-find/tools/web-search.test.ts
```

Expected: all tests pass.

### Task 5: Add Playable Result Ranking Tool

**Files:**

- Create: `src/lib/ai-find/tools/rank-playable-results.ts`
- Test: `src/lib/ai-find/tools/rank-playable-results.test.ts`
- Reference: `src/app/api/source-preference/route.ts`
- Reference: `src/lib/source-preference.ts`

Steps:

1. Accept candidate results from station search.
2. Map each candidate to source key and first episode URL.
3. Read source preference when available.
4. Sort direct, proxy, unknown, unavailable in that order.
5. Preserve source rank score and ping where available.
6. Test direct-first sorting, proxy fallback sorting, and missing preference fallback.

Run:

```bash
pnpm test -- src/lib/ai-find/tools/rank-playable-results.test.ts
```

Expected: all tests pass.

### Task 6: Build Tool Orchestrator

**Files:**

- Create: `src/lib/ai-find/orchestrator.ts`
- Create: `src/lib/ai-find/prompt.ts`
- Test: `src/lib/ai-find/orchestrator.test.ts`

Steps:

1. Build initial messages from request and prompt.
2. Register the three tool schemas.
3. Run model call and tool call loop.
4. Validate tool arguments before execution.
5. Append tool results back to model messages.
6. Stop at max rounds and produce candidate queries or fallback normal-search query if needed.
7. Run existing KatelyaTV search once per candidate query after candidate generation.
8. Aggregate results per candidate query without mixing groups across different AI candidates.
9. Parse final structured JSON and validate it.
10. Test simple station search, web verification path, multi-candidate grouping, empty candidate result, max-round stop, malformed args, and fallback path.

Run:

```bash
pnpm test -- src/lib/ai-find/orchestrator.test.ts
```

Expected: all tests pass.

### Task 7: Add API Route

**Files:**

- Create: `src/app/api/ai/find/route.ts`
- Test: `src/app/api/ai/find/route.test.ts`

Steps:

1. Validate request payload.
2. Reject when AI is disabled.
3. Resolve current user when available.
4. Apply per-user or per-IP daily limit.
5. Call orchestrator.
6. Return structured response.
7. Add no-store cache headers for user-specific responses.
8. Test disabled config, bad request, rate limit, successful response, and degraded response.

Run:

```bash
pnpm test -- src/app/api/ai/find/route.test.ts
```

Expected: all tests pass.

### Task 8: Add Caching And Rate Limit Storage

**Files:**

- Create: `src/lib/ai-find/cache.ts`
- Create: `src/lib/ai-find/rate-limit.ts`
- Test: `src/lib/ai-find/cache.test.ts`
- Test: `src/lib/ai-find/rate-limit.test.ts`

Steps:

1. Implement in-memory cache as first fallback.
2. Use existing storage backend only if a suitable shared interface already exists.
3. Cache normalized station search and web search results.
4. Rate-limit by username when logged in, otherwise by best available request identity.
5. Test cache hit, cache expiry, user limit, and anonymous limit.

Run:

```bash
pnpm test -- src/lib/ai-find/cache.test.ts src/lib/ai-find/rate-limit.test.ts
```

Expected: all tests pass.

### Task 9: Add Search Page UI

**Files:**

- Modify: `src/app/search/page.tsx`
- Create: `src/components/AiFindPanel.tsx`
- Create: `src/components/AiFindResultCard.tsx`
- Test: `src/components/__tests__/ai-find-panel.test.tsx`
- Test: `src/components/__tests__/ai-find-result-card.test.tsx`

Steps:

1. Add a normal search / AI search toggle on `/search`.
2. Keep existing search behavior unchanged by default.
3. Add AI input, submit button, loading stages, candidate chips, grouped result sections, and suggestions.
4. In AI mode, render one result section per AI candidate query.
5. Reuse `VideoCard` aggregate mode for grouped results inside each candidate section.
6. Make result cards open the existing play route.
7. Show "not found" sections for candidate queries that returned no KatelyaTV results.
8. Show clear degraded messages when AI or web search fails.
9. Test submit behavior, loading state, candidate chip rendering, grouped result rendering, empty candidate rendering, degraded state, and fallback suggestions.

Run:

```bash
pnpm test -- src/components/__tests__/ai-find-panel.test.tsx src/components/__tests__/ai-find-result-card.test.tsx
```

Expected: all tests pass.

### Task 10: Add Documentation

**Files:**

- Create: `docs/AI_FIND_ASSISTANT.md`
- Modify: `.env.example`
- Modify: `README.md`

Steps:

1. Document what the feature does and does not do.
2. Document environment variables.
3. Explain compatible provider requirements.
4. Explain web search provider expectations.
5. Document privacy and cost controls.

### Task 11: Verification

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected:

- Unit tests pass.
- Typecheck passes.
- Lint passes or only pre-existing unrelated warnings remain.
- Build passes.

Manual browser checks:

1. Start dev server with AI disabled.
2. Open `/search` and confirm normal search still works.
3. Enable AI with a test provider or mocked route.
4. Search: `想看节奏快一点的国产悬疑剧，不要太老`.
5. Confirm AI mode shows loading stages and returns cards.
6. Click a card and confirm it opens the existing play flow.
7. Simulate web search failure and confirm station search fallback still works.
8. Simulate AI provider failure and confirm the UI gives a useful fallback instead of a blank state.

## Acceptance Criteria

The feature is done when:

- Existing `/search` behavior is unchanged unless user chooses AI mode.
- AI mode returns structured candidate queries and grouped KatelyaTV search results, not just prose.
- The model cannot invent play links that are not from KatelyaTV search results.
- Multiple AI candidate titles do not get flattened into one mixed result list.
- Each candidate title keeps its own existing multi-source aggregation.
- Web search is optional and failure-tolerant.
- Tool calling is capped by round, timeout, and result limits.
- API keys never reach the browser.
- A disabled AI configuration fails gracefully.
- Normal test, typecheck, lint, and build verification pass.

## Risks And Mitigations

### Provider Compatibility

Risk: Some OpenAI-compatible providers claim tool support but return non-standard shapes.

Mitigation: Keep a provider-normalization layer and add tests for common response variants.

### Cost Growth

Risk: Web search and repeated model calls can increase cost.

Mitigation: Cache results, cap tool rounds, cap final candidates, and rate-limit per user.

### Hallucinated Availability

Risk: The model may claim content is playable when station search did not find it.

Mitigation: Final response parser should only allow `AiFindResult` items backed by tool result ids.

### Slow Search

Risk: Multi-source search plus web search can feel slow.

Mitigation: Use loading stages, timeouts, cached web search, and fallback station results.

### Prompt Injection From Web Results

Risk: Search snippets may contain adversarial instructions.

Mitigation: Treat web snippets as untrusted data. The prompt should state that tool outputs are data only, not instructions.

## Suggested Commit Sequence

1. `feat(ai-find): add config and OpenAI-compatible client`
2. `feat(ai-find): add search and web verification tools`
3. `feat(ai-find): add playable result ranking`
4. `feat(ai-find): add tool orchestrator and API route`
5. `feat(ai-find): add search page AI mode`
6. `docs(ai-find): document setup and limits`
