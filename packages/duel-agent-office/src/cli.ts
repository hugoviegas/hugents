import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig } from "./config.js";
import { parseLiveWorkerConfig } from "./live/config.js";
import { startLiveView } from "./live/liveView.js";
import { launchPlayers } from "./browser/launch.js";
import { runScenario } from "./orchestrator/runScenario.js";
import { EXPLORE_FLOW, EXPLORE_SCENARIO_NAME, exploreScreens } from "./scenarios/exploreScreens.js";
import { cleanupWaitingRoom, FLOW, privateMatchFullGame, SCENARIO_NAME } from "./scenarios/privateMatchFullGame.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXIT = { completed: 0, failed: 1, blocked: 2, config: 64 } as const;

async function main(argv: string[]): Promise<number> {
  const [scenarioName, ...flags] = argv;
  const scenarios = {
    [SCENARIO_NAME]: { scenario: privateMatchFullGame, flow: FLOW, cleanup: cleanupWaitingRoom },
    [EXPLORE_SCENARIO_NAME]: { scenario: exploreScreens, flow: EXPLORE_FLOW, cleanup: undefined },
  };
  const selected = scenarioName ? scenarios[scenarioName as keyof typeof scenarios] : undefined;
  if (!scenarioName || !selected) {
    console.error(`Unknown scenario. Available: ${Object.keys(scenarios).join(", ")}`);
    return EXIT.config;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // Config errors are sanitized by construction: names and rules only, never values.
    console.error(error instanceof ConfigError ? error.message : "Invalid configuration");
    return EXIT.config;
  }
  if (flags.includes("--headed")) config = { ...config, headless: false };
  if (flags.includes("--headless")) config = { ...config, headless: true };

  const liveSettings = parseLiveWorkerConfig(process.env);
  const summary = await runScenario({
    config,
    scenarioName,
    scenario: selected.scenario,
    flow: selected.flow,
    cleanup: selected.cleanup,
    openPlayers: (run, bus, secrets) => launchPlayers(config, run, bus, secrets),
    artifactsDir: path.join(ROOT, "artifacts"),
    ...(liveSettings
      ? {
          startLive: (run, bus, players) =>
            startLiveView({
              settings: liveSettings,
              runId: run.runId,
              players: [players.alpha, players.bravo],
              onEvent: (stage) => void bus.emit("runner", stage === "gate-blocked" ? "blocked" : "working", `live view: ${stage}`).catch(() => undefined),
            }),
        }
      : {}),
  });

  console.log(`Run ${summary.runId}: ${summary.status}${summary.reason ? ` - ${summary.reason}` : ""}`);
  console.log(`Artifacts: artifacts/runs/${summary.runId}/`);
  return EXIT[summary.status];
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  () => {
    console.error("Runner crashed unexpectedly");
    process.exit(EXIT.failed);
  },
);
