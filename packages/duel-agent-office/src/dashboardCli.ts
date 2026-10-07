import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadObserverConfig, ObserverConfigError } from "./observer/config.js";
import { startDashboard } from "./observer/dashboard.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Explicit, local-only start. Not imported by the runner. No dotenv: `.env` is never read.
async function main(): Promise<void> {
  let config;
  try {
    config = loadObserverConfig(process.env, path.join(ROOT, "artifacts"));
  } catch (error) {
    console.error(error instanceof ObserverConfigError ? error.message : "Invalid observer configuration");
    process.exit(64);
  }
  const { port } = await startDashboard(config);
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  console.log(`QA observer dashboard (local only): http://${host}:${port}/  - Ctrl+C to stop`);
}

main().catch(() => {
  console.error("Dashboard failed to start (is the port in use?)");
  process.exit(1);
});
