// Starts the local processes of the QA office and stops them together on Ctrl+C:
//   bridge  (tsx)   http://127.0.0.1:3100  tools, agents, model calls
//   office  (tsx)   http://127.0.0.1:4873  Agent Office (design system UI, task board, findings)
// OFFICE_UI=agentoffice starts the old AgentOffice UI instead of the Agent Office page (needs `npm run office:setup`):
//   server  (node)  ws://localhost:3000    AgentOffice room (patched)
//   ui      (vite)  http://localhost:5173  AgentOffice UI
// OFFICE_READONLY=true starts the read-only portfolio mode.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(ROOT, "vendor", "agent-office");
const legacy = (process.env.OFFICE_UI ?? "").trim().toLowerCase() === "agentoffice";
if (legacy && !existsSync(path.join(VENDOR, "packages", "server", "dist", "index.js"))) {
  console.error("AgentOffice is not built yet. Run: npm run office:setup");
  process.exit(1);
}

const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const processes = [
  { name: "bridge", cmd: process.execPath, args: ["--import", "tsx", "src/officeCli.ts"], cwd: ROOT, shell: false },
  ...(legacy
    ? [
        { name: "server", cmd: process.execPath, args: ["dist/index.js"], cwd: path.join(VENDOR, "packages", "server"), shell: false },
        { name: "ui", cmd: npm, args: ["run", "dev", "--workspace=@agent-office/ui"], cwd: VENDOR, shell: isWin },
      ]
    : [{ name: "office", cmd: process.execPath, args: ["--import", "tsx", "src/dashboardCli.ts"], cwd: ROOT, shell: false }]),
];

// The office page never reads .env (by design), but the bridge does. So that OFFICE_LIVE_ENABLED and
// OFFICE_LIVE_VIEWER_TOKEN set in .env reach both, forward just the OFFICE_LIVE_* keys to every child.
// Values exported in the shell win over .env.
let liveFromFile = {};
try {
  const file = parse(readFileSync(path.join(ROOT, ".env")));
  liveFromFile = Object.fromEntries(Object.entries(file).filter(([key]) => key.startsWith("OFFICE_LIVE_") && process.env[key] === undefined));
} catch {
  // no .env: nothing to forward
}

// Only the bridge may see the provider key. The office page, AgentOffice's server and UI never need it.
const envWithoutKey = { ...process.env, ...liveFromFile };
delete envWithoutKey.GEMINI_API_KEY;
const children = processes.map(({ name, cmd, args, cwd, shell }) => {
  const env = name === "bridge" ? { ...process.env, ...liveFromFile } : envWithoutKey;
  const child = spawn(cmd, args, { cwd, shell, stdio: ["ignore", "pipe", "pipe"], env, windowsHide: true });
  const prefix = (chunk) =>
    chunk.toString().split("\n").filter(Boolean).forEach((line) => console.log(`[${name}] ${line}`));
  child.stdout.on("data", prefix);
  child.stderr.on("data", prefix);
  child.on("exit", (code) => {
    console.log(`[${name}] exited (${code}). Stopping the office.`);
    stop();
  });
  return child;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (isWin && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    else child.kill();
  }
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const uiUrl = legacy ? "http://localhost:5173" : `http://127.0.0.1:${process.env.QA_OBSERVER_PORT || 4873}`;
console.log(`Office starting: open ${uiUrl} (Ctrl+C stops everything)`);
