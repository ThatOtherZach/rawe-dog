# Memory Index

- [Shell background processes](shell-background-processes.md) — processes started in one shell call are killed when it returns; run multi-step server tests as a single script invocation.
- [LLM mock e2e testing](llm-mock-e2e.md) — e2e-test LLM pipelines against a local OpenAI-compatible mock via the base-URL env hook, keyed off json_schema names.
- [xAI model quirks](xai-model-quirks.md) — multi-agent grok models are blocked on chat completions; the SDK surfaces it as a bare "400 (no body)", hiding the real error.
- [GitHub PUSH_REJECTED diagnosis](github-push-rejected.md) — bare PUSH_REJECTED is usually secret-scanning; scan unpushed commits for keys, and filter-branch removes purged files from disk too.
- [Accountless credits pattern](accountless-credits-pattern.md) — user's toasteth monetization: bearer-token credits, gate off by default, spend-on-success requires an in-flight reservation + atomic store claims.
