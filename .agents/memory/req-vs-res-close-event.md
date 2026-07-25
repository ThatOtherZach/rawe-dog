---
name: req vs res close event for SSE disconnect detection
description: In Express with express.json(), req.on("close") fires when the request body stream ends (after body parsing), not when the client disconnects — use res.on("close") instead.
---

# SSE client-disconnect detection: use `res.on("close")`, not `req.on("close")`

## The rule
When setting up an abort signal for an SSE (or any streaming response) route, attach the disconnect listener to **`res`**, not **`req`**.

```typescript
// WRONG — fires immediately after express.json() finishes parsing the body
req.on("close", onClientClose);

// CORRECT — fires when the actual response connection closes (client gone)
res.on("close", onClientClose);
```

**Why:** `express.json()` reads and drains the request body stream. In Node.js HTTP, `IncomingMessage` (req) emits "close" when its underlying stream resource is closed — which happens as soon as the body is fully consumed, long before the response is sent. `ServerResponse` (res) emits "close" only when the actual socket connection drops.

**How to apply:** Any route that uses an AbortController to cancel downstream work when the client disconnects should attach to `res.on("close")` and clean up with `res.off("close")`.

## Discovered
Caught during e2e stream testing: the generate pipeline aborted immediately after emitting the pass1 status event (before any xAI call was made), because `express.json()` finishing triggered the `req.on("close")` handler, which fired `abortController.abort()`.

## Affected file
`artifacts/api-server/src/routes/app-generate.ts` — fixed.
