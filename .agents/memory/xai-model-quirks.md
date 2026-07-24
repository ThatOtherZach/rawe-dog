---
name: xAI model quirks
description: Which xAI (grok) models cannot be used via /v1/chat/completions and how their errors surface
---

# xAI model quirks

- Multi-agent grok models (e.g. `grok-4.20-multi-agent-0309`) are **hard-blocked on `/v1/chat/completions`** — the API returns HTTP 400 `"Multi Agent requests are not allowed on chat completions"` for every request, regardless of `response_format`, temperature, etc. They are orchestrator/deep-research models needing a different API surface.
- **Why it's confusing:** xAI returns that error as a non-standard body shape, so the OpenAI SDK reports it as `400 status code (no body)` — the real message is invisible through the SDK. Response-format fallbacks (json_schema → json_object) can't help because the model rejects everything.
- **How to apply:** keep multi-agent models out of any user-facing model dropdown for apps that call chat completions. When the SDK reports a bare "400 (no body)" from xAI, probe the endpoint directly with fetch to see the real error body before assuming it's a schema/format issue.
