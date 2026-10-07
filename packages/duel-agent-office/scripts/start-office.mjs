// Starts the three local processes of the QA office and stops them together on Ctrl+C:
//   bridge  (tsx)   http://127.0.0.1:3100  tools, agents, Ollama calls
//   server  (node)  ws://localhost:3000    AgentOffice room (patched)
//   ui      (vite)  http://localhost:5173  AgentOffice UI
// Run `npm run office:setup` once first. OFFICE_READONLY=true starts the read-only portfolio mode.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(ROOT, "vendor", "agent-office");
if (!existsSync(path.join(VENDOR, "packages", "server", "dist", "index.js"))) {
  console.error("AgentOffice is not built yet. Run: npm run office:setup");
  process.exit(1);
}

const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const processes = [
  { name: "bridge", cmd: process.execPath, args: ["--import", "tsx", "src/officeCli.ts"], cwd: ROOT, shell: false },
  { name: "server", cmd: process.execPath, args: ["dist/index.js"], cwd: path.join(VENDOR, "packages", "server"), shell: false },
  { name: "ui", cmd: npm, args: ["run", "dev", "--workspace=@agent-office/ui"], cwd: VENDOR, shell: isWin },
];

// Only the bridge may see the provider key. AgentOffice's server and UI never need it.
const envWithoutKey = { ...process.env };
delete envWithoutKey.GEMINI_API_KEY;
const children = processes.map(({ name, cmd, args, cwd, shell }) => {
  const env = name === "bridge" ? process.env : envWithoutKey;
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
console.log("Office starting: UI http://localhost:5173 (Ctrl+C stops everything)");
