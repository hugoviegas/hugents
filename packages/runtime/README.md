# Runtime

Configurable agent runtime. Agents are versioned packages (see `agents/`), not code. See [docs/agent-runtime.md](../../docs/agent-runtime.md).

- `src/agent.ts`: package contract and validation.
- `src/registry.ts`: immutable versions, import and export (directory or bundle).
- `src/runner.ts`: task contract, lifecycle, timeout, retry, cancel, concurrency, events.
- `src/artifacts.ts`: artifact records, hashes, controlled paths, retention.
- `src/boards.ts`: board definitions and server-side transitions with human approvals.
- `src/schema.ts`: the closed JSON Schema subset.
- `src/persist.ts`: JSON-file persistence and the core `Store` over it.
- `src/workflow/`: the four workflow tools and the human/system run steps (reuse `@hugents/generator`).
- `src/cli.ts`: `npm run agents -- <command>` from the repository root.

Run `npm install`, then `npm run build`, `npm run typecheck` and `npm test` from the repository root.
