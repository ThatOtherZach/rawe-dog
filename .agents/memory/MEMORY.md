# Memory Index

- [Shell background processes](shell-background-processes.md) — processes started in one shell call are killed when it returns; run multi-step server tests as a single script invocation.
- [LLM mock e2e testing](llm-mock-e2e.md) — e2e-test LLM pipelines against a local OpenAI-compatible mock via the base-URL env hook, keyed off json_schema names.
- [xAI model quirks](xai-model-quirks.md) — multi-agent grok models are blocked on chat completions; the SDK surfaces it as a bare "400 (no body)", hiding the real error.
- [GitHub PUSH_REJECTED diagnosis](github-push-rejected.md) — bare PUSH_REJECTED is usually secret-scanning; scan unpushed commits for keys, and filter-branch removes purged files from disk too.
- [Accountless credits pattern](accountless-credits-pattern.md) — user's toasteth monetization: bearer-token credits, gate off by default, spend-on-success requires an in-flight reservation + atomic store claims.
- [req vs res close event](req-vs-res-close-event.md) — use res.on("close") not req.on("close") for SSE disconnect; req fires when express.json() finishes parsing the body, not when the client leaves.
- [Playwright blob multipart](playwright-blob-multipart.md) — CDP can't read File-blob FormData bodies; capture uploads with an injected fetch wrapper + echo headers.
- [Orval codegen pitfalls](orval-codegen-pitfalls.md) — zod+ts dual output collides on <OperationId>Body names; index append on quote mismatch; Blob needs a DOM lib. Regen with every spec edit.
- [Client IP behind Replit proxy](proxy-client-ip.md) — take the LAST x-forwarded-for entry (proxy-appended), never the first; reserve-at-start for quota gates to avoid TOCTOU.
- [XP & achievements system](xp-system.md) — Office Space Easter egg, client-side only; localStorage keys, event contract, widget visibility rule, full-loop bonus. Keep out of replit.md.
