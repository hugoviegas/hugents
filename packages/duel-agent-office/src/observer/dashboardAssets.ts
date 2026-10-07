/**
 * Static dashboard files, in the Agent Office design system (Claude Design): tokens from `src/theme`, the
 * "Live office" layout and the QA bullpen world, wired to the office bridge (task board, live agents). No external resources (the CSP allows none, so the design
 * fonts fall back to the system stacks unless installed locally); all dynamic text is set with textContent.
 */
import { ICONS } from "../theme/icons.js";
import { DEFAULT_THEME, THEMES, themeCss } from "../theme/tokens.js";
import { GRID, MATERIALS, PROP_TYPES } from "../office/layout.js";
import { SPRITES_SVG, WORLD_SVG } from "./dashboardWorld.js";
import { LIVE_CSS, LIVE_ICONS, LIVE_JS } from "./liveDialogAssets.js";

// Editor tool glyphs, 7x7 like the design system's state icons.
const EDITOR_ICONS = {
  "tool-select": "M0 0h1v6h-1zM1 1h1v4h-1zM2 2h1v4h-1zM3 3h1v1h-1zM3 5h1v2h-1zM4 4h1v1h-1z",
  "tool-move": "M3 0h1v7h-1zM0 3h7v1h-7zM2 1h3v1h-3zM2 5h3v1h-3zM1 2h1v3h-1zM5 2h1v3h-1z",
  "tool-place": "M0 0h7v1h-7zM0 6h7v1h-7zM0 1h1v5h-1zM6 1h1v5h-1zM3 2h1v3h-1zM2 3h3v1h-3z",
  "tool-erase": "M3 0h3v1h-3zM2 1h1v1h-1zM6 1h1v2h-1zM1 2h1v1h-1zM5 3h1v1h-1zM0 3h1v2h-1zM4 4h1v1h-1zM1 5h3v1h-3zM0 6h7v1h-7z",
  "tool-rotate": "M2 0h3v1h-3zM1 1h1v1h-1zM5 1h1v1h-1zM0 2h1v3h-1zM4 2h3v1h-3zM6 3h1v1h-1zM1 5h1v1h-1zM5 5h1v1h-1zM2 6h3v1h-3z",
  "tool-recolor": "M3 0h1v1h-1zM2 1h3v1h-3zM1 2h5v1h-5zM0 3h7v2h-7zM1 5h5v1h-5zM2 6h3v1h-3z",
};

const ICON_TEMPLATES = Object.entries({ ...ICONS, ...EDITOR_ICONS, ...LIVE_ICONS })
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
<button type="button" id="edit-open" class="btn">Edit layout</button>
<a class="btn" href="#tasks">Tasks</a>
<a class="btn" href="#reports">Reports</a>
<a class="btn" href="#connections">Connections</a>
<button type="button" id="cleanup-btn" class="btn btn-danger" hidden></button>
<a class="btn" href="#findings">Findings <span id="nav-count" class="count">0</span></a>
<a class="btn" href="#runs">Runs</a>
<label class="theme-pick">Theme <select id="theme">${THEME_OPTIONS}</select></label>
</nav>
</header>
<div id="editbar" class="editbar" hidden>
<div class="brand"><span class="eyebrow">Agent Office</span><h2 class="title">Edit layout</h2></div>
<span id="edit-count" class="meta"></span>
<div class="nav"><button type="button" id="edit-discard" class="btn">Discard</button><button type="button" id="edit-save" class="btn btn-primary">Save layout</button></div>
</div>
<p id="edit-notice" class="notice" hidden>The editor changes how the office looks. It cannot change permissions, credentials, game logic or safety rules.</p>
<div id="banner" class="banner" role="status" hidden></div>
<p id="flash" class="notice" role="status" hidden></p>
<p id="announce" class="sr-only" aria-live="polite"></p>
<main class="main">
<aside id="rail" class="panel rail" aria-label="Editor tools" hidden></aside>
<aside id="roster-panel" class="panel roster" aria-labelledby="roster-h">
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
<div id="tags" aria-hidden="true"></div>
</div>
</div>
<p id="world-note" class="caption center"></p>
</section>
<aside id="detail" class="panel detail" aria-label="Selected agent"></aside>
<aside id="inspector" class="panel detail" aria-label="Selected prop" hidden></aside>
</main>
<div class="lower">
<section id="tasks" class="panel" aria-labelledby="tasks-h">
<div class="panel-head"><h2 id="tasks-h" class="room-title">Task board</h2><span id="tasks-sub" class="caption"></span></div>
<div id="task-list"></div>
</section>
<section id="reports" class="panel wide" aria-labelledby="reports-h">
<div class="panel-head"><h2 id="reports-h" class="room-title">Reports</h2><span id="reports-sub" class="caption"></span></div>
<form id="report-filters" class="filters" aria-label="Filter reports"></form>
<div class="reports-grid"><div id="report-list" class="report-list"></div><article id="report-view" class="report-view" aria-live="polite"></article></div>
</section>
<section id="connections" class="panel wide" aria-labelledby="connections-h">
<div class="panel-head"><h2 id="connections-h" class="room-title">Connections</h2><span id="connections-sub" class="caption"></span></div>
<p class="caption">Read-only. The office reads repositories to plan tests; it never writes to GitHub or to a checkout. A GITHUB_TOKEN set before starting the office is only for private repositories and rate limits.</p>
<div id="source-list" class="source-list"></div>
<form id="source-form" class="source-form" aria-label="Add a source"></form>
</section>
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
<div id="run-players" class="block"></div>
</section>
</div>
</div>
${SPRITES_SVG}
<template id="icons">
${ICON_TEMPLATES}
</template>
<script src="/app.js"></script>
</body>
</html>
`;

// Prop materials: the body of a prop (desk wood, shelf, cabinet, pot) takes the chosen ramp. Light, front, side faces.
const MATERIAL_RAMPS: Record<string, [string, string, string]> = {
  wood: ["color-mix(in srgb,var(--wood),#fff 15%)", "var(--wood)", "color-mix(in srgb,var(--wood),#000 25%)"],
  dark: ["color-mix(in srgb,var(--wood),#000 30%)", "color-mix(in srgb,var(--wood),#000 42%)", "color-mix(in srgb,var(--wood),#000 55%)"],
  metal: ["color-mix(in srgb,var(--metal),#fff 20%)", "var(--metal)", "color-mix(in srgb,var(--metal),#000 20%)"],
  paper: ["var(--paper)", "color-mix(in srgb,var(--paper),#000 12%)", "color-mix(in srgb,var(--paper),#000 25%)"],
};
const BASE_FILLS = [["#C08350", "#A66D3B", "#7E5029"], ["#A9B3BC", "#8E99A3", "#6E7882"]];
const MATERIAL_CSS = Object.entries(MATERIAL_RAMPS)
  .flatMap(([m, ramp]) => [
    ...BASE_FILLS.flatMap((family) => family.map((hex, i) => `.world .prop.mat-${m} .body [fill="${hex}"]{fill:${ramp[i]}}`)),
    `.world .prop.mat-${m} .body [stroke="#7E5029"]{stroke:${ramp[2]}}`,
  ])
  .join("\n");

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
.id-1{--c:var(--agent-alpha)}.id-2{--c:var(--agent-explorer)}.id-3{--c:var(--agent-analyst)}.id-4{--c:var(--agent-critic)}.id-5{--c:#E0A63F}.id-6{--c:#4DBFB2}

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
.world .char [fill="#9BC25A"]{fill:var(--agent-explorer)}
.world .char [fill="#6FA8F0"]{fill:var(--agent-analyst)}
.world .char [fill="#E58AC0"]{fill:var(--agent-critic)}

.world .glow,.world .lamp,.world .screen,.world .papers,.world .sel{display:none}
.world .desk[data-state="empty"] .char{display:none}
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
.desk[data-state="completed"] .papers{display:inline}
.desk[data-selected="true"] .sel{display:inline;stroke:var(--selected)}

.sign,.tag{position:absolute;white-space:nowrap;pointer-events:none}
.sign{left:71%;top:31.8%;transform:translate(-50%,-50%);padding:2px 8px;background:var(--paper);color:#2A1F16;border:1px solid var(--outline);font:var(--type-agent-name);font-size:14px;line-height:18px}
.tag{transform:translate(-50%,-100%);display:inline-flex;align-items:center;gap:6px;padding:2px 8px;background:var(--panel-bg);border:1px solid var(--panel-border);box-shadow:var(--shadow-panel);font:var(--type-agent-name)}
.tag svg{color:var(--sc,var(--state-idle))}
.tag[data-selected="true"]{background:var(--panel-raised);border-color:var(--selected);box-shadow:var(--shadow-pixel)}
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
${MATERIAL_CSS}
.swatch-btn.sw-wood{background:var(--wood)}.swatch-btn.sw-dark{background:color-mix(in srgb,var(--wood),#000 40%)}.swatch-btn.sw-metal{background:var(--metal)}.swatch-btn.sw-paper{background:var(--paper)}
.world.editing{outline:2px dashed var(--selected);outline-offset:6px;cursor:crosshair}
.world:not(.editing) .desk{cursor:pointer}
.grid path{fill:none;stroke:var(--text-muted);stroke-width:1;opacity:.45}
.ghost rect{stroke-width:1.5}
.ghost .ok{fill:color-mix(in srgb,var(--success) 18%,transparent);stroke:var(--success);stroke-dasharray:4 3}
.ghost .bad{stroke:var(--failed);opacity:.75}
.ghost .picked{fill:none;stroke:var(--selected);stroke-width:2}
#hatch rect{fill:var(--failed)}
.editbar{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-3) var(--space-5);padding:var(--space-3) var(--space-5);background:var(--panel-bg);border-bottom:1px solid var(--panel-border)}
.notice{display:flex;align-items:center;gap:var(--space-3);margin:0;padding:10px var(--space-5);background:var(--panel-raised);border-bottom:1px solid var(--panel-border);font:var(--type-label);font-weight:400}
.rail{flex:1 0 260px}
.tools{display:flex;flex-direction:column;gap:var(--space-1)}
.tool{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:var(--space-3);min-height:44px;padding:0 var(--space-3);border:1px solid transparent;border-radius:var(--radius-md);font:var(--type-label);cursor:pointer}
.tool:hover{border-color:var(--panel-border)}
.tool:focus-visible{box-shadow:var(--shadow-focus)}
.tool[aria-pressed="true"]{background:var(--accent-primary);color:var(--on-fill);box-shadow:var(--shadow-pixel)}
.tool:disabled{opacity:.5;cursor:not-allowed}
.kbd{margin-left:auto;min-width:24px;padding:1px 6px;border:1px solid currentColor;border-radius:var(--radius-sm);font:var(--type-timestamp);text-align:center;opacity:.8}
.shelf{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.shelf .btn{min-height:36px}
.btn.is-on{border-color:var(--selected);background:var(--panel-raised)}
.seg{display:grid;grid-template-columns:repeat(2,1fr);border:1px solid var(--panel-border);border-radius:var(--radius-md);overflow:hidden}
.seg button{all:unset;box-sizing:border-box;min-height:44px;text-align:center;font:var(--type-code);cursor:pointer}
.seg button+button{border-left:1px solid var(--panel-border)}
.seg button[aria-pressed="true"]{background:var(--accent-primary);color:var(--on-fill)}
.seg button:focus-visible{box-shadow:var(--shadow-focus)}
.swatches{display:flex;gap:var(--space-2)}
.swatch-btn{all:unset;box-sizing:border-box;width:48px;height:48px;border:2px solid var(--panel-border);border-radius:var(--radius-sm);cursor:pointer}
.swatch-btn[aria-pressed="true"]{border-color:var(--selected);box-shadow:var(--shadow-pixel)}
.swatch-btn:focus-visible{box-shadow:var(--shadow-focus)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)}
.pair label{display:flex;flex-direction:column;gap:var(--space-1);font:var(--type-label)}
.btn-danger{color:var(--failed);border-color:var(--failed)}
.btn-danger:hover{border-color:var(--failed);background:color-mix(in srgb,var(--failed) 12%,transparent)}
.undo{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-top:auto;padding-top:var(--space-3);border-top:1px solid var(--panel-raised)}
.banner .btn{min-height:32px;margin-left:auto}
.assign{display:flex;flex-direction:column;gap:var(--space-2)}
.field{width:100%;min-height:44px;padding:10px 12px;background:var(--bg);color:var(--text-primary);border:1px solid var(--panel-border);border-radius:var(--radius-md);font:var(--type-body);resize:vertical}
.field:disabled{opacity:.6}
.assign-row{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap}
.btn-primary{background:var(--accent-primary);border-color:var(--accent-primary);color:var(--on-fill);box-shadow:var(--shadow-pixel)}
.btn-primary:hover{border-color:var(--accent-primary)}
.btn:disabled{opacity:.5;cursor:not-allowed;border-style:dashed}
.form-note{font:var(--type-caption);color:var(--text-muted)}
.form-note.err{color:var(--failed)}
.tasks{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:1px;background:var(--panel-raised);border:1px solid var(--panel-raised);border-radius:var(--radius-md);overflow:hidden}
.tasks li{display:flex;flex-direction:column;gap:4px;padding:10px 12px;background:var(--panel-bg)}
.tasks .frow{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
.tasks .ttl{font:var(--type-body-strong);overflow-wrap:anywhere}
.tasks .sum{font:var(--type-label);font-weight:400;color:var(--text-secondary);overflow-wrap:anywhere}
.players{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.players li{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;font:var(--type-label);font-weight:400;color:var(--text-secondary)}

.panel.wide{grid-column:1/-1}
.tabs{display:grid;grid-template-columns:repeat(2,1fr);border:1px solid var(--panel-border);border-radius:var(--radius-md);overflow:hidden}
.tabs button{all:unset;box-sizing:border-box;min-height:44px;text-align:center;font:var(--type-label);cursor:pointer}
.tabs button+button{border-left:1px solid var(--panel-border)}
.tabs button[aria-pressed="true"]{background:var(--accent-primary);color:var(--on-fill)}
.tabs button:focus-visible{box-shadow:var(--shadow-focus)}
.cfg{display:flex;flex-direction:column;gap:var(--space-4)}
.cfg label.label{display:flex;flex-direction:column;gap:var(--space-1)}
.cfg .hint{font:var(--type-caption);color:var(--text-muted);font-weight:400}
.meter{font:var(--type-label);font-weight:400;color:var(--text-secondary)}
.checks{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.checks label{display:inline-flex;align-items:center;gap:var(--space-2);min-height:36px;padding:0 var(--space-3);border:1px solid var(--panel-border);border-radius:var(--radius-md);font:var(--type-code);cursor:pointer}
.checks input{margin:0}
.commands{display:flex;flex-direction:column;gap:var(--space-2)}
.commands .cmd{display:flex;flex-direction:column;gap:2px}
.filters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--space-3)}
.filters label{display:flex;flex-direction:column;gap:var(--space-1);font:var(--type-label)}
.filters .field{min-width:140px;width:auto}
.reports-grid{display:grid;grid-template-columns:minmax(260px,1fr) minmax(280px,2fr);gap:var(--space-5);align-items:start}
.report-list{display:flex;flex-direction:column;gap:var(--space-3);max-height:520px;overflow:auto}
.report-list h3{position:sticky;top:0;background:var(--panel-bg);padding:2px 0}
.report-item{all:unset;box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--panel-raised);border-radius:var(--radius-md);cursor:pointer}
.report-item:hover{border-color:var(--panel-border)}
.report-item:focus-visible{box-shadow:var(--shadow-focus)}
.report-item[aria-pressed="true"]{background:var(--panel-raised);border-color:var(--selected)}
.report-item .frow{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
.report-view{min-width:0;display:flex;flex-direction:column;gap:var(--space-2)}
.report-text{margin:0;padding:12px;background:var(--screen-bg);color:var(--screen-text);font:var(--type-log);white-space:pre-wrap;overflow-wrap:anywhere;max-height:520px;overflow:auto}
.source-list{display:flex;flex-direction:column;gap:var(--space-3)}
.source{display:flex;flex-direction:column;gap:var(--space-2);padding:12px;border:1px solid var(--panel-raised);border-radius:var(--radius-md)}
.source .frow{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
.source .summary{display:flex;flex-direction:column;gap:2px;font:var(--type-label);font-weight:400;color:var(--text-secondary)}
.source-form{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--space-3);margin-top:var(--space-3)}
.source-form label{display:flex;flex-direction:column;gap:var(--space-1);font:var(--type-label)}
.source-form .field{width:auto;min-width:160px}
@media (max-width:760px){.reports-grid{grid-template-columns:1fr}}
@media (max-width:640px){.topbar,.main{padding-left:var(--space-4);padding-right:var(--space-4)}.lower{padding-left:var(--space-4);padding-right:var(--space-4)}.world-wrap{padding:0 var(--space-2)}.nav{margin-left:0}.world .tag,.world .sign{display:none}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

export const APP_CSS = themeCss() + COMPONENT_CSS + LIVE_CSS;

export const APP_JS = `
"use strict";
const $ = (id) => document.getElementById(id);
const STATES = ${JSON.stringify(STATES)};
const WORDS = { queued: "Queued", idle: "Idle", planning: "Planning", working: "Working", waiting: "Waiting", reviewing: "Reviewing", blocked: "Blocked", completed: "Completed", failed: "Failed", offline: "Offline", active: "Active" };
const view = { data: null, raw: "", runId: null, agent: null, offline: false, lastStates: {}, drafts: {}, notes: {}, sending: false, edit: null,
  tab: "overview", cfg: {}, reportsKey: null, flashTimer: null, conn: { kind: "github", label: "", path: "", repo: "", ref: "" }, github: {},
  rep: { filters: { agent: "", severity: "", task: "", from: "", to: "" }, list: [], total: 0, open: null, text: "", built: false } };
const PROPS = ${JSON.stringify(PROP_TYPES)};
const GRID = ${JSON.stringify(GRID)};
const MATERIALS = ${JSON.stringify(MATERIALS)};
const MATERIAL_WORDS = { wood: "Wood", dark: "Dark wood", metal: "Metal", paper: "Paper" };
const TILE = 32;
const SVG_NS = document.getElementById("world-svg").namespaceURI;
const roster = () => (view.data && Array.isArray(view.data.agents) ? view.data.agents : []);

function svgEl(tag, props) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(props || {})) n.setAttribute(k, String(v));
  return n;
}
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
const office = () => (view.data && view.data.office) || null;
const savedLayout = () => (view.data && view.data.layout) || { version: 1, props: [] };
const layoutNow = () => (view.edit ? view.edit.draft : savedLayout());
const deskOf = (agentId) => layoutNow().props.find((p) => p.type === "desk" && p.agent === agentId) || null;
const readonlyOffice = () => !!(office() && office().readonly);
const bridgeUp = () => !view.offline && !!office() && office().connected;
const taskState = (t) => (t.status === "queued" ? "waiting" : safeState(t.status));
function agentFacts() {
  const o = office();
  return roster().map((a) => {
    const tasks = o ? o.tasks.filter((t) => t.agentId === a.id) : [];
    const task = tasks[0] || null;
    const events = o ? o.events.filter((e) => e.agentId === a.id) : [];
    const bridge = o ? o.agents.find((x) => x.id === a.id) : null;
    const known = task ? taskState(task) : "idle";
    const live = task && (task.status === "queued" || task.status === "working");
    const desk = deskOf(a.id);
    return {
      ...a, task, tasks, events, known, desk: desk ? desk.n : null,
      metrics: bridge && bridge.metrics ? bridge.metrics : null,
      busy: !!(bridge && bridge.busy) || !!live,
      state: bridgeUp() ? known : "offline",
      activity: task ? task.activity : "No task. Waiting for the next event.",
      at: events[0] ? events[0].at : task ? task.updatedAt : null,
    };
  });
}

function renderTop(run) {
  const up = bridgeUp();
  const chip = $("mode-chip");
  chip.replaceChildren(icon(up ? "live" : "offline", 12), up ? "Live" : "Offline");
  chip.className = "badge " + (up ? "m-live" : "m-offline");
  const banner = $("banner");
  if (!up) {
    const retry = el("button", { type: "button", class: "btn" }, "Retry");
    retry.addEventListener("click", () => tick());
    const why = view.offline
      ? "The Agent Office server is not reachable."
      : office() ? "Start the office with npm run office:start." : "This view was started without the office.";
    banner.replaceChildren(icon("offline", 14), el("span", null, el("strong", null, "Bridge offline. "), "Activity is unknown, not idle. " + why), retry);
    banner.hidden = false;
  } else banner.hidden = true;
  if (view.data) {
    const o = office();
    const last = o && o.events[0] ? o.events[0].at : null;
    $("meta").textContent = up
      ? "Bridge connected" + (last ? " · last event " + fmtTime(last) : " · no event yet")
      : "Last known " + fmtTime(view.data.generatedAt) + ".";
  }
  $("nav-count").textContent = String(run ? run.findings.length : 0);
  const stale = office() && up ? office().staleRunners || 0 : 0;
  const cleanup = $("cleanup-btn");
  cleanup.hidden = !stale || readonlyOffice();
  cleanup.textContent = "Clean up stuck runners (" + stale + ")";
}

function renderRoster(facts) {
  $("roster-sub").textContent = facts.length ? facts.length + " on shift" : "";
  $("roster").replaceChildren(...facts.map((f) => {
    const b = el("button", { type: "button", class: "agent", "aria-pressed": String(f.id === view.agent), "data-key": "agent-" + f.id },
      el("span", { class: "agent-row" }, el("span", { class: "swatch id-" + f.look }), el("span", { class: "agent-name" }, f.name), badge("s", f.state)),
      el("span", { class: "role" }, f.role),
      el("span", { class: "activity" }, f.activity));
    b.addEventListener("click", () => { view.agent = f.id; render(); });
    return b;
  }));
}

const fp = (p) => (p.rot === 90 ? { w: PROPS[p.type].h, h: PROPS[p.type].w } : { w: PROPS[p.type].w, h: PROPS[p.type].h });
const toScreen = (x, y) => [TILE * (x - y), (TILE / 2) * (x + y)];
const depth = (p) => (PROPS[p.type].blocking ? 100 : 0) + p.x + p.y + (fp(p).w + fp(p).h) / 2;
const propName = (p) => (p.type === "desk" ? "Desk " + p.n : PROPS[p.type].label);

function covers(p, x, y) {
  const f = fp(p);
  return x >= p.x && x < p.x + f.w && y >= p.y && y < p.y + f.h;
}
function propAt(layout, tile) {
  if (!tile) return null;
  const hits = layout.props.filter((p) => covers(p, tile.x, tile.y)).sort((a, b) => depth(b) - depth(a));
  return hits[0] || null;
}
function fits(layout, prop) {
  const f = fp(prop);
  if (prop.x < 0 || prop.y < 0 || prop.x + f.w > GRID.w || prop.y + f.h > GRID.h) return "Outside the room";
  if (!PROPS[prop.type].blocking) return "";
  for (const o of layout.props) {
    if (o.id === prop.id || !PROPS[o.type].blocking) continue;
    const g = fp(o);
    if (prop.x < o.x + g.w && o.x < prop.x + f.w && prop.y < o.y + g.h && o.y < prop.y + f.h) return "Overlaps " + propName(o);
  }
  return "";
}

function propNode(p, facts) {
  const [sx, sy] = toScreen(p.x, p.y);
  const g = svgEl("g", { class: "prop mat-" + p.material + (p.type === "desk" ? " desk" : ""), "data-id": p.id, transform: "translate(" + sx + " " + sy + ")" + (p.rot === 90 ? " scale(-1 1)" : "") });
  const src = $("sprites").querySelector('[data-sprite="' + p.type + '"]');
  if (!src || !src.firstElementChild) return g;
  const body = src.firstElementChild.cloneNode(true);
  g.append(body);
  if (p.type === "desk") {
    const f = facts.find((x) => x.id === p.agent);
    g.setAttribute("data-state", f ? f.state : "empty");
    g.setAttribute("data-selected", String(!view.edit && !!f && f.id === view.agent));
    const slot = body.querySelector(".char");
    const look = f ? $("sprites").querySelector('[data-sprite="char-' + f.look + '"]') : null;
    if (slot && look) for (const part of look.children) slot.append(part.cloneNode(true));
  }
  return g;
}

function renderTags(facts) {
  const box = $("world-svg").viewBox.baseVal;
  const tags = [];
  for (const f of facts) {
    const d = deskOf(f.id);
    if (!d) continue;
    const [sx, sy] = toScreen(d.x, d.y);
    const left = ((sx + (d.rot === 90 ? 6 : -6) - box.x) / box.width) * 100;
    const top = ((sy - 15 - box.y) / box.height) * 100;
    const tag = el("span", { class: "tag", "data-state": f.state, "data-selected": String(!view.edit && f.id === view.agent) },
      el("span", { class: "swatch id-" + f.look }), f.name.length > 12 ? f.name.slice(0, 11) + "…" : f.name, icon(f.state, 12));
    tag.style.left = left.toFixed(2) + "%";
    tag.style.top = top.toFixed(2) + "%";
    tags.push(tag);
  }
  $("tags").replaceChildren(...tags);
}

function renderGrid() {
  const grid = $("grid");
  if (!view.edit) { grid.replaceChildren(); return; }
  let d = "";
  for (let x = 0; x <= GRID.w; x++) d += "M" + x * TILE + " 0V" + GRID.h * TILE;
  for (let y = 0; y <= GRID.h; y++) d += "M0 " + y * TILE + "H" + GRID.w * TILE;
  grid.replaceChildren(svgEl("path", { d }));
}

function footRect(p, cls) {
  const f = fp(p);
  const r = svgEl("rect", { class: cls, x: p.x * TILE, y: p.y * TILE, width: f.w * TILE, height: f.h * TILE });
  if (cls === "bad") r.setAttribute("fill", "url(#hatch)");
  return r;
}

function ghostProp() {
  const e = view.edit;
  if (!e || !e.hover) return null;
  if (e.tool === "place") return { id: "ghost", type: e.place, x: e.hover.x, y: e.hover.y, rot: 0, material: "wood" };
  const sel = e.sel && e.draft.props.find((p) => p.id === e.sel);
  if (e.tool === "move" && sel) return { ...sel, x: e.hover.x, y: e.hover.y };
  return null;
}

function renderGhost() {
  const layer = $("ghost");
  const e = view.edit;
  if (!e) { layer.replaceChildren(); return; }
  const parts = [];
  const sel = e.sel && e.draft.props.find((p) => p.id === e.sel);
  if (sel) parts.push(footRect(sel, "picked"));
  const g = ghostProp();
  if (g) parts.push(footRect(g, fits(e.draft, g) ? "bad" : "ok"));
  layer.replaceChildren(...parts);
}

function renderWorld(run, facts) {
  const world = $("world");
  world.dataset.mode = bridgeUp() ? "live" : office() || view.offline ? "offline" : "empty";
  world.classList.toggle("editing", !!view.edit);
  const lay = layoutNow();
  $("props").replaceChildren(...[...lay.props].sort((a, b) => depth(a) - depth(b)).map((p) => propNode(p, facts)));
  renderTags(facts);
  renderGrid();
  renderGhost();
  $("world-svg").setAttribute("aria-label", "The QA bullpen. " + facts.map((f) => f.name + (f.desk ? " at desk " + f.desk : " without a desk") + " is " + (WORDS[f.state] || f.state).toLowerCase()).join(", ") + ".");
  $("world-note").textContent = view.edit
    ? "Grid on · " + GRID.w + " × " + GRID.h + " tiles. Pick a tool, then click a tile."
    : bridgeUp()
      ? (facts.some((f) => f.task) ? "Lamps and monitors light only for open tasks." : "Desks lit by real work. Assign a task to start.")
      : "Bridge offline: lamps are off because activity is unknown.";
  $("office-run").textContent = run ? "Latest run: " + (run.scenario || "run") + " · " + fmtTime(run.startedAt) : "";
}

function assignForm(f) {
  const o = office();
  const readonly = !!(o && o.readonly);
  const blocked = readonly ? "The office is read-only." : !bridgeUp() ? "Start the bridge to assign tasks." : f.busy ? f.name + " is working. Wait for the task to finish." : "";
  const input = el("textarea", { id: "task-title", class: "field", rows: "2", maxlength: "200", "data-key": "task-title", placeholder: "Describe the task, for example: Check the Missions screen" });
  input.value = view.drafts[f.id] || "";
  input.addEventListener("input", () => { view.drafts[f.id] = input.value; });
  const button = el("button", { type: "submit", class: "btn btn-primary", "data-key": "task-send" }, "Assign to " + f.name);
  if (blocked || view.sending) { input.disabled = blocked !== ""; button.disabled = true; }
  const note = view.notes[f.id];
  const form = el("form", { class: "assign", "aria-label": "Assign a task to " + f.name },
    el("label", { class: "label", for: "task-title" }, "Assign a task"), input,
    el("div", { class: "assign-row" }, button, el("span", { class: "form-note" + (note && note.err ? " err" : ""), role: "status" }, blocked || (note ? note.text : ""))));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title || view.sending) return;
    view.sending = true;
    view.notes[f.id] = { text: "Sending…" };
    render();
    try {
      const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: f.id, title }) });
      const body = await r.json().catch(() => ({}));
      if (r.ok) { view.drafts[f.id] = ""; view.notes[f.id] = { text: "Task assigned." }; }
      else view.notes[f.id] = { text: body.error || "The task was not assigned.", err: true };
    } catch {
      view.notes[f.id] = { text: "The Agent Office server is not reachable.", err: true };
    }
    view.sending = false;
    await tick(true);
  });
  return form;
}

function openLink(file) {
  const b = el("button", { type: "button", class: "btn", "data-key": "open-" + file }, "Open report");
  b.addEventListener("click", () => { openReport(file); $("reports").scrollIntoView({ block: "start" }); });
  return b;
}
function taskItem(t, withAgent) {
  const who = withAgent ? roster().find((a) => a.id === t.agentId) : null;
  return el("li", null,
    el("span", { class: "frow" }, badge("s", taskState(t), t.status === "queued" ? WORDS.queued : null),
      who ? el("span", { class: "swatch id-" + who.look }) : null, who ? el("span", { class: "label" }, who.name) : null,
      el("span", { class: "ts" }, fmtTime(t.updatedAt))),
    el("span", { class: "ttl" }, t.title),
    el("span", { class: "sum" }, t.summary || t.activity),
    t.reportPath || t.runId ? el("span", { class: "mono" }, [t.reportPath ? "Report " + t.reportPath : null, t.runId ? "Run " + t.runId : null, t.usedFallback ? "template text" : null].filter(Boolean).join(" · ")) : null,
    t.reportPath ? openLink(t.reportPath) : null);
}

const SEV_WORDS = { none: "No findings", low: "Low", medium: "Medium", high: "High" };
const settings = () => (view.data && view.data.settings) || null;
const cfgSaved = (id) => { const s = settings(); return s && s.configs[id] ? s.configs[id] : null; };
function cfgDraft(id) {
  if (!view.cfg[id]) { const c = cfgSaved(id); if (!c) return null; view.cfg[id] = clone(c); }
  return view.cfg[id];
}
const cfgDirty = (id) => !!view.cfg[id] && JSON.stringify(view.cfg[id]) !== JSON.stringify(cfgSaved(id));
async function postJson(url, body) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "The Agent Office server is not reachable." } };
  }
}
function flash(text) {
  const n = $("flash");
  n.textContent = text;
  n.hidden = false;
  clearTimeout(view.flashTimer);
  view.flashTimer = setTimeout(() => { n.hidden = true; }, 7000);
}
const whole = (v) => Math.max(0, Math.floor(Number(v) || 0));

function field(label, control, hint) {
  return el("label", { class: "label" }, label, control, hint ? el("span", { class: "hint" }, hint) : null);
}

function editForm(f) {
  const d = cfgDraft(f.id);
  if (!d) return el("p", { class: "empty" }, view.offline ? "Settings are not available while the office is unreachable." : "Loading settings…");
  const ro = readonlyOffice();
  const s = settings();
  const q = d.quota;
  const used = (s && s.usage[f.id]) || { tasks: 0, tokens: 0 };
  const note = view.notes["cfg-" + f.id];
  const save = el("button", { type: "submit", class: "btn btn-primary", "data-key": "cfg-save" }, "Save " + f.name);
  const discard = el("button", { type: "button", class: "btn", "data-key": "cfg-discard" }, "Discard changes");
  const sync = () => { save.disabled = ro || !cfgDirty(f.id) || !d.objective.trim(); discard.disabled = !cfgDirty(f.id); };

  const objective = el("textarea", { class: "field", rows: "3", maxlength: "300", "data-key": "cfg-objective" });
  objective.value = d.objective;
  objective.addEventListener("input", () => { d.objective = objective.value; sync(); });
  const skill = el("textarea", { class: "field", rows: "6", maxlength: "2000", "data-key": "cfg-skill" });
  skill.value = d.skill;
  skill.addEventListener("input", () => { d.skill = skill.value; sync(); });
  const tasks = el("input", { class: "field", type: "number", min: "0", max: "500", step: "1", "data-key": "cfg-tasks" });
  tasks.value = String(q.maxTasksPerDay);
  tasks.addEventListener("input", () => { q.maxTasksPerDay = whole(tasks.value); sync(); });
  const tokens = el("input", { class: "field", type: "number", min: "0", max: "5000000", step: "1000", "data-key": "cfg-tokens" });
  tokens.value = String(q.maxTokensPerDay);
  tokens.addEventListener("input", () => { q.maxTokensPerDay = whole(tokens.value); sync(); });
  const focus = el("input", { class: "field", type: "text", maxlength: "300", "data-key": "cfg-focus", placeholder: "For example: only the Missions tabs" });
  focus.value = d.scope.focus;
  focus.addEventListener("input", () => { d.scope.focus = focus.value; sync(); });
  for (const c of [objective, skill, tasks, tokens, focus]) if (ro) c.disabled = true;

  const parts = [
    field("Objective", objective, "What this agent is trying to find out. It is the task text when you run a command, and it heads every report."),
    field("Skill", skill, "Extra instructions for how this agent writes its report. It cannot change tools, scenarios or safety rules."),
    el("div", { class: "pair" }, field("Tasks per day", tasks, "0 means no limit"), field("Tokens per day", tokens, "0 means no limit")),
    el("p", { class: "meter" }, "Today: " + used.tasks + (q.maxTasksPerDay ? " of " + q.maxTasksPerDay : "") + " tasks, " + used.tokens + (q.maxTokensPerDay ? " of " + q.maxTokensPerDay : "") + " tokens"),
  ];
  if (f.id === "explorer" && s) {
    const box = el("div", { class: "checks", role: "group", "aria-label": "Screens to tour" });
    for (const name of s.screens) {
      const cb = el("input", { type: "checkbox", "data-key": "cfg-screen-" + name });
      cb.checked = d.scope.screens.includes(name);
      if (ro) cb.disabled = true;
      cb.addEventListener("change", () => {
        d.scope.screens = cb.checked ? [...d.scope.screens, name] : d.scope.screens.filter((x) => x !== name);
        sync();
      });
      box.append(el("label", null, cb, name));
    }
    parts.push(el("div", { class: "block" }, el("span", { class: "label" }, "Screens to tour"), box, el("span", { class: "hint" }, "None ticked means all screens. The runner reads this when the next round starts.")));
  }
  parts.push(field("Focus", focus, "Free text for the report writer. It does not limit what the runner does."));
  const form = el("form", { class: "cfg", "aria-label": "Edit " + f.name }, ...parts,
    el("div", { class: "assign-row" }, save, discard, el("span", { class: "form-note" + (note && note.err ? " err" : ""), role: "status" }, ro ? "The office is read-only." : note ? note.text : "")));
  sync();
  discard.addEventListener("click", () => { delete view.cfg[f.id]; view.notes["cfg-" + f.id] = { text: "Changes discarded." }; render(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    view.notes["cfg-" + f.id] = { text: "Saving…" };
    save.disabled = true;
    const r = await postJson("/api/agent-config", { agentId: f.id, config: d });
    if (r.ok) { delete view.cfg[f.id]; view.notes["cfg-" + f.id] = { text: "Saved. The next task uses these settings." }; }
    else view.notes["cfg-" + f.id] = { text: r.data.error || "The settings were not saved.", err: true };
    await tick(true);
    render();
  });
  return form;
}

async function runCommand(f, cmd) {
  view.sending = true;
  view.notes[f.id] = { text: "Sending…" };
  render();
  const r = await postJson("/api/tasks", { agentId: f.id, command: cmd.id });
  view.notes[f.id] = r.ok ? { text: cmd.label + ": task assigned." } : { text: r.data.error || "The task was not assigned.", err: true };
  view.sending = false;
  await tick(true);
}

async function stopRound(f) {
  const r = await postJson("/api/stop", { agentId: f.id });
  flash(r.ok ? f.name + ": stopping. The runner and its browser are being closed." : (r.data.error || "Nothing was stopped."));
  await tick(true);
}

function commandsBlock(f) {
  const s = settings();
  const cmds = s && s.commands[f.id] ? s.commands[f.id] : [];
  const cfg = cfgSaved(f.id);
  const why = readonlyOffice() ? "The office is read-only." : !bridgeUp() ? "Start the bridge to run commands." : f.busy ? f.name + " is working." : "";
  const note = view.notes[f.id];
  const box = el("div", { class: "block" }, el("h3", { class: "label" }, "Commands"));
  if (cfg) box.append(el("p", { class: "activity" }, "Objective: " + cfg.objective));
  const list = el("div", { class: "commands" });
  for (const c of cmds) {
    const b = el("button", { type: "button", class: "btn btn-primary", "data-key": "cmd-" + c.id }, c.label);
    if (why || view.sending) b.disabled = true;
    b.addEventListener("click", () => runCommand(f, c));
    list.append(el("div", { class: "cmd" }, b, el("span", { class: "form-note" }, c.hint)));
  }
  box.append(list);
  if (f.busy && !readonlyOffice() && bridgeUp()) {
    const stop = el("button", { type: "button", class: "btn btn-danger", "data-key": "stop" }, "Stop round");
    stop.addEventListener("click", () => stopRound(f));
    box.append(stop, el("span", { class: "form-note" }, s && s.sharedRun.includes(f.id) ? "This round is shared with the other player, so stopping it stops both." : "Closes the runner and its browser. The report is marked as interrupted."));
  }
  box.append(el("span", { class: "form-note" + (note && note.err ? " err" : ""), role: "status" }, why || (note ? note.text : "")));
  return box;
}

function renderDetail(run, facts) {
  const f = facts.find((x) => x.id === view.agent) || facts[0];
  if (!f) { $("detail").replaceChildren(el("p", { class: "empty" }, view.offline ? "Activity is unknown." : "Loading…")); return; }
  const head = el("div", { class: "detail-head" },
    el("div", { class: "agent-row" }, el("span", { class: "swatch id-" + f.look }), el("h2", { class: "room-title" }, f.name), badge("s", f.state)),
    el("span", { class: "role" }, f.role + (f.desk ? " · Desk " + f.desk : " · No desk")));
  const watch = liveButtonFor(f);
  if (watch) head.append(watch);
  const current = el("div", { class: "block" }, el("h3", { class: "label" }, bridgeUp() ? "Current task" : "Last known task"));
  if (f.task) current.append(el("p", null, f.task.title), el("p", { class: "activity" }, f.activity), el("span", { class: "ts" }, "Started " + fmtTime(f.task.createdAt)));
  else current.append(el("p", { class: "empty" }, "No task. Waiting for the next event."));
  const log = el("div", { class: "screenlog", "aria-label": "Latest events for " + f.name });
  if (f.events.length) for (const e of f.events.slice(0, 5)) log.append(el("span", null, el("span", { class: "t" }, (fmtTime(e.at).slice(0, 8) || "--:--:--") + " "), (e.tool ? e.tool + " " : "") + e.activity));
  else log.append(el("span", null, el("span", { class: "t" }, "--:--:-- "), "No event yet."));
  const earlier = f.tasks.slice(1, 4);
  const history = el("div", { class: "block" }, el("h3", { class: "label" }, "Earlier tasks"),
    earlier.length ? el("ul", { class: "tasks" }, ...earlier.map((t) => taskItem(t, false))) : el("p", { class: "empty" }, "None yet."));
  const m = f.metrics;
  const stats = m ? el("dl", { class: "facts" },
    el("dt", null, "Completed"), el("dd", null, String(m.tasksCompleted)),
    el("dt", null, "Blocked"), el("dd", null, String(m.tasksBlocked)),
    el("dt", null, "Reputation"), el("dd", null, Math.round(m.reputation * 100) + "%")) : null;
  const tab = (id, text) => {
    const b = el("button", { type: "button", "aria-pressed": String(view.tab === id), "data-key": "tab-" + id }, text);
    b.addEventListener("click", () => { view.tab = id; render(); });
    return b;
  };
  const tabs = el("div", { class: "tabs", role: "group", "aria-label": "Agent view" }, tab("overview", "Overview"), tab("edit", "Edit agent"));
  if (view.tab === "edit") { $("detail").replaceChildren(head, tabs, editForm(f)); return; }
  const custom = assignForm(f);
  custom.querySelector("label").textContent = "Custom task";
  const parts = [head, tabs, current, commandsBlock(f), custom, el("div", { class: "block" }, el("h3", { class: "label" }, "Event log"), log), history];
  if (stats) parts.push(el("div", { class: "block" }, el("h3", { class: "label" }, "Record"), stats));
  $("detail").replaceChildren(...parts);
}

// ---- Reports: organised by day, filtered by agent, task, severity and date.
function reportQuery() {
  const f = view.rep.filters;
  const q = new URLSearchParams();
  for (const k of ["agent", "severity", "task", "from", "to"]) if (f[k]) q.set(k, f[k]);
  return q.toString();
}
async function loadReports() {
  try {
    const r = await fetch("/api/reports?" + reportQuery(), { cache: "no-store" });
    if (!r.ok) throw new Error("status " + r.status);
    const body = await r.json();
    view.rep.list = Array.isArray(body.reports) ? body.reports : [];
    view.rep.total = body.total || 0;
  } catch {
    view.rep.list = [];
    view.rep.total = 0;
  }
  renderReports();
}
async function openReport(file) {
  view.rep.open = file;
  view.rep.text = "Loading…";
  renderReports();
  try {
    const r = await fetch("/api/report?" + new URLSearchParams({ file }), { cache: "no-store" });
    const body = await r.json().catch(() => ({}));
    view.rep.text = r.ok && typeof body.text === "string" ? body.text : "This report could not be read.";
  } catch {
    view.rep.text = "The Agent Office server is not reachable.";
  }
  renderReports();
}
function buildReportFilters() {
  const form = $("report-filters");
  const sel = (key, label, options) => {
    const s = el("select", { class: "field", "data-key": "rf-" + key }, ...options.map(([v, t]) => el("option", { value: v }, t)));
    s.value = view.rep.filters[key];
    s.addEventListener("change", () => { view.rep.filters[key] = s.value; loadReports(); });
    return el("label", null, label, s);
  };
  const txt = (key, label, type, placeholder) => {
    const i = el("input", { class: "field", type, "data-key": "rf-" + key, placeholder: placeholder || null });
    i.value = view.rep.filters[key];
    i.addEventListener("change", () => { view.rep.filters[key] = i.value.trim(); loadReports(); });
    return el("label", null, label, i);
  };
  const clear = el("button", { type: "button", class: "btn" }, "Clear filters");
  clear.addEventListener("click", () => { view.rep.filters = { agent: "", severity: "", task: "", from: "", to: "" }; buildReportFilters(); loadReports(); });
  form.replaceChildren(
    sel("agent", "Agent", [["", "All agents"], ...roster().map((a) => [a.id, a.name])]),
    sel("severity", "Severity", [["", "Any"], ["high", "High"], ["medium", "Medium"], ["low", "Low"], ["none", "No findings"]]),
    txt("task", "Task", "search", "Task id or words"),
    txt("from", "From", "date"), txt("to", "To", "date"), clear);
  form.onsubmit = (event) => event.preventDefault();
  view.rep.built = true;
}
function renderReports() {
  const rep = view.rep;
  $("reports-sub").textContent = rep.total ? (rep.list.length < rep.total ? rep.list.length + " of " + rep.total : rep.total) + (rep.total === 1 ? " report" : " reports") : "";
  const list = $("report-list");
  if (!rep.list.length) list.replaceChildren(el("p", { class: "empty" }, Object.values(rep.filters).some(Boolean) ? "No report matches these filters." : "No reports yet. Run a command on an agent and its report appears here."));
  else {
    const days = new Map();
    for (const r of rep.list) { if (!days.has(r.day)) days.set(r.day, []); days.get(r.day).push(r); }
    const nodes = [];
    for (const [d, items] of days) {
      nodes.push(el("h3", { class: "label" }, d + " · " + items.length));
      for (const r of items) {
        const who = roster().find((a) => a.id === r.agentId);
        const b = el("button", { type: "button", class: "report-item", "aria-pressed": String(r.file === rep.open), "data-key": "report-" + r.file },
          el("span", { class: "frow" }, who ? el("span", { class: "swatch id-" + who.look }) : null, el("span", { class: "label" }, who ? who.name : r.agentId),
            r.severity === "none" ? el("span", { class: "mono" }, SEV_WORDS.none) : badge("sev", r.severity),
            r.interrupted ? badge("s", "blocked", "Interrupted") : null, el("span", { class: "ts" }, fmtTime(r.at))),
          el("span", { class: "ttl" }, r.taskTitle || r.title),
          el("span", { class: "mono" }, [r.findings ? r.findings + (r.findings === 1 ? " finding" : " findings") : null, r.runId ? "Run " + r.runId : null].filter(Boolean).join(" · ")));
        b.addEventListener("click", () => openReport(r.file));
        nodes.push(b);
      }
    }
    list.replaceChildren(...nodes);
  }
  const viewer = $("report-view");
  if (!rep.open) viewer.replaceChildren(el("p", { class: "empty" }, "Pick a report to read it."));
  else viewer.replaceChildren(el("h3", { class: "label" }, rep.open), el("pre", { class: "report-text" }, rep.text));
}

// ---- Connections: read-only sources (local checkouts and GitHub repositories).
async function saveSources(next, doneText) {
  const r = await postJson("/api/connections", next);
  flash(r.ok ? doneText : (r.data.error || "The sources were not saved."));
  await tick(true);
  return r.ok;
}
async function checkSource(id) {
  view.github[id] = { loading: true };
  render();
  try {
    const r = await fetch("/api/github?" + new URLSearchParams({ source: id }), { cache: "no-store" });
    const body = await r.json().catch(() => ({}));
    view.github[id] = r.ok ? { data: body } : { error: body.error || "The source could not be read." };
  } catch {
    view.github[id] = { error: "The Agent Office server is not reachable." };
  }
  render();
}
function summaryNode(g) {
  if (!g) return null;
  if (g.loading) return el("p", { class: "form-note" }, "Reading…");
  if (g.error) return el("p", { class: "form-note err" }, g.error);
  const d = g.data;
  const rows = [];
  rows.push(el("span", null, (d.branch ? "Branch " + d.branch : "Branch unknown") + (d.changedFiles ? " · " + d.changedFiles + " changed file(s)" : "") + (d.description ? " · " + d.description : "")));
  for (const c of (d.commits || []).slice(0, 5)) rows.push(el("span", { class: "mono" }, c.sha + " " + c.subject));
  for (const p of d.pulls || []) rows.push(el("span", null, "PR #" + p.number + " ", p.url ? el("a", { href: p.url, target: "_blank", rel: "noreferrer noopener" }, p.title) : p.title, p.author ? " · " + p.author : ""));
  for (const i of d.issues || []) rows.push(el("span", null, "Issue #" + i.number + " ", i.url ? el("a", { href: i.url, target: "_blank", rel: "noreferrer noopener" }, i.title) : i.title));
  return el("div", { class: "summary" }, ...rows);
}
function renderConnections() {
  const s = settings();
  const c = s ? s.connections : { sources: [] };
  const ro = readonlyOffice();
  $("connections-sub").textContent = c.sources.length ? c.sources.length + (c.sources.length === 1 ? " source" : " sources") : "";
  const list = $("source-list");
  if (!c.sources.length) list.replaceChildren(el("p", { class: "empty" }, "No source yet. Add the game's repository so the Test Planner can read its code."));
  else list.replaceChildren(...c.sources.map((src) => {
    const isGame = c.gameSource === src.id;
    const check = el("button", { type: "button", class: "btn", "data-key": "check-" + src.id }, "Check");
    check.addEventListener("click", () => checkSource(src.id));
    const use = el("button", { type: "button", class: "btn" + (isGame ? " is-on" : ""), "aria-pressed": String(isGame), "data-key": "use-" + src.id }, isGame ? "Game's code" : "Use as the game's code");
    use.disabled = ro || isGame;
    use.addEventListener("click", () => saveSources({ sources: c.sources, gameSource: src.id }, src.label + " is now the game's code."));
    const remove = el("button", { type: "button", class: "btn btn-danger", "data-key": "remove-" + src.id }, "Remove");
    remove.disabled = ro;
    remove.addEventListener("click", () => {
      delete view.github[src.id];
      saveSources({ sources: c.sources.filter((x) => x.id !== src.id), ...(c.gameSource && c.gameSource !== src.id ? { gameSource: c.gameSource } : {}) }, src.label + " removed.");
    });
    return el("div", { class: "source" },
      el("span", { class: "frow" }, el("strong", null, src.label), el("span", { class: "mono" }, src.kind === "github" ? "GitHub · " + src.repo + (src.ref ? "@" + src.ref : "") : "Local · " + src.path)),
      el("div", { class: "shelf" }, check, use, remove), summaryNode(view.github[src.id]));
  }));
  const form = $("source-form");
  const d = view.conn;
  const kind = el("select", { class: "field", "data-key": "src-kind" }, el("option", { value: "github" }, "GitHub repository"), el("option", { value: "local" }, "Folder on this machine"));
  kind.value = d.kind;
  kind.addEventListener("change", () => { d.kind = kind.value; renderConnections(); });
  const label = el("input", { class: "field", type: "text", maxlength: "60", "data-key": "src-label", placeholder: "Label (optional)" });
  label.value = d.label;
  label.addEventListener("input", () => { d.label = label.value; });
  const main = el("input", { class: "field", type: "text", maxlength: "300", "data-key": "src-main", placeholder: d.kind === "github" ? "owner/name" : "Absolute folder path" });
  main.value = d.kind === "github" ? d.repo : d.path;
  main.addEventListener("input", () => { if (d.kind === "github") d.repo = main.value; else d.path = main.value; });
  const ref = el("input", { class: "field", type: "text", maxlength: "100", "data-key": "src-ref", placeholder: "Branch or tag (optional)" });
  ref.value = d.ref;
  ref.addEventListener("input", () => { d.ref = ref.value; });
  const add = el("button", { type: "submit", class: "btn btn-primary", "data-key": "src-add" }, "Add source");
  add.disabled = ro;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const id = "s" + Date.now().toString(36).slice(-6);
    const entry = d.kind === "github"
      ? { id, kind: "github", label: d.label.trim() || d.repo.trim(), repo: d.repo.trim(), ...(d.ref.trim() ? { ref: d.ref.trim() } : {}) }
      : { id, kind: "local", label: d.label.trim() || d.path.trim().split(/[\\/]/).filter(Boolean).pop() || "Local", path: d.path.trim() };
    const sources = [...c.sources, entry];
    const ok = await saveSources({ sources, ...(c.gameSource ? { gameSource: c.gameSource } : { gameSource: id }) }, "Source added.");
    if (ok) view.conn = { kind: d.kind, label: "", path: "", repo: "", ref: "" };
    renderConnections();
  };
  form.replaceChildren(el("label", null, "Kind", kind), el("label", null, "Label", label), el("label", null, d.kind === "github" ? "Repository" : "Folder", main),
    ...(d.kind === "github" ? [el("label", null, "Branch or tag", ref)] : []), add);
}

function renderTasks() {
  const o = office();
  const tasks = o ? o.tasks : [];
  $("tasks-sub").textContent = tasks.length ? tasks.length + (tasks.length === 1 ? " task" : " tasks") : "";
  $("task-list").replaceChildren(tasks.length
    ? el("ul", { class: "tasks" }, ...tasks.slice(0, 12).map((t) => taskItem(t, true)))
    : el("p", { class: "empty" }, "No tasks yet. Pick an agent and assign one."));
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
  const players = $("run-players");
  if (players) players.replaceChildren(...(run && run.players.length ? [el("h3", { class: "label" }, "Players in " + (run.scenario || "this run")), el("ul", { class: "players" }, ...run.players.map((p) => el("li", null, badge("s", safeState(p.status)), el("strong", null, p.player), p.activity)))] : []));
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

const TOOLS = [
  { id: "select", name: "Select", key: "V", icon: "tool-select" },
  { id: "move", name: "Move", key: "M", icon: "tool-move" },
  { id: "place", name: "Place", key: "P", icon: "tool-place" },
  { id: "erase", name: "Erase", key: "E", icon: "tool-erase" },
  { id: "rotate", name: "Rotate", key: "R", icon: "tool-rotate" },
  { id: "recolor", name: "Recolor", key: "C", icon: "tool-recolor" },
];
const say = (text) => { $("announce").textContent = text; };
const clone = (x) => JSON.parse(JSON.stringify(x));

function openEditor() {
  if (readonlyOffice() || view.edit) return;
  view.edit = { draft: clone(savedLayout()), undo: [], redo: [], tool: "select", place: "desk", sel: null, hover: null, note: "", saving: false };
  say("Editing layout.");
  render();
}
function closeEditor(saved) {
  const e = view.edit;
  if (!e) return;
  if (!saved && e.undo.length && !window.confirm("Discard " + e.undo.length + " unsaved " + (e.undo.length === 1 ? "change" : "changes") + "?")) return;
  view.edit = null;
  say(saved ? "Layout saved." : "Layout changes discarded.");
  render();
}
function commit(change, note) {
  const e = view.edit;
  e.undo.push(JSON.stringify(e.draft));
  if (e.undo.length > 50) e.undo.shift();
  e.redo = [];
  change(e.draft);
  e.note = note || "";
  if (note) say(note);
  render();
}
function stepHistory(back) {
  const e = view.edit;
  const from = back ? e.undo : e.redo;
  if (!from.length) return;
  (back ? e.redo : e.undo).push(JSON.stringify(e.draft));
  e.draft = JSON.parse(from.pop());
  if (e.sel && !e.draft.props.some((p) => p.id === e.sel)) e.sel = null;
  e.note = back ? "Undone." : "Redone.";
  say(e.note);
  render();
}
function newId(type, layout) {
  let i = 1;
  while (layout.props.some((p) => p.id === type + "-" + i)) i++;
  return type + "-" + i;
}
function nextDeskNumber(layout) {
  let n = 1;
  while (layout.props.some((p) => p.type === "desk" && p.n === n)) n++;
  return n;
}
function tryChange(prop, patch) {
  const e = view.edit;
  const next = { ...prop, ...patch };
  const why = fits(e.draft, next);
  if (why) { e.note = why + ": " + propName(prop) + " stays where it is."; say(e.note); render(); return false; }
  commit((d) => Object.assign(d.props.find((p) => p.id === prop.id), patch), propName(prop) + " " + (patch.rot !== undefined ? "rotated." : "moved to tile " + next.x + ", " + next.y + "."));
  return true;
}
function removeProp(prop) {
  let note = propName(prop) + " removed.";
  commit((d) => {
    d.props = d.props.filter((p) => p.id !== prop.id);
    if (prop.type === "desk" && prop.agent) {
      const who = roster().find((a) => a.id === prop.agent);
      const free = d.props.filter((p) => p.type === "desk" && !p.agent)
        .sort((a, b) => Math.hypot(a.x - prop.x, a.y - prop.y) - Math.hypot(b.x - prop.x, b.y - prop.y))[0];
      if (free) { free.agent = prop.agent; note += " " + (who ? who.name : "The agent") + " moved to Desk " + free.n + "."; }
      else note += " " + (who ? who.name : "The agent") + " has no desk now.";
    }
  }, note);
  view.edit.sel = null;
  render();
}
function assignDesk(prop, agentId) {
  commit((d) => {
    for (const p of d.props) if (p.type === "desk" && agentId && p.agent === agentId) delete p.agent;
    const target = d.props.find((p) => p.id === prop.id);
    if (agentId) target.agent = agentId; else delete target.agent;
  }, agentId ? propName(prop) + " is now the workstation for " + (roster().find((a) => a.id === agentId) || { name: agentId }).name + "." : propName(prop) + " has no agent now.");
}
function act(tile) {
  const e = view.edit;
  const hit = propAt(e.draft, tile);
  if (e.tool === "select") { e.sel = hit ? hit.id : null; e.note = ""; render(); return; }
  if (e.tool === "move") {
    const sel = e.sel && e.draft.props.find((p) => p.id === e.sel);
    // First click picks a prop; with one picked, a click on the floor (or a rug) moves it there.
    if (!sel || (hit && hit.id !== sel.id && PROPS[hit.type].blocking)) { e.sel = hit ? hit.id : null; render(); return; }
    if (sel.x === tile.x && sel.y === tile.y) return;
    tryChange(sel, { x: tile.x, y: tile.y });
    return;
  }
  if (e.tool === "place") {
    const prop = { id: newId(e.place, e.draft), type: e.place, x: tile.x, y: tile.y, rot: 0, material: e.place === "cabinet" ? "metal" : "wood" };
    if (prop.type === "desk") prop.n = nextDeskNumber(e.draft);
    const why = fits(e.draft, prop);
    if (why) { e.note = why + ": nothing placed."; say(e.note); render(); return; }
    commit((d) => d.props.push(prop), propName(prop) + " placed at tile " + tile.x + ", " + tile.y + ".");
    e.sel = prop.id;
    render();
    return;
  }
  if (!hit) return;
  e.sel = hit.id;
  if (e.tool === "erase") removeProp(hit);
  else if (e.tool === "rotate") tryChange(hit, { rot: hit.rot === 90 ? 0 : 90 });
  else if (e.tool === "recolor") {
    const next = MATERIALS[(MATERIALS.indexOf(hit.material) + 1) % MATERIALS.length];
    commit((d) => { d.props.find((p) => p.id === hit.id).material = next; }, propName(hit) + ": " + MATERIAL_WORDS[next] + ".");
  }
}
async function saveLayout() {
  const e = view.edit;
  if (!e || e.saving) return;
  e.saving = true;
  e.note = "Saving…";
  render();
  try {
    const r = await fetch("/api/layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(e.draft) });
    const body = await r.json().catch(() => ({}));
    if (r.ok && body.layout) { view.data.layout = body.layout; e.saving = false; closeEditor(true); return; }
    e.note = body.error || "The layout was not saved.";
  } catch {
    e.note = "The Agent Office server is not reachable. The layout was not saved.";
  }
  e.saving = false;
  say(e.note);
  render();
}

function renderEditBar() {
  const e = view.edit;
  $("editbar").hidden = !e;
  $("edit-notice").hidden = !e;
  const open = $("edit-open");
  open.hidden = !!e;
  open.disabled = readonlyOffice();
  open.title = readonlyOffice() ? "The office is read-only." : "Move, add and recolor furniture";
  if (!e) return;
  const n = e.undo.length;
  $("edit-count").textContent = (n ? n + " unsaved " + (n === 1 ? "change" : "changes") : "No changes") + (e.note ? " · " + e.note : "");
  $("edit-save").disabled = e.saving || !n;
}

function renderRail() {
  const e = view.edit;
  $("rail").hidden = !e;
  $("roster-panel").hidden = !!e;
  if (!e) return;
  const tools = el("div", { class: "tools", role: "group", "aria-label": "Tools" }, ...TOOLS.map((t) => {
    const b = el("button", { type: "button", class: "tool", "aria-pressed": String(e.tool === t.id), title: t.name + " (" + t.key + ")", "data-key": "tool-" + t.id },
      icon(t.icon, 14), t.name, el("span", { class: "kbd" }, t.key));
    b.addEventListener("click", () => { e.tool = t.id; e.note = ""; render(); });
    return b;
  }));
  const parts = [el("h2", { class: "label" }, "Tools"), tools];
  if (e.tool === "place") {
    parts.push(el("h3", { class: "label" }, "Place"), el("div", { class: "shelf", role: "group", "aria-label": "Prop to place" }, ...Object.keys(PROPS).map((type) => {
      const b = el("button", { type: "button", class: "btn" + (e.place === type ? " is-on" : ""), "aria-pressed": String(e.place === type), "data-key": "shelf-" + type }, PROPS[type].label);
      b.addEventListener("click", () => { e.place = type; render(); });
      return b;
    })), el("p", { class: "caption" }, "Click a free tile to put it there. Esc goes back to Select."));
  } else {
    const hints = { select: "Click a prop to see and change it.", move: "Select a prop, then click the tile for its back corner. Arrow keys nudge it.", erase: "Click a prop to remove it.", rotate: "Click a prop to rotate it by 90 degrees.", recolor: "Click a prop to switch its material." };
    parts.push(el("p", { class: "caption" }, hints[e.tool]));
  }
  const undo = el("button", { type: "button", class: "btn", title: "Undo (Ctrl+Z)", "data-key": "undo" }, "Undo");
  const redo = el("button", { type: "button", class: "btn", title: "Redo (Ctrl+Shift+Z)", "data-key": "redo" }, "Redo");
  undo.disabled = !e.undo.length;
  redo.disabled = !e.redo.length;
  undo.addEventListener("click", () => stepHistory(true));
  redo.addEventListener("click", () => stepHistory(false));
  parts.push(el("div", { class: "undo" }, undo, redo));
  $("rail").replaceChildren(...parts);
}

function renderInspector() {
  const e = view.edit;
  $("inspector").hidden = !e;
  $("detail").hidden = !!e;
  if (!e) return;
  const p = e.sel && e.draft.props.find((x) => x.id === e.sel);
  if (!p) {
    $("inspector").replaceChildren(el("span", { class: "caption" }, "Selected"), el("p", { class: "empty" }, "Nothing selected. Click a prop in the room with Select."));
    return;
  }
  const parts = [el("div", { class: "detail-head" }, el("span", { class: "caption" }, "Selected"), el("h2", { class: "room-title" }, propName(p)))];
  if (p.type === "desk") {
    const pick = el("select", { id: "desk-agent", "data-key": "desk-agent" }, el("option", { value: "" }, "Nobody"),
      ...roster().map((a) => el("option", { value: a.id }, a.name)));
    pick.value = p.agent || "";
    pick.addEventListener("change", () => assignDesk(p, pick.value));
    parts.push(el("div", { class: "block" }, el("label", { class: "label", for: "desk-agent" }, "Workstation for"), pick));
  }
  const seg = el("div", { class: "seg", role: "group", "aria-label": "Rotation" }, ...[0, 90].map((r) => {
    const b = el("button", { type: "button", "aria-pressed": String(p.rot === r), "data-key": "rot-" + r }, r + "°");
    b.addEventListener("click", () => { if (p.rot !== r) tryChange(p, { rot: r }); });
    return b;
  }));
  parts.push(el("div", { class: "block" }, el("span", { class: "label" }, "Rotation"), seg));
  const sw = el("div", { class: "swatches", role: "group", "aria-label": "Material" }, ...MATERIALS.map((m) => {
    const b = el("button", { type: "button", class: "swatch-btn sw-" + m, "aria-pressed": String(p.material === m), "aria-label": MATERIAL_WORDS[m], title: MATERIAL_WORDS[m], "data-key": "mat-" + m });
    b.addEventListener("click", () => { if (p.material !== m) commit((d) => { d.props.find((x) => x.id === p.id).material = m; }, propName(p) + ": " + MATERIAL_WORDS[m] + "."); });
    return b;
  }));
  parts.push(el("div", { class: "block" }, el("span", { class: "label" }, "Material"), sw));
  const num = (axis, max) => {
    const input = el("input", { type: "number", class: "field", min: "0", max: String(max), step: "1", id: "tile-" + axis, "data-key": "tile-" + axis });
    input.value = String(p[axis]);
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (Number.isInteger(v) && v !== p[axis]) tryChange(p, { [axis]: v }); else input.value = String(p[axis]);
    });
    return el("label", { for: "tile-" + axis }, "Tile " + axis.toUpperCase(), input);
  };
  parts.push(el("div", { class: "pair" }, num("x", GRID.w - 1), num("y", GRID.h - 1)));
  const remove = el("button", { type: "button", class: "btn btn-danger", "data-key": "remove" }, "Remove " + PROPS[p.type].label.toLowerCase());
  remove.addEventListener("click", () => removeProp(p));
  const who = p.agent ? roster().find((a) => a.id === p.agent) : null;
  parts.push(el("div", { class: "block foot" }, remove, who ? el("p", { class: "caption" }, who.name + " moves to the nearest free desk if this one is removed.") : null));
  $("inspector").replaceChildren(...parts);
}

function wireEditor() {
  $("edit-open").addEventListener("click", openEditor);
  $("edit-discard").addEventListener("click", () => closeEditor(false));
  $("edit-save").addEventListener("click", saveLayout);
  const svg = $("world-svg");
  const tileAt = (event) => {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(event.clientX, event.clientY).matrixTransform(m.inverse());
    const x = Math.floor((pt.y + pt.x / 2) / TILE);
    const y = Math.floor((pt.y - pt.x / 2) / TILE);
    return x >= 0 && y >= 0 && x < GRID.w && y < GRID.h ? { x, y } : null;
  };
  svg.addEventListener("pointermove", (event) => {
    if (!view.edit) return;
    const t = tileAt(event);
    const h = view.edit.hover;
    if ((t && h && t.x === h.x && t.y === h.y) || (!t && !h)) return;
    view.edit.hover = t;
    renderGhost();
  });
  svg.addEventListener("pointerleave", () => { if (view.edit) { view.edit.hover = null; renderGhost(); } });
  svg.addEventListener("click", (event) => {
    const t = tileAt(event);
    if (view.edit) { if (t) act(t); return; }
    const hit = propAt(savedLayout(), t);
    if (hit && hit.type === "desk" && hit.agent) { view.agent = hit.agent; render(); }
  });
  document.addEventListener("keydown", (event) => {
    const e = view.edit;
    if (!e) return;
    const tag = event.target && event.target.tagName;
    const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
    const k = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && k === "z") { event.preventDefault(); stepHistory(!event.shiftKey); return; }
    if ((event.ctrlKey || event.metaKey) && k === "y") { event.preventDefault(); stepHistory(false); return; }
    if ((event.ctrlKey || event.metaKey) && k === "s") { event.preventDefault(); saveLayout(); return; }
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
    const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
    if (tool) { e.tool = tool.id; e.note = ""; render(); return; }
    if (k === "escape") { e.tool = "select"; e.hover = null; e.note = ""; render(); return; }
    const sel = e.sel && e.draft.props.find((p) => p.id === e.sel);
    if (!sel) return;
    const step = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
    if (step) { event.preventDefault(); tryChange(sel, { x: sel.x + step[0], y: sel.y + step[1] }); return; }
    if (k === "delete" || k === "backspace") { event.preventDefault(); removeProp(sel); }
  });
  window.addEventListener("beforeunload", (event) => { if (view.edit && view.edit.undo.length) event.preventDefault(); });
}

function render() {
  const active = document.activeElement;
  const focused = active && active.getAttribute("data-key");
  const caret = active && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
  const run = currentRun();
  const facts = agentFacts();
  if (!view.agent && facts[0]) view.agent = facts[0].id;
  renderTop(run);
  renderEditBar();
  renderRail();
  renderInspector();
  if (!view.edit) renderRoster(facts);
  renderWorld(run, facts);
  if (!view.edit) renderDetail(run, facts);
  renderTasks();
  renderLower(run);
  if (!view.rep.built && facts.length) { buildReportFilters(); renderReports(); }
  renderConnections();
  announce(facts);
  if (focused) {
    const again = document.querySelector('[data-key="' + focused + '"]');
    if (again) { again.focus(); if (caret && typeof again.setSelectionRange === "function") again.setSelectionRange(caret[0], caret[1]); }
  }
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

async function tick(force) {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (!r.ok) throw new Error("status " + r.status);
    const text = await r.text();
    const wasOffline = view.offline;
    view.offline = false;
    if (text === view.raw && !wasOffline && !force) return;
    view.raw = text;
    view.data = JSON.parse(text);
    const o = view.data.office;
    const key = o ? o.tasks.map((t) => t.taskId + t.status + (t.reportPath || "")).join("|") : "";
    if (key !== view.reportsKey) { view.reportsKey = key; loadReports(); }
  } catch {
    if (view.offline) return;
    view.offline = true;
  }
  render();
}
${LIVE_JS}
initTheme();
$("cleanup-btn").addEventListener("click", async () => {
  const r = await postJson("/api/cleanup", {});
  flash(r.ok ? (r.data.stopped ? r.data.stopped + " stuck runner(s) stopped" : "No stuck runner is still running") + (r.data.forgotten ? ", " + r.data.forgotten + " old record(s) cleared." : ".") : (r.data.error || "Nothing was cleaned up."));
  await tick(true);
});
wireEditor();
render();
tick(); setInterval(tick, 3000);
`;
