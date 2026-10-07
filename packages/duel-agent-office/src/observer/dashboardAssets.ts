/**
 * Static dashboard files, in the Agent Office design system (Claude Design): tokens from `src/theme`, the
 * "Live office" layout and the QA bullpen world. No external resources (the CSP allows none, so the design
 * fonts fall back to the system stacks unless installed locally); all dynamic text is set with textContent.
 */
import { ICONS } from "../theme/icons.js";
import { DEFAULT_THEME, THEMES, themeCss } from "../theme/tokens.js";
import { WORLD_SVG } from "./dashboardWorld.js";

const ICON_TEMPLATES = Object.entries(ICONS)
  .map(([name, d]) => `<svg data-icon="${name}" viewBox="0 0 7 7" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"></path></svg>`)
  .join("\n");

const THEME_OPTIONS = THEMES.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");

export const INDEX_HTML = `<!doctype html>
<html lang="en" data-theme="${DEFAULT_THEME}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Office</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div class="app">
<header class="topbar">
<div class="brand"><span class="eyebrow">Big Bang Duel</span><h1 class="title">Agent Office</h1></div>
<div class="modebar"><span id="mode-chip" class="badge m-live"></span><span id="meta" class="meta">Loading…</span></div>
<nav aria-label="Views" class="nav">
<a class="btn" href="#findings">Findings <span id="nav-count" class="count">0</span></a>
<a class="btn" href="#runs">Runs</a>
<label class="theme-pick">Theme <select id="theme">${THEME_OPTIONS}</select></label>
</nav>
</header>
<div id="banner" class="banner" role="status" hidden></div>
<p id="announce" class="sr-only" aria-live="polite"></p>
<main class="main">
<aside class="panel roster" aria-labelledby="roster-h">
<div class="panel-head"><h2 id="roster-h" class="room-title">Agents</h2><span id="roster-sub" class="caption"></span></div>
<div id="roster" class="roster-list"></div>
<p class="caption foot">Agents move only for real events. With no event, they stay idle.</p>
</aside>
<section class="office" aria-labelledby="office-h">
<div class="office-head"><h2 id="office-h" class="room-title">QA bullpen</h2><span id="office-run" class="caption"></span></div>
<div class="world-wrap">
<div id="world" class="world" data-mode="empty">
${WORLD_SVG}
<span class="sign" aria-hidden="true">QA bullpen</span>
<span class="tag" data-tag="1" aria-hidden="true"></span>
<span class="tag" data-tag="2" aria-hidden="true"></span>
<span class="tag" data-tag="3" aria-hidden="true"></span>
<span class="tag" data-tag="4" aria-hidden="true"></span>
</div>
</div>
<p id="world-note" class="caption center"></p>
</section>
<aside id="detail" class="panel detail" aria-label="Selected agent"></aside>
</main>
<div class="lower">
<section id="findings" class="panel" aria-labelledby="findings-h">
<div class="panel-head"><h2 id="findings-h" class="room-title">Findings</h2><span id="findings-sub" class="caption"></span></div>
<div id="findings-list"></div>
<h3 class="label">Evidence</h3>
<div id="shots" class="shots"></div>
</section>
<section class="panel" aria-labelledby="repeated-h">
<div class="panel-head"><h2 id="repeated-h" class="room-title">Repeated findings</h2></div>
<div id="repeated"></div>
</section>
<section id="runs" class="panel" aria-labelledby="runs-h">
<div class="panel-head"><h2 id="runs-h" class="room-title">Runs</h2><span id="totals" class="caption"></span></div>
<div id="run-list" class="run-list"></div>
</section>
</div>
</div>
<template id="icons">
${ICON_TEMPLATES}
</template>
<script src="/app.js"></script>
</body>
</html>
`;

const STATES = ["idle", "planning", "working", "waiting", "reviewing", "blocked", "completed", "failed", "offline"];

const COMPONENT_CSS = `
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--text-primary);font:var(--type-body)}
[hidden]{display:none!important}
a{color:var(--accent-secondary)}
:focus-visible{outline:none;box-shadow:var(--shadow-focus)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.app{min-height:100vh;display:flex;flex-direction:column}
.title{margin:0;font:var(--type-page-title)}
.room-title{margin:0;font:var(--type-room-title)}
.agent-name{font:var(--type-agent-name)}
.eyebrow,.caption{font:var(--type-caption);color:var(--text-muted)}
.label{margin:0;font:var(--type-label);color:var(--text-secondary)}
.ts,.mono{font:var(--type-timestamp);color:var(--text-muted)}
.code{font:var(--type-code)}
.center{text-align:center}
.muted{color:var(--text-muted)}
p{margin:0}

.topbar{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-4) var(--space-5);padding:var(--space-3) var(--space-5);background:var(--panel-bg);border-bottom:1px solid var(--panel-border)}
.brand{display:flex;flex-direction:column}
.modebar{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap}
.meta{font:var(--type-label);font-weight:400;color:var(--text-secondary)}
.nav{margin-left:auto;display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);min-height:44px;padding:0 14px;border:1px solid var(--panel-border);border-radius:var(--radius-md);background:transparent;color:var(--text-primary);font:var(--type-label);text-decoration:none;cursor:pointer;transition:border-color var(--duration-instant) var(--ease-standard)}
.btn:hover{border-color:var(--text-secondary)}
.count{padding:0 6px;background:var(--accent-secondary);color:var(--on-fill);border-radius:var(--radius-sm);font:var(--type-status)}
.theme-pick{display:inline-flex;align-items:center;gap:var(--space-2);font:var(--type-label);color:var(--text-secondary)}
select{min-height:44px;padding:0 10px;background:var(--bg);color:var(--text-primary);border:1px solid var(--panel-border);border-radius:var(--radius-md);font:var(--type-label)}

.banner{display:flex;align-items:center;gap:var(--space-3);padding:10px var(--space-5);background:var(--panel-raised);border-bottom:1px dashed var(--offline);font:var(--type-label);font-weight:400}
.banner svg{color:var(--offline);flex:none}

.badge{--c:var(--state-idle);display:inline-flex;align-items:center;gap:6px;padding:2px 6px;border:2px solid var(--c);border-radius:var(--radius-sm);background:var(--c);color:var(--on-fill);font:var(--type-status);letter-spacing:var(--type-status-tracking);text-transform:uppercase;white-space:nowrap;transition:background-color var(--duration-fast) var(--ease-standard)}
.badge svg{flex:none}
${STATES.map((s) => `.badge.s-${s}{--c:var(--state-${s})}`).join("\n")}
.badge.s-idle,.badge.s-offline,.badge.s-active,.badge.m-live,.badge.m-offline,.badge.sev-low{background:transparent;color:var(--c)}
.badge.s-active{--c:var(--state-working)}
.badge.s-offline,.badge.m-offline{border-style:dashed}
.badge.m-live{--c:var(--live);border-width:1px}
.badge.m-offline{--c:var(--offline);border-width:1px}
.badge.sev-high{--c:var(--failed)}
.badge.sev-medium{--c:var(--warning)}
.badge.sev-low{--c:var(--state-idle)}

.main{flex:1;display:flex;flex-wrap:wrap;gap:var(--space-5);padding:var(--space-5);align-items:stretch}
.panel{display:flex;flex-direction:column;gap:var(--space-3);padding:var(--space-4);background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:var(--radius-md);box-shadow:var(--shadow-panel);min-width:0}
.panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap}
.roster{flex:1 0 260px}
.detail{flex:1 0 320px;gap:var(--space-5)}
.roster-list{display:flex;flex-direction:column;gap:var(--space-2)}
.foot{margin-top:auto;padding-top:var(--space-3);border-top:1px solid var(--panel-raised)}

.agent{all:unset;box-sizing:border-box;position:relative;display:flex;flex-direction:column;gap:6px;padding:var(--space-3);border:1px solid transparent;border-radius:var(--radius-md);cursor:pointer;transition:border-color var(--duration-fast) var(--ease-standard)}
.agent:hover{border-color:var(--panel-border)}
.agent:focus-visible{box-shadow:var(--shadow-focus)}
.agent[aria-pressed="true"]{background:var(--panel-raised);border-color:var(--selected);box-shadow:var(--shadow-pixel)}
.agent-row{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-2)}
.agent-name{white-space:nowrap}
.agent-row .badge{margin-left:auto}
.role{font:var(--type-label);font-weight:400;color:var(--text-secondary)}
.activity{font:var(--type-label);font-weight:400;color:var(--text-muted);overflow-wrap:anywhere}
.agent[aria-pressed="true"] .activity{color:var(--text-primary)}
.swatch{flex:none;width:10px;height:10px;outline:1px solid var(--outline);background:var(--c)}
.id-1{--c:var(--agent-alpha)}.id-2{--c:var(--agent-bravo)}.id-3{--c:var(--agent-report)}.id-4{--c:var(--agent-runner)}

.office{flex:999 1 560px;min-width:0;display:flex;flex-direction:column;background:color-mix(in srgb,var(--outline),var(--bg) 15%);border:1px solid var(--panel-border);border-radius:var(--radius-lg);overflow:hidden}
.office-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-3) var(--space-4);flex-wrap:wrap}
.world-wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:0 var(--space-8)}
.office > .caption{padding:var(--space-3) var(--space-4) var(--space-5)}
.world{position:relative;width:100%;max-width:880px;aspect-ratio:620/440}
.world-svg{display:block;width:100%;height:100%}

.world [fill="#5E4532"]{fill:var(--world-floor)}
.world [stroke="#4A3526"]{stroke:color-mix(in srgb,var(--world-floor),#000 22%)}
.world [fill="#6B3A2E"]{fill:color-mix(in srgb,var(--world-floor),var(--failed) 18%)}
.world [fill="#8F6D4D"]{fill:var(--wall)}
.world [fill="#7A5B40"]{fill:color-mix(in srgb,var(--wall),#000 15%)}
.world [fill="#6B4E36"],.world [fill="#5A4130"]{fill:color-mix(in srgb,var(--wall),#000 30%)}
.world [fill="#A66D3B"]{fill:var(--wood)}
.world [fill="#C08350"]{fill:color-mix(in srgb,var(--wood),#fff 15%)}
.world [fill="#7E5029"]{fill:color-mix(in srgb,var(--wood),#000 25%)}
.world [stroke="#7E5029"]{stroke:color-mix(in srgb,var(--wood),#000 25%)}
.world [fill="#8E99A3"]{fill:var(--metal)}
.world [fill="#A9B3BC"]{fill:color-mix(in srgb,var(--metal),#fff 20%)}
.world [fill="#6E7882"]{fill:color-mix(in srgb,var(--metal),#000 20%)}
.world [fill="#0F1A17"]{fill:var(--screen-bg)}
.world [fill="#D8F0DF"]{fill:var(--screen-text)}
.world [fill="#92B0A1"]{fill:var(--screen-dim)}
.world [fill="#EFE3C8"]{fill:var(--paper)}
.world [fill="#F2E6CF"]{fill:var(--evidence-frame)}
.world [stroke="#120C08"]{stroke:var(--outline)}
.world .char [fill="#E8735C"]{fill:var(--agent-alpha)}
.world .char [fill="#9BC25A"]{fill:var(--agent-bravo)}
.world .char [fill="#6FA8F0"]{fill:var(--agent-report)}
.world .char [fill="#E58AC0"]{fill:var(--agent-runner)}

.world .glow,.world .lamp,.world .screen,.world .papers,.world .sel{display:none}
.world[data-mode="empty"] .char{display:none}
.world[data-mode="offline"] .char{opacity:.6;filter:grayscale(.6)}
.desk:is([data-state="planning"],[data-state="working"],[data-state="waiting"],[data-state="reviewing"],[data-state="blocked"]) :is(.glow,.lamp,.screen){display:inline}
.desk[data-state="planning"]{--sc:var(--state-planning)}
.desk[data-state="working"]{--sc:var(--state-working)}
.desk[data-state="waiting"]{--sc:var(--state-waiting)}
.desk[data-state="reviewing"]{--sc:var(--state-reviewing)}
.desk[data-state="blocked"]{--sc:var(--state-blocked)}
.desk .screen [fill="#4DBFB2"]{fill:var(--sc,var(--accent-primary))}
.desk[data-state="blocked"] :is(.lamp rect,.glow){fill:var(--blocked)}
.desk[data-state="completed"] .papers,.desk[data-desk="3"][data-state="completed"] .screen{display:inline}
.desk[data-selected="true"] .sel{display:inline;stroke:var(--selected)}

.sign,.tag{position:absolute;white-space:nowrap;pointer-events:none}
.sign{left:71%;top:31.8%;transform:translate(-50%,-50%);padding:2px 8px;background:var(--paper);color:#2A1F16;border:1px solid var(--outline);font:var(--type-agent-name);font-size:14px;line-height:18px}
.tag{transform:translate(-50%,-100%);display:inline-flex;align-items:center;gap:6px;padding:2px 8px;background:var(--panel-bg);border:1px solid var(--panel-border);box-shadow:var(--shadow-panel);font:var(--type-agent-name)}
.tag svg{color:var(--sc,var(--state-idle))}
.tag[data-selected="true"]{background:var(--panel-raised);border-color:var(--selected);box-shadow:var(--shadow-pixel)}
.tag[data-tag="1"]{left:39%;top:34.8%}
.tag[data-tag="2"]{left:63.5%;top:52%}
.tag[data-tag="3"]{left:21%;top:46.5%}
.tag[data-tag="4"]{left:45.5%;top:64.8%}
${STATES.map((s) => `.tag[data-state="${s}"]{--sc:var(--state-${s})}`).join("\n")}
.world[data-mode="empty"] .tag{display:none}

.detail-head{display:flex;flex-direction:column;gap:var(--space-2)}
.detail-head .agent-row .room-title{flex:1;min-width:0}
.block{display:flex;flex-direction:column;gap:var(--space-2)}
.screenlog{display:flex;flex-direction:column;gap:2px;padding:10px 12px;background:var(--screen-bg);color:var(--screen-text);font:var(--type-log)}
.screenlog span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.screenlog .t{color:var(--screen-dim)}
.flist{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:1px;background:var(--panel-raised);border:1px solid var(--panel-raised);border-radius:var(--radius-md);overflow:hidden}
.flist li{display:flex;flex-direction:column;gap:4px;padding:10px 12px;background:var(--panel-bg)}
.flist .frow{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
.flist .rule{font:var(--type-code);color:var(--accent-secondary)}
.flist .msg{font:var(--type-body-strong);overflow-wrap:anywhere}
.facts{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px var(--space-3)}
.facts dt{font:var(--type-label);color:var(--text-secondary)}
.facts dd{margin:0;overflow-wrap:anywhere}

.lower{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr));gap:var(--space-5);padding:0 var(--space-5) var(--space-6);align-items:start}
.shots{display:flex;flex-wrap:wrap;gap:var(--space-3)}
.evidence{margin:0;display:flex;flex-direction:column;width:216px}
.evidence .etag{align-self:flex-start;padding:4px 10px;background:var(--evidence-frame);color:#2A1F16;font:var(--type-status);letter-spacing:var(--type-status-tracking);text-transform:uppercase}
.evidence .eframe{padding:8px;background:var(--evidence-frame)}
.evidence img{display:block;width:100%;height:auto;background:var(--screen-bg)}
.evidence figcaption{margin-top:6px;font:var(--type-caption);color:var(--text-muted)}
.run-list{display:flex;flex-direction:column;gap:var(--space-2)}
.run{all:unset;box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--panel-raised);border-radius:var(--radius-md);cursor:pointer}
.run:hover{border-color:var(--panel-border)}
.run:focus-visible{box-shadow:var(--shadow-focus)}
.run[aria-pressed="true"]{background:var(--panel-raised);border-color:var(--selected)}
.run .frow{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
.run .id{font:var(--type-code);overflow-wrap:anywhere}
.empty{color:var(--text-muted)}

@media (max-width:640px){.topbar,.main{padding-left:var(--space-4);padding-right:var(--space-4)}.lower{padding-left:var(--space-4);padding-right:var(--space-4)}.world-wrap{padding:0 var(--space-2)}.nav{margin-left:0}.world .tag,.world .sign{display:none}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

export const APP_CSS = themeCss() + COMPONENT_CSS;

export const APP_JS = `
"use strict";
const $ = (id) => document.getElementById(id);
const STATES = ${JSON.stringify(STATES)};
const WORDS = { idle: "Idle", planning: "Planning", working: "Working", waiting: "Waiting", reviewing: "Reviewing", blocked: "Blocked", completed: "Completed", failed: "Failed", offline: "Offline", active: "Active" };
const view = { data: null, raw: "", runId: null, agent: null, offline: false, lastStates: {} };
const roster = () => (view.data && Array.isArray(view.data.agents) ? view.data.agents : []);

function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) { if (v == null) continue; if (k === "class") n.className = v; else n.setAttribute(k, v); }
  for (const kid of kids) if (kid != null) n.append(kid);
  return n;
}
function icon(name, size) {
  const src = $("icons").content.querySelector('[data-icon="' + name + '"]');
  const svg = src ? src.cloneNode(true) : document.createElement("span");
  svg.setAttribute("width", String(size || 12));
  svg.setAttribute("height", String(size || 12));
  return svg;
}
function badge(kind, value, word) {
  const name = kind === "sev" ? "severity-" + value : (value === "active" ? "working" : value);
  return el("span", { class: "badge " + kind + "-" + value }, icon(name, 12), word || WORDS[value] || value);
}
const safeState = (s) => (STATES.includes(s) ? s : "idle");
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const off = -d.getTimezoneOffset() / 60;
  const hh = (n) => String(n).padStart(2, "0");
  return hh(d.getHours()) + ":" + hh(d.getMinutes()) + ":" + hh(d.getSeconds()) + " UTC" + (off >= 0 ? "+" : "") + off;
}
const fmtDuration = (ms) => (ms == null ? "" : ms < 60000 ? Math.round(ms / 1000) + " s" : Math.floor(ms / 60000) + " min " + Math.round((ms % 60000) / 1000) + " s");

function currentRun() {
  const runs = view.data ? view.data.runs : [];
  return runs.find((r) => r.runId === view.runId) || runs[0] || null;
}
function agentFacts(run) {
  return roster().map((a) => {
    if (!run) return { ...a, state: view.offline ? "offline" : "idle", activity: "No event yet.", at: null };
    if (a.id === "report") {
      const n = run.findings.length;
      return { ...a, state: view.offline ? "offline" : "completed", activity: n ? n + (n === 1 ? " finding" : " findings") + " in this run." : "No findings in this run.", at: run.finishedAt || run.startedAt || null };
    }
    const p = run.players.find((x) => x.player === a.id);
    if (!p) return { ...a, state: view.offline ? "offline" : "idle", activity: "No event yet.", at: null };
    return { ...a, state: view.offline ? "offline" : safeState(p.status), activity: p.activity, at: p.at || null, known: safeState(p.status) };
  });
}

function renderTop(run) {
  const chip = $("mode-chip");
  chip.replaceChildren(icon(view.offline ? "offline" : "live", 12), view.offline ? "Offline" : "Live");
  chip.className = "badge " + (view.offline ? "m-offline" : "m-live");
  const banner = $("banner");
  if (view.offline) {
    banner.replaceChildren(icon("offline", 14), el("span", null, el("strong", null, "Offline. "), "The dashboard server is not reachable. Activity is unknown, not idle."));
    banner.hidden = false;
  } else banner.hidden = true;
  if (view.data) {
    $("meta").textContent = (view.offline ? "Last known " : "Local view, refreshed ") + fmtTime(view.data.generatedAt) + ". Observations, not confirmed bugs.";
  }
  $("nav-count").textContent = String(run ? run.findings.length : 0);
}

function renderRoster(facts) {
  $("roster-sub").textContent = facts.length ? facts.length + " on shift" : "";
  $("roster").replaceChildren(...facts.map((f) => {
    const b = el("button", { type: "button", class: "agent", "aria-pressed": String(f.id === view.agent), "data-key": "agent-" + f.id },
      el("span", { class: "agent-row" }, el("span", { class: "swatch id-" + f.desk }), el("span", { class: "agent-name" }, f.name), badge("s", f.state)),
      el("span", { class: "role" }, f.role),
      el("span", { class: "activity" }, f.activity));
    b.addEventListener("click", () => { view.agent = f.id; render(); });
    return b;
  }));
}

function renderWorld(run, facts) {
  const world = $("world");
  world.dataset.mode = view.offline ? "offline" : run ? "live" : "empty";
  for (const f of facts) {
    const desk = world.querySelector('[data-desk="' + f.desk + '"]');
    if (desk) { desk.setAttribute("data-state", f.state); desk.setAttribute("data-selected", String(f.id === view.agent)); }
    const tag = world.querySelector('[data-tag="' + f.desk + '"]');
    if (tag) {
      tag.setAttribute("data-state", f.state);
      tag.setAttribute("data-selected", String(f.id === view.agent));
      tag.replaceChildren(el("span", { class: "swatch id-" + f.desk }), f.name.length > 12 ? f.name.slice(0, 11) + "…" : f.name, icon(f.state, 12));
    }
  }
  $("world-svg").setAttribute("aria-label", run
    ? "The QA bullpen. " + facts.map((f) => f.name + " is " + (WORDS[f.state] || f.state).toLowerCase()).join(", ") + "."
    : "The QA bullpen with four empty desks. Lamps and monitors are off.");
  $("world-note").textContent = run ? "Lamps and monitors light only for open events." : "No run yet. Lamps and monitors stay off until a run writes artifacts.";
  $("office-run").textContent = run ? (run.scenario || "run") + " · " + fmtTime(run.startedAt) : "";
}

function renderDetail(run, facts) {
  const f = facts.find((x) => x.id === view.agent) || facts[0];
  if (!f) { $("detail").replaceChildren(el("p", { class: "empty" }, view.offline ? "Activity is unknown." : "Loading…")); return; }
  const mine = run ? run.findings.filter((x) => f.id === "report" || x.player === f.id) : [];
  const head = el("div", { class: "detail-head" },
    el("div", { class: "agent-row" }, el("span", { class: "swatch id-" + f.desk }), el("h2", { class: "room-title" }, f.name), badge("s", f.state)),
    el("span", { class: "role" }, f.role));
  const latest = el("div", { class: "block" }, el("h3", { class: "label" }, view.offline ? "Last known event" : "Latest event"),
    el("p", null, f.activity), f.at ? el("span", { class: "ts" }, fmtTime(f.at)) : null);
  const list = el("ul", { class: "flist" });
  for (const x of mine.slice(0, 5)) list.append(el("li", null, el("span", { class: "frow" }, badge("sev", x.severity), el("span", { class: "rule" }, x.ruleId), x.count > 1 ? el("span", { class: "mono" }, "×" + x.count) : null), el("span", { class: "msg" }, x.message)));
  const findings = el("div", { class: "block" }, el("h3", { class: "label" }, f.id === "report" ? "Findings in this run" : "Findings for " + f.name),
    mine.length ? list : el("p", { class: "empty" }, "No findings yet. When the observer reports one, it appears here."),
    mine.length > 5 ? el("a", { href: "#findings" }, "+" + (mine.length - 5) + " more") : null);
  const log = el("div", { class: "screenlog", "aria-label": "Latest event per agent" });
  for (const x of facts) log.append(el("span", null, el("span", { class: "t" }, (x.at ? fmtTime(x.at).slice(0, 8) : "--:--:--") + " "), x.id + "." + (x.known || x.state) + " " + x.activity));
  const runBlock = el("div", { class: "block" }, el("h3", { class: "label" }, "Run"));
  if (run) {
    runBlock.append(el("dl", { class: "facts" },
      el("dt", null, "Status"), el("dd", null, badge("s", run.status)),
      el("dt", null, "Scenario"), el("dd", null, run.scenario || "unknown"),
      el("dt", null, "Started"), el("dd", { class: "ts" }, fmtTime(run.startedAt) || "unknown"),
      el("dt", null, "Duration"), el("dd", null, fmtDuration(run.durationMs) || "unknown"),
      el("dt", null, "Ignored network failures"), el("dd", null, String(run.ignoredNetworkFailures))));
  } else runBlock.append(el("p", { class: "empty" }, "No run yet."));
  $("detail").replaceChildren(head, latest, findings, el("div", { class: "block" }, el("h3", { class: "label" }, "Event log"), log), runBlock);
}

function renderLower(run) {
  const fl = $("findings-list");
  $("findings-sub").textContent = run ? run.runId : "";
  if (!run || !run.findings.length) fl.replaceChildren(el("p", { class: "empty" }, "No findings yet. When an agent produces a real report, it appears here."));
  else {
    const ul = el("ul", { class: "flist" });
    for (const f of run.findings) ul.append(el("li", null,
      el("span", { class: "frow" }, badge("sev", f.severity), el("span", { class: "rule" }, f.ruleId), el("span", { class: "mono" }, (f.category === f.ruleId ? "" : f.category + " · ") + f.player + (f.count > 1 ? " · ×" + f.count : ""))),
      el("span", { class: "msg" }, f.message),
      el("span", { class: "mono" }, f.evidence.map((e) => e.file + (e.line ? "#" + e.line : "")).join(", "))));
    fl.replaceChildren(ul);
  }
  const shots = $("shots");
  if (!run || !run.screenshots.length) shots.replaceChildren(el("p", { class: "empty" }, "No approved screenshot for this run."));
  else shots.replaceChildren(...run.screenshots.map((s) => el("figure", { class: "evidence" },
    el("span", { class: "etag" }, "Evidence"),
    el("div", { class: "eframe" }, el("img", { src: s.url, alt: s.player + ": " + s.label, loading: "lazy" })),
    el("figcaption", null, s.player + " · " + s.label))));
  const rep = $("repeated");
  if (!view.data || !view.data.repeated.length) rep.replaceChildren(el("p", { class: "empty" }, "None. A finding shows here when it repeats across runs."));
  else {
    const ul = el("ul", { class: "flist" });
    for (const r of view.data.repeated) ul.append(el("li", null, el("span", { class: "frow" }, badge("sev", r.severity), el("span", { class: "rule" }, r.ruleId), el("span", { class: "mono" }, r.runs + " runs · " + r.occurrences + " occurrences")), el("span", { class: "msg" }, r.message)));
    rep.replaceChildren(ul);
  }
  const t = view.data ? view.data.totals : null;
  $("totals").textContent = t ? t.runs + " runs · " + t.findings + " findings" : "";
  const list = $("run-list");
  const runs = view.data ? view.data.runs : [];
  if (!runs.length) { list.replaceChildren(el("p", { class: "empty" }, "No runs found.")); return; }
  list.replaceChildren(...runs.map((r) => {
    const b = el("button", { type: "button", class: "run", "aria-pressed": String(run && r.runId === run.runId), "data-key": "run-" + r.runId },
      el("span", { class: "frow" }, badge("s", r.status), el("span", { class: "id" }, r.runId)),
      el("span", { class: "mono" }, r.findings.length + " findings" + (r.durationMs == null ? "" : " · " + fmtDuration(r.durationMs))));
    b.addEventListener("click", () => { view.runId = r.runId; render(); });
    return b;
  }));
}

function announce(facts) {
  const changed = facts.filter((f) => view.lastStates[f.id] && view.lastStates[f.id] !== f.state);
  for (const f of facts) view.lastStates[f.id] = f.state;
  if (changed.length) $("announce").textContent = changed.map((f) => f.name + ": " + (WORDS[f.state] || f.state).toLowerCase()).join(". ") + ".";
}

function render() {
  const focused = document.activeElement && document.activeElement.getAttribute("data-key");
  const run = currentRun();
  const facts = agentFacts(run);
  if (!view.agent && facts[0]) view.agent = facts[0].id;
  renderTop(run);
  renderRoster(facts);
  renderWorld(run, facts);
  renderDetail(run, facts);
  renderLower(run);
  announce(facts);
  if (focused) { const again = document.querySelector('[data-key="' + focused + '"]'); if (again) again.focus(); }
}

function initTheme() {
  const pick = $("theme");
  let saved = null;
  try { saved = localStorage.getItem("agent-office-theme"); } catch { saved = null; }
  if (saved && [...pick.options].some((o) => o.value === saved)) document.documentElement.dataset.theme = saved;
  pick.value = document.documentElement.dataset.theme;
  pick.addEventListener("change", () => {
    document.documentElement.dataset.theme = pick.value;
    try { localStorage.setItem("agent-office-theme", pick.value); } catch { /* per-viewer convenience only */ }
  });
}

async function tick() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (!r.ok) throw new Error("status " + r.status);
    const text = await r.text();
    const wasOffline = view.offline;
    view.offline = false;
    if (text === view.raw && !wasOffline) return;
    view.raw = text;
    view.data = JSON.parse(text);
  } catch {
    if (view.offline) return;
    view.offline = true;
  }
  render();
}
initTheme();
render();
tick(); setInterval(tick, 5000);
`;
