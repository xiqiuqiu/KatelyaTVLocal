# AI Find Assistant

AI Find Assistant adds a natural-language search mode to the existing search page.

The feature is intentionally narrow:

- The model reads the user's description and returns candidate titles or short searchable aliases.
- The search page shows candidate titles first, then loads KatelyaTV source results per candidate.
- KatelyaTV runs the existing source search once per candidate.
- Results stay grouped by candidate term.
- Every displayed play card is backed by existing KatelyaTV search results.
- Normal search and playback behavior are unchanged.

## Environment Variables

```text
AI_FIND_ENABLED=false
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=
AI_MODEL=
AI_FIND_DEBUG=false
AI_TEMPERATURE=0.2
AI_REQUEST_TIMEOUT_MS=20000
AI_MAX_TOKENS=800
AI_THINKING_MODE=auto
AI_MAX_RESULTS=5
AI_DAILY_LIMIT_PER_USER=20
AI_DAILY_LIMIT_PER_IP=60
AI_DAILY_LIMIT_GLOBAL=500
AI_GROUP_DAILY_LIMIT_PER_USER=100
AI_GROUP_DAILY_LIMIT_PER_IP=300
AI_GROUP_DAILY_LIMIT_GLOBAL=2500
AI_CACHE_TTL_SECONDS=1800
```

`AI_BASE_URL` must point to an OpenAI-compatible `/v1` API root. The current version uses a single Chat Completions call to identify likely titles, then reuses KatelyaTV's normal search aggregation.

For a better perceived response time, `/api/ai/find` can return candidate titles without waiting for source aggregation. The browser then calls `/api/ai/find/group` per candidate so result sections appear progressively.

`AI_MAX_TOKENS` limits how much text the title-recognition response can generate. `AI_THINKING_MODE` accepts `auto`, `enabled`, or `disabled`; when left as `auto`, DeepSeek V4 models are sent `thinking: { "type": "disabled" }` to avoid slow reasoning responses for this title-recognition flow.

The model request also uses JSON output mode so candidate parsing does not depend only on prompt compliance.

`AI_FIND_DEBUG=true` enables server-side debug logs for candidate generation and degraded fallbacks.

AI find quota state is stored in D1 table `ai_find_usage_daily`. Both `/api/ai/find` and `/api/ai/find/group` require a signed login session before they perform AI, source-search, or playback-probe work. `/api/ai/find` uses the `AI_DAILY_LIMIT_*` values. `/api/ai/find/group` uses the `AI_GROUP_DAILY_LIMIT_*` values because one user-facing AI search can fan out into several candidate group lookups.

## Safety Rules

- `AI_API_KEY` is server-only.
- The browser only calls `/api/ai/find` and `/api/ai/find/group`.
- Both AI find endpoints require login.
- The model cannot create playable cards directly.
- AI-generated candidates that do not exist in KatelyaTV source search are shown as not found.
- Timeout, result count, and D1-backed daily usage are capped.
