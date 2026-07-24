---
name: Shell background processes
description: Background processes do not survive between shell tool invocations; how to run server-dependent tests anyway
---

Background processes launched in a shell tool call (even with `setsid`/`nohup`/`disown`) are terminated when that call returns. A server started in one invocation is dead by the next.

**Why:** Each shell invocation runs in its own session that gets cleaned up; observed directly (health check passed in the starting invocation, connection refused in the next).

**How to apply:** For any test that needs a running server (API instance, mock upstream), write ONE bash script that starts the servers, waits, runs every request/assertion, dumps logs, and kills the servers — then execute it in a single shell call. Long-lived processes belong in workflows instead.
