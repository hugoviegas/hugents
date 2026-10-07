import { themeCss } from "./tokens.js";

/**
 * The stylesheet the patched AgentOffice UI loads (`office/theme/agent-office.css`, copied into the vendored UI by
 * `npm run office:setup`): the Agent Office tokens plus the HUD classes the patch uses. Generated, never edited by
 * hand: `npm run office:theme` rewrites it and a test fails when it drifts.
 */
const HUD_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { background: var(--bg); color: var(--text-primary); font: var(--type-body); }
:focus-visible { outline: none; box-shadow: var(--shadow-focus); }
.ao-brand { position: absolute; bottom: 20px; left: 20px; z-index: 10; display: flex; flex-direction: column; padding: var(--space-3) var(--space-4); background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-md); box-shadow: var(--shadow-panel); }
.ao-eyebrow, .ao-caption { font: var(--type-caption); color: var(--text-muted); }
.ao-title { margin: 0; font: var(--type-page-title); }
.ao-panel { position: absolute; overflow: hidden; background: var(--panel-bg); color: var(--text-primary); border: 1px solid var(--panel-border); border-radius: var(--radius-md); box-shadow: var(--shadow-panel); }
.ao-panel-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-3); cursor: grab; border-bottom: 1px solid var(--panel-raised); }
.ao-panel-head.is-min { border-bottom: 0; }
.ao-panel-title { margin: 0; font: var(--type-room-title); font-size: 16px; line-height: 20px; }
.ao-panel-sub { font: var(--type-caption); color: var(--text-muted); }
.ao-panel-body { padding: var(--space-3); }
.ao-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: 32px; padding: 0 var(--space-3); background: transparent; color: var(--text-primary); border: 1px solid var(--panel-border); border-radius: var(--radius-md); font: var(--type-label); cursor: pointer; }
.ao-btn:hover { border-color: var(--text-secondary); }
.ao-btn-primary { background: var(--accent-primary); border-color: var(--accent-primary); color: var(--on-fill); box-shadow: var(--shadow-pixel); }
.ao-icon-btn { width: 32px; padding: 0; }
.ao-field { width: 100%; min-height: 32px; padding: 0 var(--space-2); background: var(--bg); color: var(--text-primary); border: 1px solid var(--panel-border); border-radius: var(--radius-md); font: var(--type-label); font-weight: 400; }
.ao-taskboard { left: 20px; top: 20px; width: 300px; max-height: 50vh; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); z-index: 10; }
.ao-form { display: flex; flex-direction: column; gap: var(--space-2); }
.ao-row { display: flex; gap: var(--space-2); }
.ao-row > select { flex: 1; }
.ao-tasks { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.ao-task { display: flex; flex-direction: column; gap: 4px; padding: var(--space-2); background: var(--panel-raised); border-radius: var(--radius-sm); }
.ao-task-title { font: var(--type-label); overflow-wrap: anywhere; }
.ao-task-meta { display: flex; align-items: center; gap: var(--space-2); font: var(--type-caption); color: var(--text-muted); }
.ao-empty { margin: 0; font: var(--type-caption); color: var(--text-muted); }
.ao-foot { display: flex; flex-direction: column; gap: 2px; padding-top: var(--space-2); border-top: 1px solid var(--panel-raised); font: var(--type-timestamp); color: var(--text-muted); }
.ao-badge { --c: var(--state-idle); display: inline-flex; align-items: center; gap: 6px; padding: 1px 6px; border: 2px solid var(--c); border-radius: var(--radius-sm); background: var(--c); color: var(--on-fill); font: var(--type-status); letter-spacing: var(--type-status-tracking); text-transform: uppercase; white-space: nowrap; }
.ao-badge svg { flex: none; }
.ao-badge.s-queued { --c: var(--state-idle); background: transparent; color: var(--c); }
.ao-badge.s-working { --c: var(--state-working); }
.ao-badge.s-completed { --c: var(--state-completed); }
.ao-badge.s-blocked { --c: var(--state-blocked); }
.ao-badge.s-failed { --c: var(--state-failed); }
.ao-chip-readonly { --c: var(--offline); background: transparent; color: var(--c); border-style: dashed; border-width: 1px; }
.ao-panel-body { max-height: 60vh; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-2); }
.ao-panel-head.is-min .ao-panel-sub { display: none; }
.ao-brand.is-right { left: auto; right: 20px; }
#ui-root > .ao-left { pointer-events: none; }
.ao-left { position: absolute; left: 20px; top: 20px; bottom: 20px; width: 300px; z-index: 10; display: flex; flex-direction: column; gap: var(--space-2); }
.ao-left > *, .ao-dock > * { pointer-events: auto; }
.ao-left > .ao-taskboard { position: relative; left: auto; top: auto; width: auto; flex: none; }
.ao-dock { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-2); }
.ao-panel.is-docked { position: relative; flex: none; overflow: visible; }
.ao-panel.is-docked .ao-panel-head { cursor: default; }
.ao-panel.is-docked .ao-panel-body { max-height: none; }
.ao-theme { margin-top: var(--space-2); }
.ao-theme select { width: auto; flex: 1; }
.ao-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.ao-item { display: flex; flex-direction: column; gap: 2px; padding: var(--space-2) 0; border-bottom: 1px solid var(--panel-raised); }
.ao-item:last-child { border-bottom: 0; }
.ao-item-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.ao-item-title { font: var(--type-label); overflow-wrap: anywhere; }
.ao-item-body { font: var(--type-caption); color: var(--text-secondary); overflow-wrap: anywhere; }
.ao-meta { font: var(--type-caption); color: var(--text-muted); }
.ao-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 2px var(--space-2); font: var(--type-caption); color: var(--text-secondary); }
.ao-check { display: flex; align-items: center; gap: var(--space-2); font: var(--type-caption); color: var(--text-secondary); }
.ao-check input { accent-color: var(--accent-primary); }
.ao-btn-sm { min-height: 24px; padding: 0 var(--space-2); font: var(--type-caption); }
.ao-btn.is-on { background: var(--panel-raised); border-color: var(--accent-primary); }
.ao-btn:disabled { opacity: .5; cursor: not-allowed; }
.ao-btn-danger:hover { border-color: var(--state-failed); color: var(--state-failed); }
.ao-wrap { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.ao-chaos { display: grid; grid-template-columns: 1fr auto; gap: var(--space-1); }
.ao-log { max-height: 220px; overflow-y: auto; font: var(--type-log); color: var(--text-secondary); }
.ao-inspector { right: 20px; top: 20px; width: 260px; }
.ao-panel-body p { margin: 0; }
.ao-log .ao-item { flex-direction: row; align-items: flex-start; gap: var(--space-2); padding: 4px 0; }
.ao-log-time { flex: none; color: var(--text-muted); }
.ao-log svg { flex: none; margin-top: 4px; color: var(--text-muted); }
.ao-quote { color: var(--text-muted); }
.ao-who { --who: var(--text-primary); color: var(--who); font-weight: 700; }
.ao-who.id-alpha { --who: var(--agent-alpha); }
.ao-who.id-explorer { --who: var(--agent-explorer); }
.ao-who.id-analyst { --who: var(--agent-analyst); }
.ao-who.id-critic { --who: var(--agent-critic); }
.ao-who.id-system { --who: var(--text-muted); }
.ao-rel { display: inline-flex; align-items: center; gap: 4px; font: var(--type-status); letter-spacing: var(--type-status-tracking); text-transform: uppercase; }
.ao-rel.is-alliance { color: var(--state-completed); }
.ao-rel.is-rivalry { color: var(--state-failed); }
.ao-chat { height: 240px; overflow-y: auto; font: var(--type-caption); color: var(--text-secondary); }
.ao-chat p { margin: 0 0 var(--space-1); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

export function officeThemeCss(): string {
  return `/* Agent Office theme for the patched AgentOffice UI. Generated by \`npm run office:theme\` from src/theme; do not edit. */\n${themeCss()}${HUD_CSS}`;
}
