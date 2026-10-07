# Agent runtime

`packages/runtime` (`@hugents/runtime`) runs agents that are **configuration, not code**. An agent is a versioned package (identity, prompt, skills, tools, schemas, permissions, limits, board destinations, approval policy). The runtime is generic: it never branches on an agent id. Design critic, test planner, run creator, issue reviewer and accessibility critic are packages in `packages/runtime/agents/` that select tools from a closed registry.

## Architecture

```
                     agent package (dir or bundle)
                               │ validate (parseAgentPackage)
                               ▼
  human (config:mutate) ──► AgentRegistry ── immutable id@version + content hash
                               │
  human/system ── submit ──► AgentRunner ── task: agent id@version, input snapshot + hash, artifact refs
                               │  timeout · retry · cancel · per-agent + global concurrency
                               │  capability-gated ToolContext
                               ▼
                         ToolRegistry (closed) ── design-critic.review, test-planner.suggest,
                               │                  run-creator.generate (→ generator), issue-reviewer.draft
                               ▼ output (schema-validated, sanitized) + proposals + transitions
                          BoardService ── one atomic commit, server-side transition rules
                               │
   ArtifactRegistry ◄──────────┘  bytes in artifacts/objects/<id>, refs everywhere else
   FileStore (core Store) ◄── run-agent tasks + sanitized live events (core event contract)
```

Persistence is the mechanism the office already uses: one JSON file per collection, written with temp file + rename (`agents`, `tasks`, `board-items`, `artifacts`, `drafts`, `events`, `core-tasks`). The core `Store` interface is implemented over the same files (`FileStore`). No database or external service.

## Agent package layout

```
my-agent/
  agent.json            manifest (below)
  prompts/system.md     system prompt, ≤ 16,000 chars
  skills/<id>.md        0..16 skills, ≤ 8,000 chars each
  schemas/input.json    input schema (closed JSON Schema subset)
  schemas/output.json   output schema
```

Only `.md` and `.json` files, at most two folder levels, 32 files, 256 KB. Every file must be referenced by the manifest. A bundle is the same files in one JSON document: `{ "format": "hugents-agent-bundle", "formatVersion": 1, "files": { "<path>": "<text>" } }`.

### `agent.json`

| field | rule |
| --- | --- |
| `schemaVersion` | `1` |
| `id`, `version` | `^[a-z][a-z0-9-]{1,47}$`, semver `x.y.z` |
| `identity` | `name` ≤ 40, `role` ≤ 60, `description` ≤ 300 |
| `officeAgent` | optional office character for core events (`design-critic`, `explorer`, ...) |
| `model` | `provider`: `deterministic` \| `ollama` \| `gemini`, optional `model` name. Non-deterministic needs `model:invoke` |
| `prompt.system`, `skills[]` | file references |
| `entry`, `tools[]` | registered tool names; `entry` is the one the runner calls |
| `capabilities[]` | `artifact:read`, `artifact:write`, `board:read`, `board:propose`, `board:transition`, `model:invoke`, `env:read`. Human-only ones (`approval:grant`, `github:create-issue`, `config:mutate`) are rejected |
| `input`, `output` | schema files. Input must satisfy the entry tool's input; the tool's output must satisfy the agent's output |
| `limits` | `timeoutMs` 100..600000, `maxRetries` 0..5, `maxConcurrency` 1..8, `maxInputArtifacts` 0..50, `maxOutputBytes` ≤ 256 KB, `maxTokens` (0 = no limit) |
| `artifacts` | `accepts[]`, `produces[]` kinds |
| `boards` | `produces[]` (`board` + initial `state`), `transitions[]` the agent may perform (only agent transitions exist here) |
| `approval` | `{ "outputRequiresHuman": true }`, the only accepted value |
| `env[]` | variable **names** only. `^[A-Z][A-Z0-9_]*$`, not process-level (`PATH`, `NODE_OPTIONS`, ...), not client-exposed (`VITE_`, `NEXT_PUBLIC_`, ...) |

Validation fails closed with `{ code, path }` issues and never echoes a value. Any string in the manifest, prompt or skills that matches a core secret rule (URLs, e-mails, tokens, keys, `password=`...) is rejected (`secret-shaped`), so a package cannot carry a secret in or out.

Schemas use a closed subset: `object` (always `additionalProperties: false`), `array` (always `maxItems`), `string` (always `maxLength`, optional `enum`/anchored `pattern`), `integer`, `number`, `boolean`. Free text exists only in bounded string fields and is passed through the sanitizer; enum and pattern fields (ids, hashes) stay exact.

## Versions and history

`register` needs a human admin with `config:mutate`. The same id and version with the same content is a no-op; with different content it is `version-conflict`. A version lower than the newest is `stale-version`. New tasks must target the newest version (`stale-version` otherwise). Each task stores `agentVersion` and `agentContentHash`; the stored package is revalidated on load and a hand-edited `agents.json` is `agent-tampered`. Editing a prompt therefore always creates a new version and never changes what a historical task ran with.

## Tasks

`AgentTask` v1: `id`, `agentId`, `agentVersion`, `agentContentHash`, `input` (validated, sanitized, frozen), `inputHash`, `artifacts` (verified refs), `createdBy`, `state`, `attempts`, `history`, `result`. Only humans or the system submit tasks.

States: `queued → running → (retrying → running)* → succeeded | failed | timed-out | cancelled`. `timeout` and `tool-failed` are retried up to `maxRetries`; validation and permission failures never are. Each attempt gets an `AbortSignal` that fires on cancel, on timeout and when the attempt ends. Slots are FIFO per agent version (`maxConcurrency`) and global (`maxConcurrency` of the runner). After a restart, tasks that were claimed or running end `failed` with `interrupted`; queued ones stay queued.

Every state change is mirrored into the core `Store`: a `run-agent` task (`agentId`, `agentVersion`, `inputHash`) and a live event with `tool: "agent-runtime"`, fixed label words and a reason code. Events never contain prompts, input text, page text, screenshot bytes or file contents.

Reason codes: `src/errors.ts` (`RUNTIME_REASON_CODES`).

## Artifacts

Kinds and limits: `report` (markdown, 256 KB), `screenshot` (png/jpeg/webp, 5 MB, 30 days), `log` (json/text, 1 MB, 14 days), `generated-spec` (typescript, 64 KB), `run-evidence` (json, 256 KB), `issue-draft` (markdown, 64 KB).

A record holds an opaque id, kind, SHA-256, size, MIME type, origin (import / agent id@version + task / system stage), creation time and retention. Bytes live at `artifacts/objects/<id>`, a path the registry builds itself. Image types are checked by magic bytes, text kinds must be valid UTF-8 without NUL, JSON must parse. `importFile` reads only regular files inside configured import roots (symlinks and anything resolving outside are `unsafe-path`). `resolve(ref)` is the only way to use an artifact: unknown ids, refs whose kind/hash/size differ from the record (forged), bytes whose hash changed (tampered) and expired records are rejected. `sweep` removes expired bytes and keeps a tombstone so old refs fail with `artifact-expired`.

A tool may attach to a board item only artifacts its task received, produced, or read through an item it was allowed to read.

## Boards

| board | states | transitions |
| --- | --- | --- |
| `problems` | open, triaged, dismissed, resolved | open→triaged (agent); open/triaged→dismissed, triaged→resolved (human) |
| `run-suggestions` | proposed, approved, rejected, consumed | proposed→approved (**human approval**), proposed→rejected (human), approved→consumed (agent) |
| `approved-runs` | draft-ready, approved, rejected, running, passed, failed | draft-ready→approved (**human approval**, also the generator's hash-bound `approveDraft`), →rejected (human); approved→running, running→passed/failed, approved→failed (system) |
| `issue-drafts` | draft, approved, rejected, filed | draft→approved (**human approval**), →rejected (human); approved→filed (human with `github:create-issue`) |

Every transition is checked server-side in `BoardService`: the transition must exist, the actor kind must match, agents must have declared it in their package, approvals need `approval:grant` from a human who is not the creator, and the caller must name the current revision (`expectedRev`). A replayed or concurrent request fails with `stale-item`. Each change appends `{ at, from, to, actor (with agent version), reason, artifactIds }`. An approval stores the hash of the payload and artifact refs; `verifyApproval` fails (`approval-mismatch`) if the stored item changed afterwards. Proposals and transitions of one task are written in one commit.

## The first workflow

1. Import the design critic's Markdown report and screenshots as artifacts (`artifact-add`). Findings are `- [severity] text (screen: id)` lines.
2. `design-critic` → one `problems` item per finding, with the report and screenshot refs.
3. `test-planner` → one `run-suggestions` item (screen, goal) and marks the problem `triaged`.
4. **Human** approves the suggestion.
5. `run-creator` → checks the approval hash, runs the generator pipeline (`createRequest`, `generateDraft` with `restrictToObservedElements`), stores the spec as a `generated-spec` artifact, proposes an `approved-runs` item and consumes the suggestion. A rejected draft fails the stage with `draft-rejected`.
6. **Human** approves the spec: `approveRun` calls the generator's `approveDraft` and the board transition together.
7. `executeRun` (system) checks the board approval and the draft hash, then reuses `enqueueApprovedDraft` + `runDraftTask` + the restricted executor. A `run-evidence` artifact (status, reason codes, counts) is attached on `passed`/`failed`. An unapproved or altered draft never executes.
8. `issue-reviewer` → an `issue-drafts` item and a Markdown body artifact listing every artifact of the chain by kind, id, short hash and size. Contents are never copied.
9. **Human** approves; filing on GitHub stays a manual step for someone with `github:create-issue`. Nothing calls GitHub.

## Local use

```
npm install
npm run build
npm run agents -- demo                                   # whole flow, in memory, synthetic data
npm run agents -- import packages/runtime/agents/design-critic
npm run agents -- artifact-add report text/markdown <file> --import-root packages/duel-agent-office/artifacts
npm run agents -- run accessibility-critic --artifact <reportId> --artifact <screenshotId> --import-root <dir>
npm run agents -- run test-planner plan.json            # {"problemItemId": "..."}
npm run agents -- transition <itemId> approved <rev>     # human gate, as --as (default hugo)
npm run agents -- inspect
npm run agents -- export design-critic 1.0.0 critic.bundle.json
```

Data goes to `.hugents/runtime` (git-ignored) unless `--data` is given. The CLI is local: whoever runs it is the admin named by `--as`.

In the office dashboard (`npm run agent:dashboard` in `packages/duel-agent-office`), **Edit agent** shows the runtime packages of that office agent (its `officeAgent`, or the same id): versions, content hash, model, tools, capabilities, limits, boards, system prompt, skills and recent tasks with the board items they proposed. It is read only and reads `.hugents/runtime` (`HUGENTS_RUNTIME_DIR` overrides). Text goes through the office sanitizer. A change is still a new version imported with the CLI.

Browser-backed test: `packages/runtime/test/flow.chromium.test.ts` runs the generated spec in real Chromium against a local fixture page. It uses the Chromium matching `playwright-core` if installed (`npx playwright-core install chromium-headless-shell`), otherwise any Playwright-installed Chromium, or `HUGENTS_CHROMIUM_PATH`, and skips with a message when none launches.

## Compatibility

- Additive. `@hugents/core` gains the `run-agent` task kind and the `agent-runtime` tool value; existing events and tasks parse unchanged.
- The generator's validator, approval, queue and executor are reused unchanged. Drafts now persist through `DbDraftRepository` (the original intent of #14).
- `duel-agent-office` is not modified: its agents, `agent-config.json`, reports and run artifacts keep working. Its reports and screenshots enter the runtime only through `artifact-add` from an import root.
- No migration is needed: the runtime starts with empty collections.

## Boundaries

- Human identity is trusted at the caller, like `approveDraft`: a human actor must be built only after the admin surface (or the local CLI user) is verified. No remote admin API exists yet.
- Single local process: the JSON files are written by one process. Concurrent updates inside the process are serialized and guarded by revisions.
- Tools are in-process code from this repository. Agent packages cannot add code.
- The spec executor still runs in the worker's process (see test-generation.md); a killable child process is a separate step.
