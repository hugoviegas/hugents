import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, secretValues } from "./config.js";
import { loadObserverConfig } from "./observer/config.js";
import { observe } from "./observer/scan.js";
import { createBridge } from "./office/bridge.js";
import { ollamaInference } from "./office/inference.js";
import { openBudget } from "./office/provider/budget.js";
import { createReportChain } from "./office/provider/chain.js";
import { loadProviderConfig } from "./office/provider/config.js";
import { geminiProvider } from "./office/provider/gemini.js";
import { ollamaProvider } from "./office/provider/ollama.js";
import { openMetrics } from "./office/metrics.js";
import { defaultSpawnRun } from "./office/tools.js";
import { fileAgentConfigStore } from "./office/agentConfig.js";
import { fileConnectionStore } from "./office/connections.js";
import { fileProcessRegistry } from "./office/procs.js";
import { fileQuotaStore } from "./office/quota.js";
import { createRepoReader } from "./office/repoSource.js";
import { createRelay, resolveConfig } from "@hugents/live";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.join(ROOT, "artifacts");
const port = Number(process.env.OFFICE_BRIDGE_PORT ?? 3100);

// The runner reads its own config; the bridge only needs the secret values to redact them from agent output.
let secrets: string[] = [];
try {
  secrets = secretValues(loadConfig());
} catch {
  console.warn("No valid local .env: scenarios will report 'blocked', reports still work");
}

// Provider chain: gemini (only when enabled, keyed and given a model) -> ollama -> deterministic template.
// The key stays in this process: it is added to the redaction list and never logged, sent to the browser or to `duelo/`.
const providerConfig = loadProviderConfig(process.env);
for (const warning of providerConfig.warnings) console.warn(`Provider config: ${warning}`);
if (providerConfig.gemini) secrets.push(providerConfig.gemini.apiKey);
// Read-only GitHub access: the token (optional) stays in this process, is redacted from every report and is not passed to the runner.
const githubToken = process.env.GITHUB_TOKEN?.trim() || undefined;
if (githubToken) secrets.push(githubToken);
const officeDir = path.join(artifactsDir, "office");
const registry = fileProcessRegistry(path.join(officeDir, "runner-pids.json"));
const connections = fileConnectionStore({ file: path.join(officeDir, "connections.json"), readonly: false, seedLocalPath: process.env.OFFICE_GAME_REPO });
const staleRunners = (await registry.stale()).length;
if (staleRunners) console.warn(`${staleRunners} runner process(es) from an earlier office were recorded: use "Clean up stuck runners" in the office to stop them`);
const ollamaOptions = {
  baseUrl: process.env.OFFICE_OLLAMA_URL,
  model: process.env.OFFICE_MODEL,
  visionModel: process.env.OFFICE_VISION_MODEL,
};
const inference = ollamaInference(ollamaOptions);
const budget = await openBudget(path.join(artifactsDir, "office", "provider-usage.json"), providerConfig.limits);
const providers = [
  ...(providerConfig.gemini ? [geminiProvider({ ...providerConfig.gemini, sendImages: providerConfig.gemini.sendScreenshots, budget })] : []),
  ...(providerConfig.ollama ? [ollamaProvider(inference, process.env.OFFICE_MODEL ?? "llama3.2:latest", process.env.OFFICE_VISION_MODEL)] : []),
];
console.log(
  `Report providers: ${[...providers.map((p) => p.name), "deterministic"].join(" -> ")}` +
    (providerConfig.gemini ? ` (gemini models: ${providerConfig.gemini.models.join(", ")})` : ""),
);
const screenshotsToGemini = Boolean(providerConfig.gemini?.sendScreenshots);
console.log(
  `Screenshots: Gemini ${screenshotsToGemini ? "ON (design-critic only, approved screenshots, max " + providerConfig.images.max + ")" : "OFF"}; ` +
    `local vision model ${process.env.OFFICE_VISION_MODEL ? "set" : "not set"}`,
);

// Live browser view (opt-in). The relay is loopback only; frames pass through it in memory and are never stored.
// The runner gets a random worker token per office start. Viewing needs OFFICE_LIVE_VIEWER_TOKEN (the admin login
// will supply it once the popup lands); without it the live view stays off.
let liveEnv: Record<string, string> = {};
if (process.env.OFFICE_LIVE_ENABLED === "true") {
  const viewerToken = (process.env.OFFICE_LIVE_VIEWER_TOKEN ?? "").trim();
  if (viewerToken.length < 16) {
    console.warn("Live view: OFFICE_LIVE_VIEWER_TOKEN (16+ characters) is required, live view stays off");
  } else {
    const livePort = Number(process.env.OFFICE_LIVE_PORT ?? 3101);
    const workerToken = randomBytes(24).toString("hex");
    const relay = createRelay({
      port: livePort,
      viewerToken,
      workerToken,
      config: resolveConfig("high"),
      allowedOrigins: (process.env.OFFICE_LIVE_ORIGINS ?? "http://127.0.0.1:4873,http://localhost:4873").split(",").map((o) => o.trim()).filter(Boolean),
    });
    await relay.start();
    secrets.push(viewerToken, workerToken);
    liveEnv = { QA_LIVE_RELAY_URL: `http://127.0.0.1:${livePort}`, QA_LIVE_WORKER_TOKEN: workerToken };
    console.log(`Live view relay on http://127.0.0.1:${livePort} (local only, read-only)`);
  }
}

const bridge = createBridge({
  port,
  tools: {
    artifactsDir,
    secrets: () => secrets,
    spawnRun: defaultSpawnRun(ROOT, registry, liveEnv),
    // One run, default output `<run>/findings.json`: a findings file path set in the environment must not redirect it.
    observe: async (runId) => {
      await observe(loadObserverConfig({ ...process.env, QA_OBSERVER_FINDINGS_FILE: "" }, artifactsDir), { runDir: runId });
    },
  },
  registry,
  configs: fileAgentConfigStore({ file: path.join(officeDir, "agent-config.json"), readonly: false }),
  quota: fileQuotaStore(path.join(officeDir, "usage.json")),
  gameSource: async () => {
    const all = await connections.get();
    const source = all.sources.find((x) => x.id === all.gameSource);
    return source ? createRepoReader(source, { token: githubToken }) : undefined;
  },
  inference,
  reporter: createReportChain({ providers, secrets: () => secrets, skipped: providerConfig.skipped }),
  screenshots: { ...providerConfig.images, remote: screenshotsToGemini },
  metrics: await openMetrics(path.join(artifactsDir, "office", "metrics.json")),
});

bridge.listen(port, "127.0.0.1", () => console.log(`Office bridge on http://127.0.0.1:${port} (local only)`));
