# Agent-generated tests with human approval

One agent reports a problem (for example "this screen is not fully exercised"). The generator turns it into a reviewable Playwright spec. The tester agent runs it only after an admin approves it. Code lives in `packages/generator`.

## Flow and trust boundaries

1. **Request.** `TestRequest`: opaque ids, a manifest screen id, a sanitized and length-capped goal. Boundary: ids are validated, the goal is sanitized. Hidden or unknown screens are rejected here.
2. **Plan.** The provider receives an `ExplorationInput`: roles and sanitized names only. Boundary: the exploration observation is untrusted page text; it passes through the core sanitizer plus the room-code rule, and hidden screens are dropped before the provider call. The provider never sees URLs, accounts, tools or run options.
3. **Draft.** The provider writes plan text and spec code. Boundary: both are untrusted output. The plan is sanitized line by line.
4. **Validate.** `validateSpec` parses the spec with the TypeScript parser and walks the AST. It never executes it. Issues are reason codes and line numbers, never source text.
5. **Approve.** `approveDraft` needs an admin actor, revalidates, and binds the approval to the SHA-256 of the spec. Any edit drops the approval and revalidates. Agents and models cannot approve.
6. **Queue.** An approved draft becomes a `run-generated-test` task (ids and hash only) on the same serial queue as hand-written scenarios.
7. **Run.** Before running, the handler checks status, hash equality (task, draft, approval) and validates again. A mismatch blocks the task and nothing executes. The executor receives the spec text only. The spec reaches the page through the seed fixture, which checks the manifest allowlist before any navigation, so production is always blocked and a spec cannot set its own URL.

## What the validator enforces

- Imports only from `hugents-seed`, and only `test` and `expect`.
- No `eval`, `Function`, `require`, dynamic `import`.
- No `process` (environment), `fetch`, sockets, `fs`, `child_process`, `globalThis`/`window`/`document`.
- No string that looks like a URL (including protocol-relative and `data:`); no `goto`, `route` or `request`.
- Locators: `getByRole`, `getByLabel`, `getByText`, `getByTestId` with literal arguments only.
- Only an allowlist of locator, action and assertion methods; no bracket access.
- Clicks, fills, presses and similar actions whose locator text matches a manifest `forbiddenActions` phrase.
- No e-mail, token or key shaped strings.
- Size limit (20,000 characters, 400 lines).
- Every test is `test(name, async ({ page }) => ...)` with `test` from the seed module and no other fixture.

Reason codes: `forbidden-action`, `disallowed-import`, `hardcoded-url`, `locator-not-allowed`, `api-not-allowed`, `network-access`, `filesystem-access`, `process-access`, `env-access`, `dynamic-code`, `secret-in-spec`, `missing-seed-fixture`, `size-limit`, `syntax-error`, `provider-unavailable`, `provider-malformed`, `screen-hidden`, `screen-unknown`.

## Without a model

With no provider configured, the pipeline uses the deterministic provider: a visibility-only skeleton built from the sanitized elements. A configured provider that times out, runs out of quota or returns garbage produces a `rejected` draft with `provider-unavailable` or `provider-malformed`; it never falls through to an approved or running draft. Evidence collection does not depend on this pipeline.

## Events

Each stage emits a core event with `tool: "generate-test"`. State is read from `status` and `phase`, never from `label`.

| Stage | agent | status | phase |
| --- | --- | --- | --- |
| requested | system | waiting | queued |
| planning | explorer | planning | analyze |
| generating | explorer | working | analyze |
| validating | explorer | reviewing | analyze |
| rejected | explorer | blocked | analyze |
| awaiting-approval | system | waiting | report |
| approved | system | working | queued |
| running | player-alpha | working | play |
| completed | player-alpha | completed | teardown |
| failed | system | failed | teardown |

## Playwright reuse

Playwright's test agents (planner, generator, healer) and the `seed.spec.ts` seed concept were reviewed at <https://playwright.dev/docs/test-agents>. This design keeps the planner → plan → generator → spec split and the seed test (as the seed fixture). It does not use their agent loop, which chooses tools freely, and it does not use the healer.

## Not built yet

See the pull request for the audit. In short: a real manifest parser, persistent draft storage, the worker that executes specs, the admin surface that calls `approveDraft`, a real model provider, and the Playwright wiring of the `hugents-seed` module.
