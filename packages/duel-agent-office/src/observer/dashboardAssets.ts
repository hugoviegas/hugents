/** Static dashboard files. No external resources; all dynamic text is set with textContent. */
export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA Observer</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header><h1>QA Observer</h1><p id="meta">Loading…</p></header>
<main>
<section id="totals" aria-label="Totals"></section>
<section aria-labelledby="repeated-h"><h2 id="repeated-h">Repeated findings</h2><div id="repeated"></div></section>
<section aria-labelledby="runs-h"><h2 id="runs-h">Runs</h2><div id="runs"></div></section>
</main>
<script src="/app.js"></script>
</body>
</html>
`;

export const APP_CSS = `
:root{color-scheme:light dark;--bg:#faf7f2;--fg:#201a14;--muted:#6b6258;--card:#fff;--line:#d9d0c4;--high:#b3261e;--medium:#a35c00;--low:#4a6b2f;--ok:#2e6b3a}
@media (prefers-color-scheme:dark){:root{--bg:#17130f;--fg:#efe7db;--muted:#a89d8f;--card:#221c16;--line:#3a3128;--high:#ff8a80;--medium:#ffb74d;--low:#a5d68a;--ok:#81c995}}
*{box-sizing:border-box}body{margin:0;padding:0 16px 32px;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
header,main{max-width:1000px;margin:0 auto}h1{margin:20px 0 4px;font-size:22px}h2{font-size:17px;margin:24px 0 8px}
#meta,.muted{color:var(--muted);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:8px 0}
.row{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline}.grow{flex:1 1 auto}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;border:1px solid currentColor;font-size:12px}
.completed{color:var(--ok)}.active{color:var(--medium)}.blocked{color:var(--medium)}.failed,.high{color:var(--high)}.medium{color:var(--medium)}.low{color:var(--low)}
ul{margin:6px 0;padding-left:18px}li{margin:3px 0}.shots{display:flex;flex-wrap:wrap;gap:8px}
.shots figure{margin:0;width:200px}.shots img{width:100%;height:auto;border:1px solid var(--line);border-radius:4px}.shots figcaption{font-size:12px;color:var(--muted)}
code{font-size:12px}
`;

export const APP_JS = `
"use strict";
const $ = (id) => document.getElementById(id);
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) { if (k === "class") n.className = v; else n.setAttribute(k, v); }
  for (const kid of kids) n.append(kid);
  return n;
}
const pill = (text, cls) => el("span", { class: "pill " + cls }, text);
const counts = (obj) => Object.entries(obj).map(([k, v]) => k + " " + v).join(" · ") || "none";
function render(state) {
  $("meta").textContent = "Local view, refreshed " + new Date(state.generatedAt).toLocaleTimeString() + ". Observations, not confirmed bugs.";
  const t = $("totals"); t.replaceChildren(
    el("div", { class: "card" },
      el("div", null, state.totals.runs + " runs (" + counts(state.totals.byStatus) + ")"),
      el("div", null, state.totals.findings + " findings · severity: " + counts(state.totals.bySeverity)),
      el("div", { class: "muted" }, "categories: " + counts(state.totals.byCategory) + " · ignored network failures: " + state.totals.ignoredNetworkFailures)));
  const rep = $("repeated"); rep.replaceChildren();
  if (!state.repeated.length) rep.append(el("p", { class: "muted" }, "None."));
  for (const r of state.repeated) rep.append(el("div", { class: "card" },
    el("div", { class: "row" }, pill(r.severity, r.severity), el("strong", null, r.ruleId), el("span", { class: "muted" }, r.runs + " runs · " + r.occurrences + " occurrences")),
    el("div", null, r.message)));
  const runs = $("runs"); runs.replaceChildren();
  if (!state.runs.length) runs.append(el("p", { class: "muted" }, "No runs found."));
  for (const run of state.runs) {
    const card = el("div", { class: "card" });
    card.append(el("div", { class: "row" }, pill(run.status, run.status), el("strong", { class: "grow" }, run.runId),
      el("span", { class: "muted" }, run.durationMs == null ? "" : Math.round(run.durationMs / 1000) + " s")));
    for (const p of run.players) card.append(el("div", { class: "muted" }, p.player + ": " + p.status + " — " + p.activity));
    card.append(el("div", { class: "muted" }, run.findings.length + " findings · ignored network failures: " + run.ignoredNetworkFailures));
    const ul = el("ul");
    for (const f of run.findings) ul.append(el("li", null, pill(f.severity, f.severity), " ", el("strong", null, f.ruleId + " ×" + f.count), " (" + f.player + ") ", f.message, " ",
      el("code", null, f.evidence.map((e) => e.file + (e.line ? "#" + e.line : "")).join(", "))));
    card.append(ul);
    if (run.screenshots.length) {
      const shots = el("div", { class: "shots" });
      for (const s of run.screenshots) shots.append(el("figure", null, el("img", { src: s.url, alt: s.player + ": " + s.label, loading: "lazy" }), el("figcaption", null, s.player + " · " + s.label)));
      card.append(shots);
    }
    runs.append(card);
  }
}
async function tick() {
  try { const r = await fetch("/api/state", { cache: "no-store" }); if (r.ok) render(await r.json()); } catch { $("meta").textContent = "Dashboard server not reachable."; }
}
tick(); setInterval(tick, 5000);
`;
