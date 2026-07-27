---
name: Client IP behind Replit proxy
description: How to read a trustworthy client IP for abuse controls when Express trust proxy is off.
---

Rule: behind Replit's single reverse proxy, take the **last** entry of `x-forwarded-for` (proxy-appended), never the first — earlier entries are client-controlled and forgeable. Fall back to `socket.remoteAddress`.

**Why:** a code review caught a quota gate that used the first XFF entry; a caller could forge a fresh identity per request and bypass the limit entirely.

**How to apply:** any rate-limit/quota/fingerprint keyed on IP. Also pair check-then-consume gates with an atomic reserve-at-start (+ release on failure) — separate check and consume steps have a TOCTOU race under concurrent requests.
