# AI Find Assistant

AI Find Assistant adds a natural-language search mode to the existing search page.

The feature is intentionally narrow:

- The model reads the user's description and returns candidate titles or short searchable aliases.
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
AI_MAX_RESULTS=5
AI_DAILY_LIMIT_PER_USER=20
AI_CACHE_TTL_SECONDS=1800
```

`AI_BASE_URL` must point to an OpenAI-compatible `/v1` API root. The current version uses a single Chat Completions call to identify likely titles, then reuses KatelyaTV's normal search aggregation.

`AI_FIND_DEBUG=true` enables server-side debug logs for candidate generation and degraded fallbacks.

## Safety Rules

- `AI_API_KEY` is server-only.
- The browser only calls `/api/ai/find`.
- The model cannot create playable cards directly.
- AI-generated candidates that do not exist in KatelyaTV source search are shown as not found.
- Timeout, result count, and daily usage are capped.
