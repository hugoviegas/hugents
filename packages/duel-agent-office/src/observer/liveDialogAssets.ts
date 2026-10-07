/**
 * The LiveRunDialog (design handoff "Live run viewer"): CSS and client script for the Agent Office page.
 * View only, memory only: the dialog never sends input to the browser and holds at most one decoded frame, which every
 * exit path clears. The page talks to /api/live/* on its own server; the viewer token never reaches it.
 */

export const LIVE_ICONS = {
  "eye": "M2 1h3v1h-3zM1 2h1v1h-1zM5 2h1v1h-1zM0 3h1v1h-1zM6 3h1v1h-1zM1 4h1v1h-1zM5 4h1v1h-1zM2 5h3v1h-3zM3 3h1v1h-1z",
  "eye-slash": "M2 1h3v1h-3zM1 2h1v1h-1zM5 2h1v1h-1zM0 3h1v1h-1zM6 3h1v1h-1zM1 4h1v1h-1zM5 4h1v1h-1zM2 5h3v1h-3zM0 6h1v1h-1zM1 5h1v1h-1zM2 4h1v1h-1zM3 3h1v1h-1zM4 2h1v1h-1zM5 1h1v1h-1zM6 0h1v1h-1z",
  "close": "M0 0h1v1h-1zM6 0h1v1h-1zM1 1h1v1h-1zM5 1h1v1h-1zM2 2h1v1h-1zM4 2h1v1h-1zM3 3h1v1h-1zM2 4h1v1h-1zM4 4h1v1h-1zM1 5h1v1h-1zM5 5h1v1h-1zM0 6h1v1h-1zM6 6h1v1h-1z",
};

export const LIVE_CSS = `
.watch-btn{align-self:flex-start;border-color:var(--accent-primary);background:var(--accent-primary);color:var(--on-fill);font-weight:700}
.watch-btn:hover{border-color:var(--text-primary)}
.live-scrim{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:var(--space-4);background:color-mix(in srgb,var(--redacted-bg) 72%,transparent)}
.live-dlg{width:100%;max-width:880px;max-height:100%;overflow-y:auto;display:flex;flex-direction:column;background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:var(--radius-lg);box-shadow:var(--shadow-panel);animation:live-in var(--duration-base) var(--ease-standard)}
@keyframes live-in{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:none}}
.live-head{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-3);padding:14px 16px 14px 20px}
.live-ident{display:flex;flex-direction:column;gap:2px;min-width:0;margin-right:auto}
.live-ident h2{margin:0;font:var(--type-room-title)}
.live-ident h2:focus{outline:none}
.live-ident h2:focus-visible{box-shadow:var(--shadow-focus)}
.live-sub{font:var(--type-timestamp);color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.live-timer{font:var(--type-timestamp);color:var(--text-secondary)}
.live-x{min-width:44px;padding:0}
.live-row{padding:var(--space-3) 20px;border-top:1px solid var(--panel-raised);display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-3)}
.live-steps{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:var(--space-2) var(--space-4)}
.live-steps.dim{opacity:.55}
.live-steps li{display:inline-flex;align-items:center;gap:6px;font:var(--type-label);font-weight:400;color:var(--text-muted)}
.live-steps li[aria-current="step"]{color:var(--text-primary);font-weight:700}
.live-steps li::before{content:"";width:8px;height:8px;border:1px solid var(--text-muted);background:transparent}
.live-steps li[data-done="true"]::before{background:var(--text-muted)}
.live-steps li[aria-current="step"]::before{background:var(--accent-primary);border-color:var(--accent-primary)}
.live-tabs{display:flex;gap:var(--space-2)}
.live-tab{min-height:44px;padding:0 16px;border:1px solid var(--panel-border);border-radius:var(--radius-md);background:transparent;color:var(--text-primary);font:var(--type-label);cursor:pointer}
.live-tab[aria-selected="true"]{background:var(--accent-primary);border-color:var(--accent-primary);color:var(--on-fill)}
.live-tab:disabled{opacity:.55;cursor:not-allowed}
.live-note{font:var(--type-caption);color:var(--text-secondary)}
.live-stage{position:relative;aspect-ratio:16/9;margin:0 20px;background:var(--screen-bg);border:1px solid var(--panel-border);overflow:hidden}
.live-canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;transition:opacity var(--duration-fast) var(--ease-standard)}
.live-canvas.fade{animation:live-fade 200ms var(--ease-standard)}
.live-canvas.dim{opacity:.5}
@keyframes live-fade{from{opacity:0}to{opacity:1}}
.live-chip{position:absolute;top:8px;padding:2px 6px;background:var(--screen-bg);border:1px solid var(--screen-dim);color:var(--screen-text);font:var(--type-timestamp)}
.live-chip.l{left:8px}.live-chip.r{right:8px}
.live-banner{position:absolute;left:8px;right:8px;bottom:8px;padding:6px 10px;background:var(--screen-bg);border:1px solid var(--warning);color:var(--screen-text);font:var(--type-label);font-weight:400}
.live-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:var(--space-4);color:var(--screen-text);text-align:center}
.live-ph .card{max-width:440px;display:flex;flex-direction:column;align-items:center;gap:var(--space-2);padding:var(--space-4)}
.live-ph h3{margin:0;font:var(--type-room-title)}
.live-ph p{font:var(--type-body);color:var(--screen-dim)}
.live-ph .acts{display:flex;gap:var(--space-2);flex-wrap:wrap;justify-content:center;margin-top:var(--space-2)}
.live-ph.private{background:var(--redacted-bg);background-image:repeating-linear-gradient(45deg,transparent 0 8px,var(--redacted-mark) 8px 9px)}
.live-ph.private .card{background:var(--redacted-bg);border:1px solid var(--redacted-mark);color:var(--text-primary)}
.live-ph.private p{color:var(--text-primary)}
.live-ph.private svg{color:var(--redacted-mark)}
.live-sq{display:inline-flex;gap:4px}
.live-sq i{width:10px;height:10px;background:var(--screen-dim)}
.live-sq i.on{background:var(--accent-primary)}
.live-controls{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);padding:var(--space-3) 20px}
.live-controls label{display:inline-flex;align-items:center;gap:var(--space-2);font:var(--type-label);color:var(--text-secondary)}
.live-controls .btn[aria-pressed="true"]{background:var(--accent-primary);border-color:var(--accent-primary);color:var(--on-fill)}
.live-controls .btn:disabled,.live-controls select:disabled{opacity:.55;cursor:not-allowed}
.live-foot{display:flex;flex-direction:column;gap:2px;padding:var(--space-3) 20px;background:var(--panel-raised);font:var(--type-log);color:var(--text-secondary);border-radius:0 0 var(--radius-lg) var(--radius-lg)}
.live-foot span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:959px){.live-scrim{padding:var(--space-4) 16px}.live-note{flex-basis:100%}}
@media (max-width:599px){.live-scrim{padding:0;align-items:stretch}.live-dlg{max-width:none;border:0;border-radius:0;max-height:none;height:100%}.live-stage{margin:0 16px}.live-row,.live-controls,.live-foot{padding-left:16px;padding-right:16px}.live-controls .btn{flex:1 1 calc(50% - 8px)}.live-foot{border-radius:0}.live-foot span{white-space:normal}.live-ph{padding:var(--space-2)}.live-ph .card{padding:var(--space-2);gap:var(--space-1)}.live-ph p{font:var(--type-caption)}.live-ph h3{font:var(--type-agent-name)}}
@media (prefers-reduced-motion:reduce){.live-dlg,.live-canvas,.live-canvas.fade{animation:none;transition:none}}
`;

export const LIVE_JS = String.raw`
// ---- Live run viewer (view only, memory only).
const LIVE = { enabled: false, relay: "offline", run: null, lastRun: null, key: "" };
const LIVE_PHASES = ["Setup", "Login", "Match", "Checks", "Report"];
const LIVE_COPY = {
  connecting: { badge: "CONNECTING", title: "Connecting to the frame relay", body: "Waiting for the first frame from {player}. Phase and time are already live.", say: "Connecting to the frame relay." },
  live: { badge: "LIVE", say: "Live view. {player} player. Phase {phase}." },
  paused: { badge: "LIVE", title: "View paused", body: "View paused on the {time} frame. The test keeps running.", say: "View paused. The test keeps running." },
  hidden: { badge: "LIVE", title: "Viewport hidden", body: "Frames are not drawn while hidden. Phase, status and time keep updating.", say: "Viewport hidden. Status keeps updating." },
  private: { badge: "LIVE", title: "Private screen hidden", body: "This page can show personal data, so its frames are never sent. The test keeps running and the view comes back on the next safe screen.", say: "Private screen hidden. The test keeps running." },
  slow: { badge: "SLOW LINK", say: "Slow connection. Showing the last frame received." },
  ended: { badge: "COMPLETED", title: "Run finished", body: "Ended {time} · {total}. Frames cleared from this window.", say: "Run finished, {result}. Frames cleared." },
  none: { badge: "IDLE", title: "No active run", body: "{agent} has no test running right now. This window opens only while a run is active.", say: "No active run for {agent}." },
  offline: { badge: "OFFLINE", title: "Relay offline", body: "The frame relay is not responding, so no frames can be shown. The run itself may still be going. Last known phase: {phase}.", say: "Relay offline. No frames can be shown." },
};
const LIVE_BADGE = { connecting: ["s", "waiting"], live: ["m", "live"], paused: ["m", "live"], hidden: ["m", "live"], private: ["m", "live"], slow: ["s", "waiting"], ended: ["s", "completed"], none: ["s", "idle"], offline: ["s", "offline"] };
let liveDlg = null;

// The person's choice (hide) wins over stream detail; pause only applies while live.
function deriveView(status, local) {
  if (status === "connecting" || status === "ended" || status === "none" || status === "offline") return status;
  if (local.viewHidden) return "hidden";
  if (status === "private") return "private";
  if (status === "live" && local.paused) return "paused";
  return status;
}
const liveSharedRun = () => (view.data && view.data.settings && view.data.settings.sharedRun) || [];
function liveRunFor(agentId) {
  const run = LIVE.run;
  if (!LIVE.enabled || LIVE.relay !== "up" || !run) return null;
  const shared = liveSharedRun();
  return run.agentId === agentId || (shared.includes(agentId) && shared.includes(run.agentId)) ? run : null;
}
// Player labels come from the run's shared agents ("player-<label>"), never from literals in the page.
const livePlayers = () => liveSharedRun().map((id) => id.replace(/^player-/, ""));
const liveWord = (p) => String(p).charAt(0).toUpperCase() + String(p).slice(1);
const liveClock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h ? h + ":" + two(m) + ":" + two(x) : two(m) + ":" + two(x);
};
const livePhaseIndex = (phase) => (phase ? LIVE_PHASES.findIndex((p) => p.toLowerCase() === String(phase).toLowerCase()) : -1);

async function pollLive() {
  let next;
  try {
    const r = await fetch("/api/live/status", { cache: "no-store" });
    next = r.ok ? await r.json() : { enabled: false };
  } catch { next = { enabled: true, relay: "offline" }; }
  LIVE.enabled = !!next.enabled;
  LIVE.relay = next.relay === "up" ? "up" : "offline";
  LIVE.run = next.run || null;
  LIVE.lastRun = next.lastRun || null;
  const key = [LIVE.enabled, LIVE.relay, LIVE.run && LIVE.run.runId, LIVE.run && LIVE.run.phase].join("|");
  const changed = key !== LIVE.key;
  LIVE.key = key;
  if (changed && !liveDlg) render();
  if (liveDlg) liveSync(liveDlg);
}

function liveButtonFor(f) {
  if (!liveRunFor(f.id)) return null;
  const b = el("button", { type: "button", class: "btn watch-btn", "data-key": "watch-live" }, icon("eye", 14), "Watch live");
  b.addEventListener("click", () => openLive(f, b));
  return b;
}

// ---- Frame lifecycle: stop the subscription, close the bitmap, clear the canvas, only then paint anything else.
function liveRelease(d) {
  if (d.bitmap) { try { d.bitmap.close(); } catch { /* already closed */ } d.bitmap = null; }
  d.frameAt = null;
  const c = d.canvas;
  if (c) { const g = c.getContext("2d"); if (g && c.width) g.clearRect(0, 0, c.width, c.height); c.width = 0; c.height = 0; }
}
function liveUnsubscribe(d) {
  if (d.ctrl) { d.ctrl.abort(); d.ctrl = null; }
  clearTimeout(d.connectTimer);
  clearTimeout(d.retryTimer);
}
function liveEffQuality(d) { return d.status === "slow" || d.forcedLow ? "low" : d.quality; }

async function liveConnect(d, keepFrame) {
  liveUnsubscribe(d);
  if (!keepFrame) liveRelease(d);
  const ctrl = new AbortController();
  d.ctrl = ctrl;
  if (!keepFrame) d.status = "connecting";
  d.connectTimer = setTimeout(() => { if (d.ctrl === ctrl && !d.opened) liveOffline(d); }, 10000);
  d.opened = false;
  liveSync(d);
  try {
    const res = await fetch("/api/live/stream?" + new URLSearchParams({ player: d.player, quality: liveEffQuality(d) }), { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok || !res.body) throw new Error("relay refused");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (d.ctrl !== ctrl) return;
        d.opened = true;
        clearTimeout(d.connectTimer);
        await liveEvent(d, block);
      }
    }
    if (d.ctrl === ctrl && d.status !== "ended") liveOffline(d);
  } catch {
    if (d.ctrl === ctrl && !ctrl.signal.aborted) liveOffline(d);
  }
}

async function liveEvent(d, block) {
  const m = /^event: (\w+)\ndata: (.*)$/m.exec(block);
  if (!m) return;
  let data; try { data = JSON.parse(m[2]); } catch { return; }
  if (m[1] === "ended") {
    liveUnsubscribe(d); liveRelease(d);
    d.lastRun = data.lastRun || d.lastRun;
    d.status = "ended";
  } else if (m[1] === "frame") {
    if (data.player !== d.player) return;
    if (data.gate && data.gate.state === "hidden") {
      liveRelease(d); // the relay sent a marker; any shown frame goes first
      d.status = "private";
    } else if (d.viewHidden) {
      return;
    } else if (d.paused) {
      return; // paused: drop incoming frames, keep the one held
    } else {
      const bytes = Uint8Array.from(atob(data.jpeg), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
      if (!liveDlg || liveDlg !== d || d.player !== data.player || !d.ctrl) { bitmap.close(); return; }
      const first = !d.bitmap && d.status === "connecting" && !d.noFade;
      if (d.bitmap) d.bitmap.close();
      d.bitmap = bitmap;
      d.frameAt = Date.now();
      const c = d.canvas;
      c.width = bitmap.width; c.height = bitmap.height;
      c.getContext("2d").drawImage(bitmap, 0, 0);
      if (first) { c.classList.remove("fade"); void c.offsetWidth; c.classList.add("fade"); }
      d.noFade = false;
      if (d.status === "slow") { d.onTimeSince = d.onTimeSince || Date.now(); }
      else d.status = "live";
    }
  } else return;
  liveSync(d);
}

function liveOffline(d) {
  liveUnsubscribe(d); liveRelease(d);
  d.status = "offline";
  const wait = [2000, 4000, 8000, 16000, 30000][Math.min(d.retries, 4)];
  d.retries += 1;
  d.retryTimer = setTimeout(() => { if (liveDlg === d && d.status === "offline" && LIVE.relay === "up" && liveRunFor(d.agent.id)) liveConnect(d, false); }, wait);
  liveSync(d);
}

function liveClose() {
  const d = liveDlg;
  if (!d) return;
  liveUnsubscribe(d); liveRelease(d);
  clearInterval(d.tick);
  d.root.remove();
  liveDlg = null;
  document.removeEventListener("keydown", liveKeys, true);
  const back = document.querySelector('[data-key="watch-live"]') || document.querySelector('.agent[aria-pressed="true"]');
  if (d.trigger && document.contains(d.trigger)) d.trigger.focus(); else if (back) back.focus();
  render();
}

function liveKeys(event) {
  const d = liveDlg;
  if (!d) return;
  if (event.key === "Escape") { event.preventDefault(); liveClose(); return; }
  if (event.key !== "Tab") return;
  const tabbable = [d.title, ...d.dlg.querySelectorAll("button,select")].filter((n) => n === d.title || (!n.disabled && n.tabIndex !== -1 && !n.closest("[hidden]")));
  if (!tabbable.length) return;
  const first = tabbable[0], last = tabbable[tabbable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !d.dlg.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !d.dlg.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
}

function openLive(agent, trigger) {
  if (liveDlg) return;
  const run = liveRunFor(agent.id);
  const players = livePlayers();
  const own = agent.id.replace(/^player-/, "");
  const d = { agent, trigger, players, player: players.includes(own) ? own : players[0] || own, paused: false, viewHidden: false, quality: "auto", forcedLow: false,
    status: run ? "connecting" : "none", bitmap: null, frameAt: null, ctrl: null, retries: 0, lastRun: LIVE.lastRun, onTimeSince: null, said: "", sayTimer: null, noFade: false, endedAt: null };
  const title = el("h2", { id: "live-title", tabindex: "-1" }, agent.name);
  const sub = el("span", { id: "live-sub", class: "live-sub" });
  const timer = el("span", { class: "live-timer", role: "timer", "aria-live": "off" });
  const closeBtn = el("button", { type: "button", class: "btn live-x", "aria-label": "Close live view", "data-key": "live-close" }, icon("close", 14));
  closeBtn.addEventListener("click", liveClose);
  const badgeBox = el("span");
  const head = el("div", { class: "live-head" }, el("span", { class: "swatch id-" + agent.look }), el("div", { class: "live-ident" }, title, sub), badgeBox, timer, closeBtn);
  const steps = el("ol", { class: "live-steps", "aria-label": "Run phase" });
  const tabs = el("div", { class: "live-tabs", role: "tablist", "aria-label": "Player" });
  const tabEls = {};
  for (const p of d.players) {
    const t = el("button", { type: "button", class: "live-tab", role: "tab", id: "live-tab-" + p, "aria-controls": "live-stage", "data-key": "live-tab-" + p }, liveWord(p));
    t.addEventListener("click", () => liveSwitch(d, p));
    t.addEventListener("keydown", (e) => {
      const order = d.players; const n = order.length; let i = order.indexOf(p);
      if (e.key === "ArrowRight") i = (i + 1) % n; else if (e.key === "ArrowLeft") i = (i + n - 1) % n; else if (e.key === "Home") i = 0; else if (e.key === "End") i = n - 1; else return;
      e.preventDefault(); liveSwitch(d, order[i]); tabEls[order[i]].focus();
    });
    tabEls[p] = t; tabs.append(t);
  }
  const rowTabs = el("div", { class: "live-row" }, tabs, el("span", { class: "live-note" }, "View only. Nothing you click or type here reaches the browser."));
  const canvas = el("canvas", { class: "live-canvas", role: "img", width: "0", height: "0", "aria-label": liveWord(d.player) + " player browser view" });
  const meta = el("span", { class: "live-chip l" });
  const age = el("span", { class: "live-chip r" });
  const banner = el("div", { class: "live-banner", hidden: "" });
  const ph = el("div", { class: "live-ph", hidden: "" });
  const stage = el("div", { class: "live-stage", id: "live-stage", role: "tabpanel", tabindex: "-1" }, canvas, meta, age, banner, ph);
  stage.removeAttribute("tabindex");
  const pauseBtn = el("button", { type: "button", class: "btn", "aria-pressed": "false", "data-key": "live-pause" }, "Pause view");
  const hideBtn = el("button", { type: "button", class: "btn", "aria-pressed": "false", "data-key": "live-hide" }, "Hide viewport");
  const qSel = el("select", { id: "live-quality", "data-key": "live-quality" }, el("option", { value: "auto" }, "Auto"), el("option", { value: "high" }, "High"), el("option", { value: "low" }, "Low"));
  const qLabel = el("label", { for: "live-quality" }, "Quality ", qSel);
  const qNote = el("span", { class: "live-note" });
  const controls = el("div", { class: "live-controls" }, pauseBtn, hideBtn, qLabel, qNote);
  const foot = el("div", { class: "live-foot" }, el("span", { "data-k": "phase" }), el("span", null, "Frames are held in memory only and are never saved. Pausing the view does not pause the test."));
  const live = el("p", { class: "sr-only", "aria-live": "polite" });
  const dlg = el("div", { class: "live-dlg", role: "dialog", "aria-modal": "true", "aria-labelledby": "live-title", "aria-describedby": "live-sub" }, head, el("div", { class: "live-row" }, steps), rowTabs, stage, controls, foot, live);
  const root = el("div", { class: "live-scrim" }, dlg);
  Object.assign(d, { root, dlg, title, sub, timer, badgeBox, steps, tabEls, canvas, meta, age, banner, ph, pauseBtn, hideBtn, qSel, qNote, foot, live });
  pauseBtn.addEventListener("click", () => { if (pauseBtn.disabled) return; d.paused = !d.paused; if (!d.paused) { d.noFade = true; } liveSync(d); });
  hideBtn.addEventListener("click", () => {
    if (hideBtn.disabled) return;
    d.viewHidden = !d.viewHidden;
    if (d.viewHidden) { liveUnsubscribe(d); liveRelease(d); }
    else { d.noFade = true; liveConnect(d, false); }
    liveSync(d);
  });
  qSel.addEventListener("change", () => { d.quality = qSel.value; if (d.ctrl && !d.viewHidden) liveConnect(d, true); });
  document.body.append(root);
  liveDlg = d;
  document.addEventListener("keydown", liveKeys, true);
  d.tick = setInterval(() => liveTick(d), 500);
  title.focus();
  liveSync(d);
  if (run) liveConnect(d, false);
}

function liveSwitch(d, player) {
  if (d.player === player || d.tabEls[player].disabled) return;
  liveUnsubscribe(d); liveRelease(d);
  d.player = player; d.paused = false; d.forcedLow = false; d.onTimeSince = null;
  d.canvas.setAttribute("aria-label", liveWord(player) + " player browser view");
  d.tabEls[player].setAttribute("aria-selected", "true");
  if (d.viewHidden) { d.status = "connecting"; liveSync(d); return; }
  liveConnect(d, false);
}

function liveTick(d) {
  if (d.status === "live" && d.frameAt && Date.now() - d.frameAt > 3000 && !d.paused) {
    d.status = "slow"; d.onTimeSince = null;
    if (d.ctrl) liveConnect(d, true);
  } else if (d.status === "slow" && d.onTimeSince && Date.now() - d.onTimeSince >= 10000 && d.frameAt && Date.now() - d.frameAt < 3000) {
    d.status = "live"; d.onTimeSince = null;
    liveConnect(d, true);
  } else if (d.status === "slow" && d.frameAt && Date.now() - d.frameAt > 3000) d.onTimeSince = null;
  liveSync(d);
}

function liveFill(text, d) {
  const run = LIVE.run;
  const ended = d.lastRun && d.lastRun.endedAt;
  return text.replace("{player}", liveWord(d.player)).replace("{agent}", d.agent.name)
    .replace("{phase}", (run && run.phase) || d.lastPhase || "unknown")
    .replace("{time}", d.frameAt ? fmtTime(new Date(d.frameAt).toISOString()).slice(0, 8) : "last")
    .replace("{total}", ended && d.startedAt ? liveClock(Date.parse(ended) - d.startedAt) : "")
    .replace("{result}", d.lastRun && d.lastRun.status === "completed" ? "passed" : "failed");
}

function liveSync(d) {
  if (liveDlg !== d) return;
  const run = LIVE.run && liveRunFor(d.agent.id) ? LIVE.run : null;
  if (run) { d.startedAt = Date.parse(run.startedAt) || d.startedAt; d.lastPhase = run.phase; d.runId = run.runId; }
  // The run is gone while a stream was still thought live: the relay ends it, and a poll can see it first.
  if (!run && (d.status === "live" || d.status === "slow" || d.status === "private" || d.status === "connecting") && LIVE.relay === "up" && d.runId) {
    liveUnsubscribe(d); liveRelease(d); d.lastRun = LIVE.lastRun || d.lastRun; d.status = d.lastRun ? "ended" : "none";
  }
  if (LIVE.relay !== "up" && d.status !== "offline" && d.status !== "none" && d.status !== "ended") { liveOffline(d); return; }
  const v = deriveView(d.status, { paused: d.paused, viewHidden: d.viewHidden });
  const copy = LIVE_COPY[v];
  const failed = v === "ended" && d.lastRun && d.lastRun.status !== "completed";
  d.sub.textContent = run ? "Playwright run " + run.runId : d.lastPhase ? "Last run " + (d.runId || "") : "No run";
  const [kind, name] = failed ? ["s", "failed"] : LIVE_BADGE[v];
  d.badgeBox.replaceChildren(badge(kind, name, failed ? "FAILED" : copy.badge));
  const end = d.lastRun && d.lastRun.endedAt && !run ? Date.parse(d.lastRun.endedAt) : null;
  d.timer.textContent = d.startedAt ? liveClock((end || Date.now()) - d.startedAt) : "--:--";
  const idx = livePhaseIndex(run ? run.phase : d.lastPhase);
  const done = v === "ended" ? LIVE_PHASES.length : idx;
  const stepsKey = [idx, done, v === "offline", v === "ended"].join("|");
  if (stepsKey !== d.stepsKey) {
    d.stepsKey = stepsKey;
    d.steps.className = "live-steps" + (v === "offline" ? " dim" : "");
    d.steps.replaceChildren(...LIVE_PHASES.map((p, i) => el("li", Object.assign({ "data-done": String(i < done) }, i === idx && v !== "ended" ? { "aria-current": "step" } : {}), p)));
  }
  for (const p of d.players) {
    d.tabEls[p].setAttribute("aria-selected", String(p === d.player));
    d.tabEls[p].tabIndex = p === d.player ? 0 : -1;
    d.tabEls[p].disabled = v === "ended" || v === "none" || v === "offline";
  }
  const showFrame = (v === "live" || v === "paused" || v === "slow") && !!d.bitmap;
  d.canvas.hidden = !showFrame;
  d.canvas.classList.toggle("dim", v === "slow");
  d.meta.hidden = !(showFrame || v === "private" || v === "hidden");
  d.meta.textContent = liveWord(d.player);
  d.age.hidden = !showFrame;
  d.age.textContent = d.frameAt ? Math.max(0, Math.round((Date.now() - d.frameAt) / 1000)) + " s ago" : "";
  d.banner.hidden = !(v === "paused" || v === "slow");
  d.banner.textContent = v === "paused" ? liveFill(LIVE_COPY.paused.body, d) : v === "slow" ? "Slow connection. Showing the last frame received. Quality lowered to Low until frames arrive on time." : "";
  // Placeholder: one component, one variant per view.
  const phVariant = { connecting: "connecting", hidden: "hidden", private: "private", ended: "ended", none: "none", offline: "offline" }[v];
  d.ph.hidden = !phVariant;
  d.ph.className = "live-ph" + (phVariant === "private" ? " private" : "");
  if (phVariant) {
    const c = LIVE_COPY[phVariant];
    const kids = [];
    if (phVariant === "private") kids.push(icon("eye-slash", 24), el("span", { class: "label" }, "PRIVATE"));
    if (phVariant === "hidden") kids.push(icon("eye-slash", 24));
    if (phVariant === "connecting") kids.push(el("span", { class: "live-sq", "aria-hidden": "true" }, el("i"), el("i"), el("i")));
    const title = phVariant === "ended" ? "Run finished · " + (d.lastRun && d.lastRun.status === "completed" ? "passed" : "failed") : c.title;
    const body = liveFill(c.body, d);
    const acts = el("div", { class: "acts" });
    const act = (text, fn, key) => { const b = el("button", { type: "button", class: "btn", "data-key": key }, text); b.addEventListener("click", fn); acts.append(b); };
    if (phVariant === "hidden") act("Show viewport", () => d.hideBtn.click(), "live-show");
    if (phVariant === "offline") act("Retry connection", () => { d.retries = 0; liveConnect(d, false); }, "live-retry");
    if (phVariant === "ended") { act("Open report", () => { liveClose(); const h = document.querySelector('a[href="#reports"]'); if (h) h.click(); }, "live-report"); act("Close", liveClose, "live-close2"); }
    if (phVariant === "none") act("Back to office", liveClose, "live-back");
    const phKey = [phVariant, title, body].join("|");
    if (phKey !== d.phKey) {
      d.phKey = phKey;
      d.ph.replaceChildren(el("div", { class: "card" }, ...kids, el("h3", null, title), el("p", null, body), acts));
    }
    if (phVariant === "connecting") {
      const lit = matchMedia("(prefers-reduced-motion: reduce)").matches ? -1 : Math.floor(Date.now() / 400) % 3;
      d.ph.querySelectorAll(".live-sq i").forEach((n, i) => n.classList.toggle("on", i === lit));
    }
  } else d.phKey = "";
  d.pauseBtn.disabled = !(v === "live" || v === "paused");
  d.pauseBtn.setAttribute("aria-pressed", String(d.paused));
  d.pauseBtn.textContent = d.paused ? "Resume view" : "Pause view";
  d.hideBtn.disabled = !(v === "live" || v === "slow" || v === "private" || v === "hidden");
  d.hideBtn.setAttribute("aria-pressed", String(d.viewHidden));
  d.hideBtn.textContent = d.viewHidden ? "Show viewport" : "Hide viewport";
  d.qSel.value = v === "slow" ? "low" : d.quality;
  d.qSel.disabled = v === "slow" || v === "ended" || v === "none" || v === "offline";
  d.qNote.textContent = v === "slow" ? "Quality is held at Low until frames arrive on time." : "";
  d.foot.querySelector('[data-k="phase"]').textContent = "Phase: " + ((run && run.phase) || d.lastPhase || "unknown") + (d.runId ? " · " + d.runId : "");
  const say = liveFill(copy.say, d);
  if (say !== d.said) {
    d.said = say;
    clearTimeout(d.sayTimer);
    d.sayTimer = setTimeout(() => { if (liveDlg === d) d.live.textContent = say; }, 1000);
  }
}
setInterval(pollLive, 2000);
pollLive();
`;
