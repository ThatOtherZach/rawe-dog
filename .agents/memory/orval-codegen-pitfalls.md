---
name: Orval codegen pitfalls
description: Orval zod+typescript dual output collides on <OperationId>Body names, appends duplicate index exports on quote mismatch, and emits Blob types that need a DOM lib.
---

Three failure modes when running orval with both a zod client and typescript schemas from one OpenAPI spec:

1. **Name collisions across outputs.** The zod client exports `const <OperationId>Body` and the typescript schemas export `type <OperationId>Body` for the same inline request body. Two `export *` lines in the package index then fail with TS2308 (star-export ambiguity is name-based; value vs type doesn't save you). Fix: keep both stars, then explicitly re-export the colliding names from the module that should win. New collisions fail loudly with TS2308 — extend the list.

2. **Index append on quote mismatch.** Orval ensures its `export * from './generated/...'` lines exist in the package index by string match. If a formatter changed the quotes (`"` vs `'`), orval appends duplicates → instant TS2308 on every name. Keep index export lines in orval's own quote style (single).

3. **Blob in node packages.** Multipart `format: binary` fields generate `file: Blob`, which fails under a bare `lib: ["es2022"]`, `types: []` tsconfig. Scope a `"lib": ["es2022", "DOM"]` override to the generated-schemas package only.

**Why:** hit all three at once because a project's yaml had drifted for weeks without anyone running codegen — every latent issue fired on the next run. Regenerate in the same change as spec edits.
