# Generator

Turns a problem reported by one agent into a reviewable Playwright test draft. Nothing generated runs until an admin approves it. See [docs/test-generation.md](../../docs/test-generation.md).

- `src/contracts.ts`: `TestRequest`, `TestDraft`, reason codes.
- `src/validator.ts`: pure static validator for generated specs (AST based, never executes the spec).
- `src/seed.ts`: the shared seed fixture contract (allowlist check, then login, then a ready page).
- `src/pipeline.ts`: exploration input, provider interface, deterministic provider, draft generation.
- `src/approval.ts`: admin-only approval, edit resets approval, content hash binding.
- `src/queue.ts`: approved draft to a `run-generated-test` task and its handler.
- `src/events.ts`: stage events on the core event contract.

Run `npm install`, then `npm run typecheck` and `npm test` from the repository root.
