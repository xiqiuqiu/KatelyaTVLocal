# AI Find Assistant

AI Find Assistant adds a natural-language search mode to the existing search page.

The feature is intentionally narrow:

- The model reads the user's description and returns candidate search terms.
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

`AI_BASE_URL` must point to an OpenAI-compatible `/v1` API root. The first version uses Chat Completions with tool calling.

## Web Search

Web search is optional. It is only used when the model needs help verifying a title, alias, actor, year, or fresh-release detail.

The configured endpoint receives a `POST` request:

```json
{
  "query": "search query",
  "reason": "why verification is needed",
  "locale": "zh-CN"
}
```

It should return one of these shapes:

```json
{
  "results": [
    {
      "title": "result title",
      "snippet": "short snippet",
      "url": "https://example.com/page"
    }
  ]
}
```

or

```json
{
  "items": [
    {
      "title": "result title",
      "snippet": "short snippet",
      "url": "https://example.com/page"
    }
  ]
}
```

## Safety Rules

- `AI_API_KEY` and `AI_WEB_SEARCH_API_KEY` are server-only.
- The browser only calls `/api/ai/find`.
- The model cannot create playable cards directly.
- AI-generated candidates that do not exist in KatelyaTV source search are shown as not found.
- Web search endpoints cannot point to private or localhost addresses.
- Tool rounds, timeout, result count, and daily usage are capped.

