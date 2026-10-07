# Core

Phase 1 of the roadmap. Contains no project-specific code.

- `src/events.ts`: versioned event contract (`v: 1`) with runtime validation. `waiting` is distinct from `working`.
- `src/sanitizer.ts`: single sanitizer (URLs, emails, tokens, secrets, control characters). Adapters add project rules such as room codes.
- `src/providers.ts`: `AiProvider` interface, deterministic provider and a fallback chain with validated, sanitized output.
- `src/store.ts`: `Store` interface and an in-memory adapter. `demo` events are rejected from live state.

Run `npm install`, then `npm run typecheck` and `npm test` from the repository root.
