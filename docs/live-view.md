# Live browser view

A local-only, read-only popup that shows a running Playwright task. Code: `packages/live` (`@hugents/live`).

## Flow

```
worker (Playwright page.screencast) -> frame gate -> loopback relay (127.0.0.1) -> authenticated viewer (office popup)
```

- Frames are transient. They live in memory only: the relay keeps the latest frame per player (max 4) and drops it when
  the run ends. They never go to Firestore, disk, logs, events, GitHub artifacts or an AI provider.
- The relay binds to `127.0.0.1`, validates `Host`, rejects unexpected `Origin` (the office origin must be listed in
  `allowedOrigins`), and serves viewers over GET only (Server-Sent Events). Any viewer write is answered `403
  input-not-allowed`; protocol upgrades are refused. The popup never forwards mouse, keyboard or touch input.
- Viewing needs the admin login: the viewer sends the admin token as `Authorization: Bearer` (never in a URL). The
  worker uses a separate worker token. Both are compared in constant time.
- Nobody watching means no capture: the relay answers `wanted: false` and `createCapture` refuses to start or stops.
  A slow viewer is skipped, never buffered.
- Caps (`resolveConfig`): fps, width, height, JPEG quality and bytes per frame come from a preset (`low`, `medium`,
  `high`) plus overrides, clamped to hard limits. Configuration can lower caps, never raise them past the limits.

## Frame gate

The gate runs inside the worker before a frame leaves it. It asks a project adapter for the current screen id and
releases frames only when the manifest lists that screen as visible (`screens[].hidden === false`).

| Situation | Result |
| --- | --- |
| Screen listed with `hidden: true` | hidden, `hidden-screen` |
| Login or account step (`setPrivateStep(true)`, called by the seed fixture or adapter) | hidden, `private-step` |
| Screen cannot be determined, or is not in the manifest | hidden, `unknown-screen` |
| Resolver throws | hidden, `gate-error` |

A hidden frame is a placeholder with no pixels. It carries only the reason code. `parseFrame` rejects a hidden frame
that carries pixels.

### Adding a project's hidden screens

Add each private screen to `screens` in the manifest with `hidden: true` (see `docs/manifest.md`), and make the
project adapter's `ScreenResolver` return the same id from a stable marker (for example a data attribute). Do not read
page text into the resolver. A screen the manifest does not list is treated as hidden, so a missing entry fails safe.

Known limit: the gate decides per frame, after the frame was captured. A screen change in the few milliseconds
between capture and decision can mislabel one frame. Mark login and account steps with `setPrivateStep` so they are
blacked out before navigation starts.

## Wiring in `duel-agent-office`

Opt-in and local. With `OFFICE_LIVE_ENABLED=true` and `OFFICE_LIVE_VIEWER_TOKEN` (16+ characters, set for both `office:bridge` and the dashboard process), `office:bridge` hosts
the relay on `OFFICE_LIVE_PORT` (default 3101) and hands the runner a random worker token and the loopback URL through
its environment (`QA_LIVE_RELAY_URL`, `QA_LIVE_WORKER_TOKEN`). The runner (`src/cli.ts`) calls `startLiveView` after
both players open:

- It announces the run to the relay (`POST /worker/run`), polls `GET /worker/wanted`, and starts a capture per player
  only while someone watches. Closing the viewer stops capture within one poll.
- The runner's gate treats a screen as safe only when `PlayerSession.isSafeToCapture()` says so (login form, Dev Login
  secret, join-code field, waiting room hide). A player starts in a private step and leaves it only after `login()`
  succeeds, so a failed login keeps frames hidden.
- One POST at a time: extra frames are dropped. If the relay is offline or refuses the token, the live view stays off
  and the run is unaffected.
- Optional caps: `QA_LIVE_PRESET` (`low` default), `QA_LIVE_MAX_FPS`, `QA_LIVE_MAX_WIDTH`, `QA_LIVE_MAX_HEIGHT`,
  `QA_LIVE_QUALITY`, all clamped to the hard limits.
- `tests/liveView.chromium.test.ts` runs real Chromium against synthetic pages and a real relay.

## The popup (LiveRunDialog)

Built from the design handoff on the Agent Office page (`packages/duel-agent-office/src/observer/liveDialogAssets.ts`).
It follows the handoff's component tree, states, copy deck and accessibility notes: view only (the frame has no pointer
events and is not focusable), one decoded frame at most, and every exit path (end, close, offline, player switch,
private marker, hide) stops the subscription, closes the bitmap and clears the canvas before anything else paints.

- The page never sees the viewer token. The office server (`dashboardCli`) reads `OFFICE_LIVE_VIEWER_TOKEN` and exposes
  `GET /api/live/status` and `GET /api/live/stream` (same origin only, Host checked, GET only), which forward to the
  relay. This also removes the need for CORS and keeps the stream behind the same loopback host check as the page.
- "Watch live" shows on an agent only while the relay has an active run for it. Both players share one run, so it shows
  for both player agents. With no run the popup says "No active run"; it never replays or simulates one.
- Quality: the viewer asks for `auto`, `high` or `low`; the relay tells the worker the lowest preset any viewer asked
  for and the worker restarts its capture with that preset's caps. A slow link forces Low.
- Phase comes from the runner: Login while any player is in a login step, then Match, then Report. Checks is shown but
  the runner does not report it yet. The handoff's per-step text is not available (the relay carries no step text),
  so the footer shows the phase and run id instead.
- Values the handoff marked [confirm] are used as proposed: 3 s to slow, 10 s on time to recover, 10 s to offline,
  retry back-off 2, 4, 8, 16, 30 s.

## Events

`createLiveEmitter` writes `stream-start`, `gate-blocked`, `gate-released`, `viewer-connected`, `viewer-disconnected`
and `stream-end` through the core event contract and sanitizer. Labels are fixed strings; no frame, screen id or
reason text is included.

## Popup behavior

`popupState` derives one of: connecting, live, hidden by gate, slow connection, run ended, no active run, relay
offline. `POPUP_TEXT` gives each a visible label (never color alone). `canOpenPopup` allows opening only for an agent
with an active run. `shouldShowFrame` shows an image only when live or slow, and not paused or hidden. Pausing the
view is client-side and never pauses the run. Stale frames are cleared when the run ends.

## Trust boundaries

Worker and relay share a process host and a secret. The viewer is a browser page on the same machine. Nothing here is
reachable from the network. Remote viewing from the hosted UI needs an outbound relay and is a separate decision;
a GitHub Actions worker cannot serve a local viewer.
