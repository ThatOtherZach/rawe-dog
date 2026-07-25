---
name: Playwright can't see File-blob multipart bodies
description: CDP returns empty postData for FormData uploads containing File blobs; capture uploads via an injected fetch wrapper instead.
---

Rule: in Playwright/Chromium, `request.postData()` and `request.postDataBuffer()` come back empty for multipart requests whose FormData contains File/Blob parts. Route interception still fulfills fine — the body is just unreadable from the Node side.

**Why:** Chromium's DevTools protocol does not serialize blob-backed request bodies. Hit this on upload-flow e2e tests: assertions on the multipart body always received `""` no matter which accessor was used.

**How to apply:** when a spec must assert on uploaded file names/contents, inject a `page.addInitScript` that wraps `window.fetch`, records FormData entries in-page (e.g. `window.__uploads = [{slot, name, text}]`), and — if the Node-side route mock needs the metadata to build its response state — echoes it via test-only request headers the handler can read with `request.headers()`. Read captures back with `page.evaluate`. Keeps production code untouched.
