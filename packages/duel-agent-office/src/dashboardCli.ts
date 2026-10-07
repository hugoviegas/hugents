import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadObserverConfig, ObserverConfigError } from "./observer/config.js";
import { startDashboard } from "./observer/dashboard.js";
import { createOfficeHub, OfficeHubConfigError } from "./office/hub.js";
import { fileLayoutStore } from "./office/layout.js";
import { fileAgentConfigStore } from "./office/agentConfig.js";
import { fileConnectionStore } from "./office/connections.js";
import { fileQuotaStore } from "./office/quota.js";

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
  // The office: task board and live agents through the local bridge (npm run office:bridge or office:start).
  let office;
  try {
    office = await createOfficeHub({
      bridgeUrl: process.env.QA_BRIDGE_URL ?? "http://127.0.0.1:3100",
      readonly: process.env.OFFICE_READONLY === "true",
      storeFile: path.join(config.artifactsDir, "office", "tasks.json"),
    });
  } catch (error) {
    console.error(error instanceof OfficeHubConfigError ? error.message : "Invalid office configuration");
    process.exit(64);
  }
  const layout = fileLayoutStore({ file: path.join(config.artifactsDir, "office", "layout.json"), readonly: process.env.OFFICE_READONLY === "true" });
  const readonly = process.env.OFFICE_READONLY === "true";
  const officeDir = path.join(config.artifactsDir, "office");
  const stores = {
    configs: fileAgentConfigStore({ file: path.join(officeDir, "agent-config.json"), readonly }),
    quota: fileQuotaStore(path.join(officeDir, "usage.json")),
    connections: fileConnectionStore({ file: path.join(officeDir, "connections.json"), readonly, seedLocalPath: process.env.OFFICE_GAME_REPO }),
    // Read-only GitHub access. The token (optional) comes from the process environment, never from the page or a file.
    github: { token: process.env.GITHUB_TOKEN?.trim() || undefined },
  };
  const { port } = await startDashboard(config, office, layout, stores);
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  console.log(`Agent Office (local only): http://${host}:${port}/  - Ctrl+C to stop`);
}

main().catch(() => {
  console.error("Dashboard failed to start (is the port in use?)");
  process.exit(1);
});
