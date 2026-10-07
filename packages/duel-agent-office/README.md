# duel-agent-office

Local, deterministic QA runner for Big Bang Duel (issue #94, part of #93). The runner itself stays deterministic; the optional agent office (issue #98) sits on top of it in `src/office/` and uses a local Ollama model only to write report text. It opens two isolated Playwright browser sessions (`player-alpha`, `player-bravo`), logs two QA accounts in through the visible UI, plays a private match and collects evidence. No LLM in the runner, no GitHub, no Firebase SDK, no scheduler.

## Safety rules

- Targets only a Vercel Preview URL from `GAME_BASE_URL` (Firebase QA backend). The runner rejects an empty or malformed value, any `hugoviegas.dev` host, Production-looking hosts (`prod`, `production`, `live`, `www`), non-HTTPS, URLs with credentials, and anything not `*.vercel.app`. The check runs in the config loader, before any browser is launched. Each page is re-checked against the configured origin after navigation and login.
- Visible browser UI only. No Firebase/Firestore/RTDB calls, no Admin SDK, no hidden app state, no injected JavaScript, no network payloads used for decisions, no forced clicks.
- Secrets live only in the local ignored `.env`. Events, summary, console and network records are redacted (known secret values, query strings, token-like strings, e-mail addresses, the Preview origin).
- Public Quick Match, public rooms and interaction with real players are out of scope. The runner refuses to create a room if the public switch is not visibly off.
- The runner never changes `duelo/`.
- Vercel Deployment Protection: the runner does not bypass it, holds no bypass credential and never calls the Vercel API for runs. Reaching the Preview is a manual Vercel setting owned by Hugo.

## Setup

```bash
cd duel-agent-office
npm install
npx playwright install chromium
cp .env.example .env   # then fill in locally; .env is ignored by Git
```

Environment variable names (see `.env.example`): `GAME_BASE_URL`, `QA_ALPHA_EMAIL`, `QA_ALPHA_PASSWORD`, `QA_BRAVO_EMAIL`, `QA_BRAVO_PASSWORD`, `QA_DEV_LOGIN_ENABLED`, `QA_DEV_LOGIN_SECRET`, `QA_ALPHA_DEV_LOGIN_NAME`, `QA_BRAVO_DEV_LOGIN_NAME`, `QA_HEADLESS`, `QA_SCREENSHOT_ON_STEP`, `QA_SCENARIO_TIMEOUT_MS`, `QA_TRACE_ENABLED`, `QA_VIDEO_ENABLED`, `QA_ARTIFACT_MAX_BYTES`, `QA_ARTIFACT_KEEP_RECENT_RUNS`, `QA_ARTIFACT_KEEP_FAILURE_RUNS`.

Update `GAME_BASE_URL` after every new Preview deployment, by hand or with `npm run agent:sync-preview`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run agent:private-match` | Runs `private-match-full-game` using `QA_HEADLESS` (default headed) |
| `npm run agent:private-match:headed` | Forces headed: two windows side by side |
| `npm run agent:private-match:headless` | Forces headless |
| `npm run agent:explore` | Runs `explore-screens`: Alpha opens every non-battle screen once and takes a screenshot of each (e-mail text masked) |
| `npm run office:setup` / `office:start` / `office:bridge` | Local QA agent office on AgentOffice (issue #98). Reports can be written by Gemini (optional, `GEMINI_*` variables in `.env.example`), then Ollama, then a deterministic template; see [docs/agent-office.md](docs/agent-office.md) |
| `npm run agent:sync-preview` | Updates only `GAME_BASE_URL` in the ignored `.env` from the local Vercel CLI (see below) |
| `npm run agent:cleanup-artifacts` | Local, explicit artifact retention (see below). `-- --dry-run` changes nothing |
| `npm run agent:observe` | Local QA observer: scans run artifacts and writes `findings.json` (see "QA observer"). `-- --run <name-or-dir>`, `-- --dry-run`, `-- --report-aborted` |
| `npm run agent:dashboard` | Explicit, local-only dashboard on `127.0.0.1` (see "QA observer"). Never started by a run |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest (unit tests plus a real-Chromium test against a local markup replica of the battle UI; that one is skipped when no Chromium is installed) |

Exit codes: `0` completed, `1` failed, `2` blocked, `64` invalid configuration.

## Preview URL helper: `npm run agent:sync-preview`

Deliberately narrow:

- Runs the local Vercel CLI (`vercel ls --environment preview --status READY --format json`) from the project folder that holds `.vercel/project.json` (`duelo/` or the repo root). It needs the CLI installed and logged in; it never deploys and never changes Vercel or Firebase settings.
- Picks the newest READY Preview deployment. `-- --branch <name>` narrows it to one Git branch. It fails instead of guessing when nothing usable is found, the newest two are indistinguishable, the output is unparsable, or the project is not linked.
- Validates the result with the same rule as the runner (HTTPS, `*.vercel.app`, not Production-looking).
- Writes only the `GAME_BASE_URL` line of `duel-agent-office/.env`, and only if Git ignores that file. Other lines are untouched.
- Never prints the URL. On any failure it prints one line telling you to set `GAME_BASE_URL` manually.
- The JSON shape of the CLI output was handled tolerantly but not exercised against the real CLI in CI; the first real use is the validation.

## Login modes

- **Email/Password (default).** Fields `Email` and `Senha`, button `Entrar`.
- **Dev Login (`QA_DEV_LOGIN_ENABLED=true`).** Uses the Preview-only panel mounted by `LoginScreen` (`DevLoginPanel.tsx`): types the secret in `Segredo do dev login`, clicks `Carregar contas`, then `Entrar como <display name>`. Account display names come from `QA_ALPHA_DEV_LOGIN_NAME` / `QA_BRAVO_DEV_LOGIN_NAME`. Requires the Preview to set `VITE_ENABLE_DEV_LOGIN=true`. It replaces Email/Password while the flag is on.

## Scenario `private-match-full-game` (private room-code flow)

Entry point: the existing private room-code flow of the online lobby. Public Quick Match, public rooms and the friend challenge are not used.

1. Alpha and Bravo log in (own browser instance, context and storage).
2. Alpha opens `/online`, stays on the `Criar` tab, checks that the `Sala pública` switch is visibly off (never toggles it) and clicks `Criar sala`.
3. Alpha's waiting room (`Aguardando forasteiro`) shows the room code. The runner reads it from the displayed text.
4. Bravo opens `/online`, opens the `Entrar` tab, types the code into `Código da sala` and clicks `Entrar na sala`.
5. Both must show the hand (`Sua mão`) with the waiting room gone: same battle.
6. Both play every turn through the battle interaction contract below until the game-over dialog (win, loss, draw) or the scenario timeout.

Safe stops:

- Public switch not visibly off: `blocked` (`target-guard`), no room created.
- Lobby refuses to create a room (for example Alpha still has an active room from an earlier run): `blocked` (`missing-precondition`). The runner cannot clear it without database access; finish or leave that room in the UI, then rerun.
- Any selector that cannot be found, a rejected code, a displayed code that is not 6 characters, a battle interaction failure, or the timeout: `failed` with a redacted reason.
- After a failed run, Alpha cancels its waiting room through the visible `Cancelar e voltar ao menu` button (best effort), so the next run is not blocked by a stale room.

The room code is sensitive runtime data. It lives only in memory, is added to the redaction list as soon as it is read (events, summary, console and network records), is never hardcoded or written to the summary, and no step screenshot is taken while it is displayed or typed.

### Battle interaction contract

Why the first real run did not select and confirm cards reliably (found by auditing `duelo`, not by reading app state at runtime):

- The text `Escolha sua carta` only renders when no card is selected and the info mode is not the default one (`Hand.tsx`). In the default mode the hint reads `Toque numa carta...`, so that text is not a turn signal and is no longer used.
- `aria-disabled` on a card reflects ammo, remaining uses and the dodge streak only. A click outside the selecting phase is silently ignored by the game, so selection must be verified, not assumed.
- `Confirmar` stays on screen after an online submit until both players have chosen, so "advanced" cannot mean only "Confirmar disappeared".

Each turn (`src/skills/player/battleInteraction.ts`, Playwright side in `playwrightBattleView.ts`):

1. Wait for an actionable turn: no game-over, no blocking dialog, no result reveal on screen, no card still selected from the previous turn, the hand visible with at least one enabled card, and the turn timer (`role=timer`, rendered only while a card can be chosen) visible. If the timer never shows, the runner tries after a short grace period and relies on step 2.
2. Choose from visible own-hand data (policy below), click the card with a normal click (never forced), then verify `aria-pressed="true"` on that card. Up to 3 attempts.
3. Wait for `Confirmar` to be visible, then enabled, then click it with a normal click.
4. Verify visible advancement within 25 s: result reveal on screen, game-over, `Confirmar` gone, or the turn timer gone.
5. A dialog on screen for more than 4 s, or a click refused because another layer intercepts it, is classified as an overlay. Nothing is forced or worked around.

Failure categories (written to `summary.json` as `failure: { category, agent }`, and in the `reason` of the failed events; no card names, codes, e-mails, URLs or selectors):

| Category | Meaning |
| --- | --- |
| `card-not-visible` | The hand never became visible (or the card to click is not visible) |
| `no-playable-card` | The hand is visible but every card stays disabled |
| `card-not-enabled` | The chosen card refused a normal click for a reason other than an overlay |
| `battle-overlay-blocked` | A dialog stays on screen, or another layer intercepts the click |
| `card-selection-not-confirmed` | After 3 clicks no card shows as selected |
| `confirm-not-visible` | `Confirmar` never appeared after a card was selected |
| `confirm-not-enabled` | `Confirmar` is on screen but stays disabled, or refuses a click |
| `confirm-did-not-advance` | After `Confirmar` nothing on screen showed the turn moving on |
| `turn-state-timeout` | The next turn never became actionable (or the scenario deadline passed) |

Failure screenshot: one per player, taken only when the screen cannot show a typed e-mail or a room code. It is skipped (and the event says so) while the login form, the Dev Login secret field, the join-code field or the waiting room is on screen. Battle screens are captured.

### Decision policy: visible state only

`src/skills/player/playTurn.ts` decides from three visible inputs: the own hand (card accessible name, `aria-disabled`, `aria-pressed`), and the two HUD ammo indicators (`N de M balas`, own side first; absent for the opponent when ammo is hidden).

Rules audited in `duelo` (read as reference only, never at runtime):

| Source | Rule | Visible value that supports it |
| --- | --- | --- |
| `lib/gameEngine.ts` `getAvailableCards`, `lib/cards.ts` | `Tiro` and `Contra-golpe` need 1 ammo, `Tiro Duplo` needs 2 ammo and a remaining use (2 per match), `Desvio` is blocked after 3 in a row, `Recarga` is always available | Card `aria-disabled` plus the reason in its accessible name |
| `lib/gameModes.ts` | Custom rooms: `Simples` (3 cards, 3 lives) or `Clássico` (5 cards, 4 lives), max ammo 3, ammo starts at 0 | The cards present in the hand, the ammo label |
| `lib/botAI.ts` | Turn 1 always reloads | Own ammo 0 disables the ammo cards, so `Recarga` is the only offense-free play |
| `lib/botAI.ts` | At full ammo never reload | Own ammo label equals max |
| `lib/botAI.ts` | Opponent with 0 ammo cannot attack: `Desvio` and `Contra-golpe` are wasted | Opponent ammo label is 0 |
| `features/tutorial/tutorialScript.ts` | Teaches the same card set and costs; the tutorial runs a scripted opponent | Nothing needed beyond the rows above |

Resulting policy: never play a wasteful card when another one is playable (reload at full ammo, defense against an opponent with 0 ammo); at full ammo prefer `Tiro Duplo`, then `Tiro`; when empty while the opponent has ammo, prefer `Desvio`; otherwise `Tiro`, `Tiro Duplo`, `Recarga`, `Desvio`, `Contra-golpe`. Hidden opponent ammo counts as "can attack".

Intentionally not used because the runner cannot see it: the opponent's chosen card, the opponent's move history and the bot's pattern or persona models (`botAI.ts` Q-tables, `estimateOpponentAmmo`), class abilities and their trigger rolls, shield counters, strategy files in `public/`, the Zustand store, RTDB room data and any network response.

### Future scenario: friend challenge

A friend-challenge scenario (send and accept a challenge between two friends) is planned, not part of this scenario. It depends on issue #30; on `main` "Convidar" in `FriendsScreen` only navigates to the lobby, so no challenge UI or selector exists yet. It will be added as its own scenario once #30 is merged and its selectors are verified.

## Event statuses

`idle`, `planning`, `working`, `waiting`, `reviewing`, `blocked`, `completed`, `failed`. Each JSONL event: `at`, `runId`, `agent` (`runner`, `player-alpha`, `player-bravo`), `status`, `activity`, `scenario`, optional relative `artifactPath`.

## Artifacts, sensitivity and retention

```
artifacts/runs/<ISO_TIMESTAMP>-private-match-full-game/
  events.jsonl  summary.json  console.jsonl  network-failures.jsonl
  alpha/   screenshots, trace.zip (QA_TRACE_ENABLED=true), video/ (QA_VIDEO_ENABLED=true)
  bravo/   same
```

**Traces and videos are local sensitive artifacts.** They can contain the Preview URL, session tokens, room codes and typed e-mail addresses. The runner does not redact them and nothing here claims they are redacted. Never commit them, publish them, attach them to GitHub issues, send them to an LLM, or expose them in the future public office. They are also large (a trace was about 158 MB per player for one run), so both are **off by default**:

- `QA_TRACE_ENABLED=false`: a trace is started (after login, so typed credentials stay out of it) and saved only when this is `true`.
- `QA_VIDEO_ENABLED=false`: videos are recorded only when this is `true`; a video can show the e-mail being typed.

Step screenshots are taken before credentials are typed and never while the room code is shown or typed. `summary.json`, `events.jsonl`, `console.jsonl` and `network-failures.jsonl` are the redacted evidence.

### `npm run agent:cleanup-artifacts`

Explicit and local; nothing runs it automatically. It reads sizes, each run's `summary.json` status and file times, never the contents of traces, videos or screenshots. Settings (names only in `.env.example`; defaults shown):

| Variable | Default | Meaning |
| --- | --- | --- |
| `QA_ARTIFACT_MAX_BYTES` | `2147483648` (2 GiB) | Budget for `artifacts/` |
| `QA_ARTIFACT_KEEP_RECENT_RUNS` | `20` | Newest runs that are never touched |
| `QA_ARTIFACT_KEEP_FAILURE_RUNS` | `10` | Newest failed/blocked runs whose directories are never deleted |

When the total is above the budget, it stops as soon as it fits:

1. Delete `trace.zip` and `video/` from runs outside the newest `QA_ARTIFACT_KEEP_RECENT_RUNS`, oldest first. Failed/blocked runs keep their summary, events and screenshots.
2. Delete whole run directories, oldest first: successful runs first, then other runs beyond the protected sets.
3. Never deleted: the newest recent runs, the newest failed/blocked runs, and any active run (no `summary.json` and activity in the last hour). A stale run without a summary is treated as a crashed (failed) run.
4. If only protected runs remain and the total is still above the budget, it says so and stops.

It prints counts and byte totals only, never run names or paths. `-- --dry-run` shows the same numbers without deleting. Existing oversized artifacts are left for Hugo to delete locally; this change never reads or uploads them.

## Selector inventory

Verified by reading the source on `main` (PT-BR source locale; the runner forces locale `pt-BR`). The battle selectors are also exercised against a local markup replica of the battle UI in real Chromium (`tests/battleView.integration.test.ts`); nothing has been run against a live Preview by this change.

| Purpose | Selector | Source |
| --- | --- | --- |
| E-mail field | label `Email` | `duelo/src/components/auth/LoginScreen.tsx` |
| Password field | label `Senha` | `LoginScreen.tsx` |
| Login submit | button `Entrar` (exact) | `LoginScreen.tsx` |
| Login error | `role=alert` | `LoginScreen.tsx` |
| Dev Login secret | label `Segredo do dev login` | `duelo/src/features/devLogin/DevLoginPanel.tsx` |
| Dev Login load / sign in | buttons `Carregar contas`, `Entrar como <name>` | `DevLoginPanel.tsx` |
| Post-login route | URL `/menu` | `DevLoginPanel.tsx`, `App.tsx` |
| Lobby route | `/online` | `App.tsx` |
| Lobby tabs | tabs `Criar`, `Entrar` (exact); panels `#lobby-panel-create`, `#lobby-panel-join` | `duelo/src/features/lobby/OnlineLobby.tsx`, `duelo/src/ui/Tabs.tsx` |
| Public room switch | switch `Sala pública`, `aria-checked="false"` by default (read only) | `OnlineLobby.tsx`, `duelo/src/ui/Switch.tsx` |
| Create room | button `Criar sala` | `OnlineLobby.tsx` |
| Lobby error | `role=alert` inside the active panel | `OnlineLobby.tsx` (`InlineError`) |
| Waiting room | heading `Aguardando forasteiro` | `duelo/src/features/battle/WaitingRoomOverlay.tsx`, `duelo/src/components/game/GameArena.tsx` |
| Displayed room code | the `<span>` right after the label text `Código da sala` | `WaitingRoomOverlay.tsx` |
| Join code input / submit | label `Código da sala`; button `Entrar na sala` | `OnlineLobby.tsx` |
| Cancel waiting room | button `Cancelar e voltar ao menu` | `WaitingRoomOverlay.tsx` |
| Hand | region `Sua mão` | `duelo/src/features/battle/Hand.tsx` |
| Card buttons | `button[aria-pressed]` inside the hand; name `<label>, <cost>[, <reason>]`; `aria-pressed="true"` selected; `aria-disabled="true"` not playable | `BattleCard.tsx` |
| Confirm card | button `Confirmar` (also exists in the compact tools row; the hidden info bar is `aria-hidden`) | `Hand.tsx` |
| Ammo | `role=img`, name `N de M balas`, own side first | `duelo/src/features/battle/BattleHud.tsx` |
| Turn timer | `role=timer`, name `N segundos para escolher`, only while a card can be chosen | `BattleHud.tsx` |
| Turn result reveal | `role=status`, name `Turno N: ...` | `duelo/src/features/battle/TurnResultOverlay.tsx` |
| Blocking dialog | `[role="dialog"]` that does not contain the game-over title | `duelo/src/ui/Dialog.tsx` |
| Game over | `#game-over-title` = `Vitória!` / `Derrota!` / `Empate!` | `GameOverScreen.tsx`, `pt-BR/battle.json` |

Not used any more: the text `Escolha sua carta` (see the interaction contract).

Unverified (not guessed):

| Purpose | Reason |
| --- | --- |
| Explicit room-failure banner | No dedicated element found; a failed room ends via the scenario timeout |
| Any first-run overlay (for example a tutorial) on the QA accounts | Only modal `[role="dialog"]` layers are detected; anything else that intercepts a click is reported as `battle-overlay-blocked` |
| Friend challenge send / accept | Future scenario, see above (issue #30 open) |
| Result reveal auto-advance timing | Source says 5 s (`RESULT_PHASE_MS`); the runner just waits for it and never clicks the skip control |

The room code is generated by `Math.random().toString(36).substring(2, 8)`, so very rarely it has fewer than 6 characters and the join form cannot take it; the run then fails with a clear message and can be rerun.

## QA observer and findings engine (issue #96)

Local, deterministic, read-only review of the redacted run artifacts. No LLM, no Firebase, Vercel or GitHub, no scheduler, no public dashboard, no automatic issue creation. Findings are **observations, not confirmed bugs**.

```bash
npm run agent:observe                      # every run under artifacts/runs -> artifacts/findings.json
npm run agent:observe -- --run <run-name>  # one run (a bare name, or a path) -> <run>/findings.json
npm run agent:observe -- --dry-run         # compute and print aggregate counts, write nothing
npm run agent:observe -- --report-aborted  # also report net::ERR_ABORTED (off by default)
npm run agent:dashboard                    # http://127.0.0.1:4873/ until Ctrl+C
```

The command prints aggregate counts only (never run names, paths or messages). It does not load `.env`; it reads only the `QA_OBSERVER_*` variables from the process environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `QA_OBSERVER_ARTIFACTS_DIR` | `duel-agent-office/artifacts` | Artifact root (contains `runs/`) |
| `QA_OBSERVER_FINDINGS_FILE` | one run: `<run>/findings.json`; root: `<artifacts>/findings.json` | Output `.json`. Refuses runner input names, env/trace-like names and any existing file that is not an observer findings file |
| `QA_OBSERVER_IGNORE_NETWORK` | empty | Extra comma-separated substrings of a failed-request error text to count instead of report |
| `QA_OBSERVER_REPORT_ABORTED` | `false` | `true` reports `net::ERR_ABORTED` (same as `--report-aborted`) |
| `QA_OBSERVER_SCREENSHOT_LIMIT` | `12` | Max approved screenshots per run on the dashboard (0 to 50) |
| `QA_OBSERVER_HOST` | `127.0.0.1` | Loopback only: `127.0.0.1`, `localhost` or `::1`; anything else is a config error |
| `QA_OBSERVER_PORT` | `4873` | Dashboard port (0 picks a free one) |

### Verified artifact contract

Audited against `src/storage/artifacts.ts`, `src/orchestrator/runScenario.ts`, `eventBus.ts`, `browser/collectors.ts`, `browser/playerSession.ts` and `errors.ts`. Runs live in `artifacts/runs/<ISO_TIMESTAMP>-<scenario>/` (the name must match the runner's pattern; other directories and symlinks are skipped). The runner is unchanged.

| Allowed input (opened by fixed name only) | Fields used |
| --- | --- |
| `summary.json` | `status` (`completed`, `blocked`, `failed`), `scenario`, `startedAt`, `finishedAt`, `durationMs`, `reason`, `blockedOn`, `failure.category` and `failure.agent` (category must be one of the runner's `INTERACTION_CATEGORIES`), `evidence.failureScreenshots` |
| `events.jsonl` | `at`, `agent` (`runner`, `player-alpha`, `player-bravo`), `status`, `activity`, optional `artifactPath` |
| `console.jsonl` | `kind` (`console-error`, `page-error`), `text`, `agent`, `at` |
| `network-failures.jsonl` | `kind` (`request-failed`, `http-error`), `method`, `url`, `failure`, `status` (400 to 599), `agent`, `at` |
| Screenshots | Only files the runner itself referenced (an event's `artifactPath` or `evidence.failureScreenshots`), named `alpha/NN-name.png` or `bravo/NN-name.png`, regular files, at most 8 MB |

**Never read:** `.env` and env files, `trace.zip` and any trace, videos, HAR, keys, raw network payloads, unreferenced or unexpectedly named images, symlinks, files over 10 MB. The observer never lists or walks a run directory, so those files are not opened even when present. Malformed JSON, unknown agents/statuses/kinds and out-of-range HTTP statuses are skipped and counted in `inputIssues` (plus one low `input-unreadable` finding).

Sanitizing: the runner redacts the secrets it knows at runtime. The observer cannot know them, so every message it keeps also goes through `redact()` and is reduced further: URLs become `host/shape` labels (the Preview host becomes `preview`, no query, ids and 6-character path segments become `:id`); e-mails, token- and id-like strings and text that looks like a room code become `[redacted]`. Limit: an arbitrary password or other secret that the runner did not redact and that has no recognizable shape cannot be detected by the observer; the runner's own redaction of known credentials remains the first line of defence.

### Findings

`findings.json` has `kind: "duel-agent-office/findings"` and `schemaVersion: 1`, plus `generatedAt`, `scope` (`run` or `root`), `options`, `totals` (counts by status, severity and category, ignored network failures), `runs[]` and `repeated[]`. `parseFindingsReport` rejects a newer `schemaVersion`. Each finding has `id`, `fingerprint` (run-independent), `ruleId`, `category`, `severity`, `runId`, `player` (`alpha`, `bravo`, `runner`, `unknown`), `count`, `firstAt`, `lastAt`, a sanitized `message` and `evidence` (file name plus line, for example `console.jsonl#3`). Each run entry also carries `status`, timestamps and, when the summary has a fully valid `result`, `result.outcome` (`win`, `loss`, `draw`, `unknown` per player) and `result.turns`; anything else in `result` is dropped. Equivalent records inside one run collapse into one finding with a count. Output is deterministic: same artifacts and same clock give the same bytes.

| Rule id | Category | Severity | Fires on |
| --- | --- | --- | --- |
| `console-error` | console-error | medium | Console error record |
| `page-error` | page-error | high | Uncaught page error record |
| `known-he-not-a-function` | console-error or page-error | high | The text `he is not a function` **present in** a console or page-error record. Never inferred from summaries, events, network records or bundles |
| `http-4xx`, `http-auth` | http-4xx | medium, high | 4xx response; 401 and 403 are always high |
| `http-5xx` | http-5xx | high | 5xx response |
| `network-failure` | network-failure | medium | Failed request not matched by the ignore list |
| `interaction-<category>` | interaction (timeout for `turn-state-timeout`) | high | `summary.failure.category` |
| `run-timeout` | timeout | high | Failed run whose reason mentions a timeout and has no interaction failure |
| `run-blocked` | run-blocked | medium | `blocked` run (shows `blockedOn`) |
| `run-failed` | run-failed | high | `failed` run with no more specific rule above |
| `run-incomplete` | run-failed | high | No summary, no terminal runner event and no activity for 1 hour |
| `completed-with-error-signals` | completed-with-errors | medium | `completed` run that still has console, page, HTTP or non-ignored network findings |
| `input-unreadable` | input | low | Malformed, invalid or oversized inputs were skipped |

Repeated findings: the same `fingerprint` (rule plus message, digits and case normalized) in two or more runs. Run statuses: `active` (no summary, activity within the last hour), `completed`, `blocked`, `failed`. A malformed summary falls back to a terminal runner event.

Ignore rules: `net::ERR_ABORTED` request failures are counted per run (`ignored.networkFailures`) and not reported. The ignore list applies only to failed-request error text; it never hides 4xx, 5xx, auth, page or console errors.

### Dashboard

`npm run agent:dashboard` is the only way to start it; no runner module imports it (a test enforces this). It binds to a loopback address (a non-loopback host is a config error), answers only `GET` and `HEAD`, rejects requests whose `Host` header is not this server (DNS-rebinding guard), sends a strict CSP and loads no external resources, and rescans the artifacts on every refresh (every 5 s). It shows run status, each player's latest activity, finding counts, repeated findings and approved screenshots. The browser receives a purpose-built view model: no raw JSON, URLs, local paths, room codes, e-mails, tokens, traces or videos. Screenshots are served by run name and index from the approved list; no path is ever taken from the request.

### Local handling

`findings.json` is local. Never commit, upload or attach it or any artifact (`artifacts/` is git-ignored). `agent:cleanup-artifacts` is unchanged and still the way to free space; it counts a per-run `findings.json` like any other file in the run.

## Tests

Vitest covers configuration and target guard, redaction, event schema, artifact paths, runs (completed/blocked/failed/timeout), the room-code flow with scripted locator doubles, the battle interaction state machine (readiness, selection verification, confirmation, advancement, overlays, every failure category), the turn policy, trace-off default, failure-screenshot safety, artifact cleanup and the Preview helper. The real Playwright view is checked in Chromium against a local replica of the battle markup (no network). Playwright against a live Preview is the manual validation: it needs Preview and QA credentials, and the repository's own e2e/visual harness uses fake local data, not Firebase QA.

## In the Hugents repo

This package lives at `packages/duel-agent-office` and is the base of Hugents. Run everything from this folder. `.env` is ignored by Git (also by the repo root `.gitignore`); never commit it, and never paste its values into issues, PRs or chats. `vendor/` is created by `npm run office:setup` and is ignored.
