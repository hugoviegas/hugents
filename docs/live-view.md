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
