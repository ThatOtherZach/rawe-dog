---
name: LLM mock e2e testing
description: Pattern for end-to-end testing LLM generation pipelines without real API keys
---

To e2e-test an LLM pipeline without a real provider key: the API client honors a base-URL env override (dev/test hook) pointing at a local OpenAI-compatible mock (`node:http` server answering `/chat/completions`).

**Why:** No real xAI key exists in this workspace, and structured-output pipelines (schemas, repair rounds, SSE ordering) need deterministic upstream responses to verify.

**How to apply:**
- Key mock responses off `response_format.json_schema.name` (one canned payload per stage); read enum values out of the submitted schema so ID-constrained selections stay valid automatically.
- Use per-schema call counters to script multi-round behavior (e.g. first draft flawed → verifier flags it → repair call returns the fixed version).
- Seed app data (library files + `_meta.json`, settings with a dummy key) directly on disk matching the storage layer's format, and remove it after testing so health/status endpoints don't lie about readiness.
- Run the whole thing in a single shell script invocation (see shell-background-processes.md); assert on captured SSE frames with a small node script.
