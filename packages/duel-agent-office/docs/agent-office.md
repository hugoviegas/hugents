# Local QA agent office (issue #98)

Four QA agents (`player-alpha`, `explorer`, `qa-analyst`, `design-critic`) on a pixel-art office dashboard. Hugo creates tasks by hand on the task board; each agent claims its task, runs fixed tools against the local runner, writes a report and shows its status live. Everything is local: Ollama for text, Playwright against the Vercel Preview + Firebase QA backend, no GitHub writes, no Production, no real-player accounts.

```
 Browser (Agent Office page, 127.0.0.1:4873)
        │  GET /api/state, POST /api/tasks (same origin only)
 Agent Office server  src/observer/dashboard.ts + src/office/hub.ts  ── artifacts/office/tasks.json
        │  HTTP, loopback only
 Office bridge (:3100)  src/office/*  ── report text: Gemini (optional) → Ollama → deterministic
        │  spawns
 Runner CLI (src/cli.ts) ── Playwright ── Preview + Firebase QA
        │
 artifacts/runs/…  artifacts/reports/…  artifacts/office/metrics.json
```

Everything Big Bang Duel specific (agents, tools, contract, metrics) lives in `src/office/`. The office screen is the Agent Office page from the Claude Design canvas ("Live office"): the QA bullpen with a desk for each of the four agents, the roster, the selected-agent panel with the task form, current task and event log, then the task board, findings, evidence and runs. The page server (`src/observer/dashboard.ts`) keeps the task board in `src/office/hub.ts`: it forwards each task to the bridge, reads the bridge's event stream and stores the board in `artifacts/office/tasks.json`, so a reload or a second tab shows the same office. When the bridge does not answer, the page says `Bridge offline. Activity is unknown, not idle.` instead of showing idle agents.

**Layout editor.** `Edit layout` in the top bar opens the design's editor: tools Select (V), Move (M), Place (P), Erase (E), Rotate (R) and Recolor (C), a 10 × 8 tile grid, a ghost footprint that shows whether a spot is free, and a panel for the selected prop (which agent uses a desk, rotation, material, tile X and Y, remove). Arrow keys nudge the selected prop, Delete removes it, Ctrl+Z and Ctrl+Shift+Z undo and redo, Ctrl+S saves. Removing an agent's desk moves the agent to the nearest free desk. `Save layout` writes `artifacts/office/layout.json` (`POST /api/layout`, same-origin JSON, refused in read-only mode). The layout is visual only: it holds positions, rotation, material, desk numbers and the agent per desk, and the server keeps no other field. Rotation has two steps (0° and 90°), because the sprites are drawn from two sides only.

**Old AgentOffice UI.** `OFFICE_UI=agentoffice npm run office:start` still starts the AgentOffice server and UI on :5173 (needs `npm run office:setup`), patched by `office/agentoffice-qa.patch`. The patch dresses the AgentOffice HUD in the Agent Office design system: `office/theme/agent-office.css` (design tokens for four themes plus HUD classes) is generated from `src/theme/` by `npm run office:theme` and copied into the vendored UI by `npm run office:setup`; the patch links it and redraws the whole office in it. The Phaser map takes its floors, walls, furniture and labels from the theme tokens and shows pixel glyphs instead of emoji. Every panel (task board, activity log, chat, agent pulse, highlights, relationships, episode recap, showrunner, layout editor) uses the same HUD classes, with state shown as icon, word and colour and agent names in their identity colours. The secondary panels start collapsed in a dock under the task board. The brand card has a theme picker (Workshop, Outpost, Night, Light; kept per browser, reloads to repaint the map). The UI loads Pixelify Sans, Atkinson Hyperlegible and IBM Plex Mono from Google Fonts and falls back to system fonts offline. After pulling a new patch, delete `vendor/agent-office` and rerun `npm run office:setup`, since the setup only applies the patch to a clean checkout.

## Run it

```bash
npm install
npm run office:start     # bridge + Agent Office page, Ctrl+C stops both
```

Open `http://127.0.0.1:4873`, pick an agent in the roster or the room, type a task such as `Test the Missions screen` and press Assign. An agent takes one task at a time; the form stays disabled while it works. `npm run agent:dashboard` starts only the page (it shows the bridge as offline until `npm run office:bridge` runs). The old AgentOffice UI needs `npm run office:setup` once.

Prerequisites: the runner `.env` from the [README](../README.md) (without it every scenario task ends `blocked` with the list of missing variable names), and [Ollama](https://ollama.com) listening on `127.0.0.1:11434`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OFFICE_MODEL` | `llama3.2:latest` | Chat-capable Ollama model (the optional local fallback provider) |
| `OFFICE_VISION_MODEL` | unset | Vision model (for example `llama3.2-vision`). Only then does `design-critic` receive screenshots (max 4) |
| `OFFICE_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama base URL |
| `OFFICE_BRIDGE_PORT` | `3100` | Bridge port. AgentOffice reaches it through `QA_BRIDGE_URL` (default `http://127.0.0.1:3100`) |
| `OFFICE_READONLY` | unset | `true` starts the read-only portfolio mode (below) |

AgentOffice also calls `llama3.2:latest` for memory embeddings (hardcoded upstream). Without that model, memories are stored without embeddings.

## Report providers (Gemini, Ollama, deterministic)

The agents' report text comes from a provider chain: **Gemini** (optional) → **Ollama** (optional) → the **deterministic template**, which always runs last and is always appended as the evidence block. The model never chooses tools, params, selectors, browser actions or GitHub actions, and is not used for game decisions. It only writes the report text.

Setup, all in the ignored `duel-agent-office/.env` (names in `.env.example`, no value is ever committed):

```bash
npm install                  # adds the official @google/genai SDK
# in .env:
#   GEMINI_ENABLED=true
#   GEMINI_API_KEY=<your key from Google AI Studio>
#   GEMINI_MODEL=gemini-3.5-flash-lite
#   GEMINI_FALLBACK_MODELS=gemini-3.1-flash-lite
npm run office:start         # the bridge prints "Report providers: gemini -> ollama -> deterministic"
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_PROVIDER` | unset | `gemini`, `ollama` or `deterministic`. Unset: Gemini when enabled and keyed, else Ollama, else the template. A typo means `deterministic` (a remote provider is never switched on by accident) |
| `GEMINI_ENABLED` | `false` | Must be `true`, and `GEMINI_API_KEY` and `GEMINI_MODEL` must be set, or Gemini is skipped with a status |
| `GEMINI_API_KEY` | none | Server-side only. Not a `VITE_` variable, never sent to the browser or to `duelo/`; also withheld from the runner subprocess and AgentOffice's server and UI |
| `GEMINI_MODEL` | none (by design) | Primary model. Recommended: `gemini-3.5-flash-lite`. No default in code, because the models a project may use differ; check the AI Studio rate-limit page |
| `GEMINI_FALLBACK_MODELS` | none | Alternatives tried in order when the primary returns 429, quota exhausted, not found, a timeout or a 5xx. Limits are per model, so alternatives spare the primary's quota. Switch models any time by editing the two variables |
| `GEMINI_SEND_SCREENSHOTS` | `false` | `true` lets **design-critic** send screenshots to Gemini. With it off no image byte goes to Gemini: the provider makes no request at all for a screenshot review (tested). Only works while Gemini itself is active; a typo means off |
| `GEMINI_MAX_SCREENSHOTS` / `GEMINI_MAX_SCREENSHOT_BYTES` | `4` / `1500000` | Per review (1..8) and per image. Larger or invalid files are skipped. The same caps apply to the local vision model |
| `GEMINI_TIMEOUT_MS` / `GEMINI_MAX_OUTPUT_TOKENS` | `30000` / `1024` | Per request |
| `GEMINI_MAX_REQUESTS_PER_RUN` | `3` | Requests per analysed run, all models together. A retry counts |
| `GEMINI_MAX_REQUESTS_PER_DAY` | `20` | Requests per model per day, resetting at midnight Pacific like Google's quota. Counts live in `artifacts/office/provider-usage.json` (numbers and model names only) |
| `OFFICE_OLLAMA_ENABLED` | `true` | `false` takes Ollama out of the chain |

What a provider can see: an allowlisted summary (`buildSafeInput`): run id, scenario, status, duration, match outcome or screen results, the observer's already sanitized findings and repeated findings, counts, and screenshot **names**. It does not get console, network or event text, the task title, memories, `.env` values, URLs, e-mails, ids, room codes, traces, videos or screenshots. Free text is redacted again with the known secrets (including the Gemini key) and the observer's sanitizer, and a final check refuses to call any provider if an e-mail, URL, id- or token-like string, room-code-like text or a known secret is still in the payload (`guard-blocked`). Answers are checked the same way (`unsafe-response`). **Screenshots (design-critic only).** The other agents never receive an image. For design-critic:

- `GEMINI_SEND_SCREENSHOTS=false` (default) and no `OFFICE_VISION_MODEL`: no model call at all; the checklist is written at once.
- `OFFICE_VISION_MODEL` set (local Ollama vision model): the screenshots go to that model only. Nothing leaves the machine and no flag is needed. It is also the fallback when Gemini fails.
- `GEMINI_SEND_SCREENSHOTS=true` (with Gemini active): Gemini receives the screenshots as inline PNG data in the same request, then Ollama vision if Gemini fails.

Which files: only the observer-approved ones (referenced by the run's events or summary, `alpha|bravo/NN-name.png`), never the first one (loading splash / login form), spread evenly over the run and capped at `GEMINI_MAX_SCREENSHOTS`. Each file is checked again: regular file (no symlink), not empty, within `GEMINI_MAX_SCREENSHOT_BYTES`, and really a PNG. An image request counts in the per-run and per-day budgets like any other. The report's last line says how many screenshots were sent and to which provider; bytes never appear in events, reports, budget files or logs.

**What is and is not redacted in a screenshot.** Redaction of pixels does not exist. The runner masks only elements whose text contains an e-mail address (`PlayerSession.screenshot`). Everything else is raw pixels: display names and player codes of the QA accounts, balances, avatars. Login-form and room-code screens are not captured by design (steps are placed before credentials are typed, failure screenshots skip the login, join-code and waiting-room surfaces), and the page-only capture shows no browser address bar. Enabling the flag therefore sends real screenshots of a QA test account to Google. Keep QA accounts free of real personal data, and leave the flag off otherwise.

The answer must be JSON that matches a schema (verdict, summary, findings, repeated problems, next steps) and is validated at runtime; `src/office/provider/report.ts` renders the Markdown from it, so model text is never written as-is. Anything else is `malformed-response` and falls back.

Errors never stop a task. Each provider attempt ends in one fixed status, shown in the event feed and on the `Report provider:` line at the end of the report: `ok`, `disabled`, `no-api-key`, `model-not-configured`, `guard-blocked`, `budget-run`, `budget-daily`, `timeout` (one retry), `auth` (401/403, or an invalid key; not retried, other models are not tried), `rate-limit` and `quota-exhausted` (429, not retried on the same model), `model-not-found` (404), `unavailable` (5xx, one retry), `malformed-response`, `unsafe-response`, `error`. Prompts, responses, raw findings and the key are never logged, and provider error text is not stored. The key is in the redaction list, so it cannot appear in a report.

Free-tier and model availability change; the numbers that apply to your project are on the AI Studio rate-limit page. The local budgets are a guard rail below them, not a copy of them.

**Ollama unavailable or model missing:** the report is built by a deterministic template from the same artifacts, the event feed says so and `usedFallback` is `true`. Tasks still complete.

## Agents and tools

| Agent | Playbook (fixed in code, not chosen by the model) |
| --- | --- |
| `player-alpha` | `run_playwright_scenario(private-match-full-game)` → `read_artifacts` → report |
| `explorer` | `run_playwright_scenario(explore-screens)` → `read_artifacts` → report |
| `qa-analyst` | `read_artifacts(runId from the task title, else latest)` → report led by the observer's verdict and findings |
| `design-critic` | `read_artifacts` → screenshots (vision model only) → UI/UX report |

The model only writes the report text. It never picks tools or params, so a small local model cannot start the wrong scenario, and text inside artifacts (console messages, page text) cannot steer it: it is passed as labelled untrusted data and the model has no tool access.

`explore-screens` (new scenario): Alpha logs in and opens menu, missions, shop, profile, leaderboard, characters, friends, match history and achievements by URL, one screenshot each (text containing an e-mail address is masked). A screen that redirects or shows an alert is recorded in `summary.json` as `ok: false`; the run still completes. After each navigation it waits for the "Carregando…" splash to disappear and gives the network at most 1.5 s to settle (the app keeps Firestore long-poll requests open, so waiting for network idle used to cost 8 s per screen). A screen is also flagged `raw-translation-keys` when its visible text holds whole words shaped like an untranslated i18n key (`tabs.daily`, `missions:tabs.daily`, shown uppercased by the UI as `TABS.DAILY`); the keys (at most 5) are listed in the report, nothing else of the page text is kept. Host names, file names, versions and prices are not keys. "ok" still only means "no redirect, no alert, no raw keys": nothing else on the page is judged. The battle screen is covered by `private-match-full-game` (a solo-bot battle entry has no verified selectors yet).

### Tools (`src/office/tools.ts`)

| Tool | Params | Returns |
| --- | --- | --- |
| `run_playwright_scenario` | `{ scenario: "private-match-full-game" \| "explore-screens", headless?: boolean }` | `{ runId?, status, reason?, artifactPaths[] }` (paths relative to `artifacts/`) |
| `read_artifacts` | `{ runId }` or `"latest"` | `{ runId, summary, events[], console[], networkFailures[], totals, findings \| null, findingsNote?, screenshots[] }`, last 50 lines per JSONL (`totals` has the full line counts), all redacted |
| `write_report` | `{ agentId, content }` | `{ reportPath }`, saved as `artifacts/reports/<agentId>-<timestamp>.md`, never overwrites |

Deviation from the issue: `run_playwright_scenario` does **not** accept `qaCredentials` or `config`. A tool param passes through the model context and agent memory, so credentials would leak into logs. Passing either key is rejected. The runner reads its own ignored `.env`. Scenarios never run in parallel (same two QA accounts).

`read_artifacts` opens only `summary.json`, `events.jsonl`, `console.jsonl`, `network-failures.jsonl` and `findings.json`. When `findings.json` is missing it first runs the local observer from issue #96 (`src/observer`, deterministic, no model, writes `<run>/findings.json` only) and then returns the validated report; `findingsNote` says why `findings` is `null` (`invalid`, `unsupported-version`, `observer-failed`). `screenshots` are the ones the observer approves: referenced by the run's events or summary, sane name and size. It never touches `.env`, `trace.zip`, `video/` or anything else, rejects run ids that are not `<ISO timestamp>-<scenario>`, and runs every string through `redact` again. Run ids are kept as they are: they are public identifiers that only look like tokens.

## Metrics and memory

- `artifacts/office/metrics.json`: per agent `tasksCompleted`, `tasksBlocked`, `tokensUsed` (provider prompt + completion), `reputation`. Reputation starts at 0.5, +0.05 per completed task, −0.05 per blocked one, clamped to 0..1. The task board footer and the Agent Pulse panel show it.
- A task is `completed` when the agent finished its playbook (a run that *failed* is a finding, written up in the report). It is `blocked` when it could not: invalid config, no run to analyse, runner refused (target guard, missing precondition), bridge down.
- AgentOffice persists each finished task as a memory in SQLite (`packages/server/data/office-memory.db` inside `vendor/`, with embeddings when the embedding model exists). The five highest-importance memories are sent with the next task as untrusted notes.

## Integration contracts (to replace AgentOffice later)

Bridge, `http://127.0.0.1:3100`, loopback only. Requests must carry `Host: 127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding guard) and `POST` needs `Content-Type: application/json` (cross-site form guard).

| Endpoint | Purpose |
| --- | --- |
| `GET /agents` | `[{ id, name, role, tools[], metrics, busy }]` |
| `GET /metrics` | `{ [agentId]: AgentMetrics }` |
| `POST /tasks` | Body `OfficeTask`. Streams the event feed as NDJSON. `409` if the agent is busy, `400` invalid, `415` wrong content type |

Types are in `src/office/contract.ts`:

- **Agent contract:** input `OfficeTask { taskId, agentId, title (≤200), memories?[] }` → output `TaskOutcome { status: "completed" | "blocked", summary, runId?, reportPath?, tokensUsed, usedFallback, metrics }`, delivered as the `result` field of the last event.
- **Event feed (SystemLog):** one JSON object per line, `OfficeEvent { at, taskId, agentId, status: "idle" | "working" | "blocked" | "completed", activity, tool?, result? }`. `activity` is redacted and capped at 300 characters. The first event of a task is `working` ("Claimed task"), the last carries `result`.
- **Tool interface:** `ToolResult<T> { ok, data?, error? }`, specs with JSON Schema in `TOOL_SPECS`, dispatch by name in `callTool`.

### Add an agent

1. Add its id to `OFFICE_AGENT_IDS` (`contract.ts`) and an entry in `AGENTS` (`agents.ts`: name, role, system prompt, allowed tools). If its playbook differs, add a branch in `runTask`.
2. In the patch target (`OfficeRoom.ts`): add it to `QA_AGENTS` and a `<id>-desk` entry in `furnitureTargets`; add an `<option>` in `TaskBoard.tsx`. Regenerate the patch (below).
3. Add a test next to the existing ones in `tests/office.test.ts` (the `it.each(OFFICE_AGENT_IDS)` case covers the generic path).

### Add a tool

Add the name to `TOOL_NAMES`, a spec to `TOOL_SPECS`, a function and a `callTool` case in `tools.ts`, then call it from the playbook in `runTask`. Validate every param and redact every returned string.

### Add a task type

A task type is a playbook plus, for a browser run, a scenario: write `src/scenarios/<name>.ts` (see `exploreScreens.ts`), register it in `src/cli.ts` and in `SCENARIOS` (`tools.ts`), then reference it from the playbook.

### Regenerate the AgentOffice patch

```bash
cd vendor/agent-office && git diff > ../../office/agentoffice-qa.patch
```

## What the patch changes in AgentOffice

Audited at commit `58f11f9`. Upstream is a simulation: agents wander, chat and call tools by free-form model JSON, tasks are one string per agent (`assign-task` only sets `currentTask`, a task never completes), the task board dropdown lists two hardcoded demo agents, and the Inspector panel is a static stub showing fake data. The patch:

- replaces the two demo agents with the four QA agents (the free-form think loop never runs for them);
- `assign-task` validates the agent, queues the task per agent and runs it through the bridge; task rows go `pending → in_progress → completed | blocked` (new `MemoryStore.setTaskStatus`) and the board shows blocked in red;
- feeds the bridge event stream into the agent's state (SystemLog and thought bubbles), the chat, the highlight feed and persistent memory; reputation comes from real metrics instead of random jitter;
- adds the metrics lines to the task board and removes the fake Inspector;
- adds `OFFICE_READONLY` (below).

Upstream built-ins (`code_execute`, `web_search`, `hire_agent`, `read_file`) are unreachable: they run only from the think loop, which QA agents do not use. `code_execute` in particular runs model-written JavaScript with full file and network access, which is why it must stay that way.

AgentOffice is MIT licensed (© its authors, `vendor/agent-office/LICENSE` is kept in the clone). `vendor/` is git-ignored, so this repository ships only the patch and the pinned commit in `scripts/setup-agent-office.mjs`.

## Public / portfolio view

Anyone who can reach the room can assign tasks, and a task can start a real browser run against the Preview with the QA accounts. So a shared view must be read-only:

```bash
OFFICE_READONLY=true npm run office:start     # PowerShell: $env:OFFICE_READONLY="true"; npm run office:start
```

With the Agent Office page, read-only mode refuses `POST /api/tasks` (403) and the page disables the task form. The page binds to loopback only and shows run ids and approved screenshots, so it is not meant to be shared through a tunnel. With the old AgentOffice UI, read-only mode makes the server ignore `assign-task`, `chat`, `command`, `start-scenario`, `trigger-chaos` and `save-layout`, answers `/api/vote-chaos` with 403, and the UI hides the task form. The bridge stays on loopback and is never exposed.

What the viewer sees: agent names, thoughts, redacted event text, task titles, counters. It never sees screenshots, artifact paths, run ids, URLs, credentials, room codes or e-mail addresses: bridge events are redacted before they leave the bridge, and the UI has no screenshot or file viewer. Task titles are typed by Hugo, so keep them free of secrets.

Verified: localhost, read-only flag, the 403, the ignored messages. **Not verified:** a tunnel. The UI reads the room from `ws://<hostname>:3000` (or `?ws=wss://…`, saved in `localStorage` under `agent-office:ws-url`), so a tunnel needs both the UI and port 3000, and Vite's dev server may reject unknown hostnames (`server.allowedHosts`). Until that is tried, a screen recording of the localhost view is the safe portfolio artifact.

## Known limits

- Real runs against the Preview were done by Hugo through the office (private match: draw after 8 turns each; screen tour: 9 screens, no console or network problems). The code in this document written afterwards (observer findings in the analyst report, faster explorer wait) is covered by unit tests and a check of the analyst on the real private-match run (no findings, 6 cancelled requests ignored); the explorer's new wait was not re-run against the Preview.
- Phaser (WebGL) did not start inside the Claude desktop browser pane (`Framebuffer status: Incomplete Attachment`), so the visual office was not checked there. The room, task flow and read-only mode were verified with a Colyseus client against the live server. Check the UI in a normal browser.
- The installed Ollama model during development (`glm-4.7-flash`) answers "does not support chat", which exercised the fallback path. The model-written path is covered with a scripted model only; try `OFFICE_MODEL=llama3.2:latest` after `ollama pull llama3.2`.
- Findings are the observer's job (issue #96). If it cannot run, the analyst groups the raw console and network records itself and counts `net::ERR_ABORTED` apart, as the observer does by default. The dependency points one way (office uses observer and runner, never the reverse): `tests/observerDashboard.test.ts` keeps runner modules free of observer and server code and of imports from `src/office/`; only `src/office/` and `officeCli.ts` are exempt from it.
- Relationship graph, chaos buttons and scenarios are upstream demo features and show simulated drama, not QA data.

## MVP: configurable agents, reports, stop, read-only repositories (docs/vision.md)

All of this lives on the Agent Office page (`npm run office:start`, port 4873) and in the bridge. State is kept in `artifacts/office/` (git-ignored): `agent-config.json`, `usage.json`, `connections.json`, `runner-pids.json`.

- **Edit agent.** Select an agent, then the *Edit agent* tab: objective, skill, daily quota (tasks and tokens, 0 = no limit), scope (the explorer's screens, plus a free-text focus). Saved settings apply to the next task. Objective and skill reach the report writer as guidance only; they cannot change tools, scenarios, URLs or safety rules. A task refused by the quota does not touch the agent's record and does not start the runner. `POST /api/agent-config`.
- **Commands.** Each agent has a closed list (`run`, `analyze-latest`, `plan`). A command with no text runs the configured objective. The free-text task box stays as *Custom task*. The free chat that asks Gemini to interpret a message (vision.md) is not part of this MVP.
- **Reports by date.** The *Reports* section groups `artifacts/reports/` by day and filters by agent, severity, task and date. A `<report>.meta.json` beside each new report keeps the task, objective and run; older reports still list, without a task. Interrupted tasks leave a short report marked as interrupted. `GET /api/reports`, `GET /api/report`.
- **Stop.** *Stop round* kills the runner and the browsers it started (process group on POSIX, `taskkill /T /F` on Windows) and marks the task blocked with "Stopped by the user". *Clean up stuck runners* stops runner processes this office recorded in `runner-pids.json` and that are still alive after a restart, but only when the process command line still contains `src/cli.ts`; any other process, including another Playwright on the machine, is never touched. Browsers whose runner already died are not found by this (no parent to follow); close those by hand. `POST /api/stop`, `POST /api/cleanup`.
- **Alpha and Bravo are two agents**, each with its own command, objective, quota and report (only its own findings, events and outcome). The runner still needs both accounts in one room, so the two share a single round: commanding the second while the first runs joins that round, and stopping either stops both. Commanding one alone runs the whole match and reports only its side.
- **Connections (read-only).** Local checkouts and GitHub repositories by `owner/name`. Operations: summary (branch, commits, open PRs and issues), list files, read one text file. Files like `.env*`, keys and `node_modules` are never listed or read; symlinks leaving the folder are refused; GitHub is reached with GET only. `GITHUB_TOKEN` in the environment of the office is optional (private repositories, rate limit) and is never returned, logged or passed to the runner. Writing to GitHub stays out of the MVP and needs the human approval flow.
- **Test Planner.** Reads the source marked *Game's code* and writes a Markdown plan: routes, files matching the task, `data-testid` and labels, environment variable names (never values), the runner's preconditions, which scenario fits and what is not covered. It is deterministic: no model, no tokens.

### Investigation tasks (QA Analyst)

A task such as "understand why both players draw" is answered by an **Investigation** section placed before the report text: the question, hypotheses each marked confirmed, refuted or not verified with cited evidence, and a conclusion. It reads the run's full `events.jsonl` (every turn each player played), `summary.json` and, when a game source is connected under Connections, the game's rules (read-only, e.g. `gameEngine.ts:LINE`). It is deterministic, so no run data is sent to a model for it. A question without a specialised investigator lists the facts and says no cause is claimed. Alpha plays aggressively and Bravo defensively (`PlayStyle` in `skills/player/playTurn.ts`): two identical policies played mirrored cards and drew.
