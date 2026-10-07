import { writeFile } from "node:fs/promises";
import type { Config } from "../config.js";
import { secretValues } from "../config.js";
import { BlockedError, InteractionFailure, type InteractionCategory } from "../errors.js";
import type { PlayerSession } from "../browser/playerSession.js";
import { redact } from "../redact.js";
import { createRunDir, type RunPaths } from "../storage/artifacts.js";
import { EventBus } from "./eventBus.js";
import type { ScenarioContext, ScenarioResult } from "../scenarios/privateMatchFullGame.js";
import type { ExploreResult } from "../scenarios/exploreScreens.js";

type AnyResult = ScenarioResult | ExploreResult;

export type RunStatus = "completed" | "blocked" | "failed";

export interface RunSummary {
  runId: string;
  scenario: string;
  flow: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  loginMode: "email-password" | "dev-login";
  players: string[];
  result?: AnyResult;
  /** Redacted, human-readable reason for blocked/failed runs. */
  reason?: string;
  blockedOn?: BlockedError["kind"];
  /** Sanitized battle-interaction failure: category and failing player only. */
  failure?: { category: InteractionCategory; agent?: string };
  evidence: {
    events: string;
    console: string;
    networkFailures: string;
    failureScreenshots: string[];
  };
}

export interface RunDeps {
  config: Config;
  scenarioName: string;
  scenario: (ctx: ScenarioContext) => Promise<AnyResult>;
  /** Entry flow recorded in the summary, e.g. "private-room-code". */
  flow: string;
  /** Best-effort UI cleanup after a failed run (runs after failure screenshots, before close). */
  cleanup?: (ctx: ScenarioContext) => Promise<void>;
  /** Opens the two isolated players. Injected so tests never launch a browser. */
  openPlayers: (run: RunPaths, bus: EventBus, secrets: string[]) => Promise<{ alpha: PlayerSession; bravo: PlayerSession }>;
  artifactsDir: string;
  now?: () => Date;
}

class ScenarioTimeout extends Error {
  constructor() {
    super("Scenario timeout reached");
  }
}

export async function runScenario(deps: RunDeps): Promise<RunSummary> {
  const now = deps.now ?? (() => new Date());
  const { config, scenarioName } = deps;
  const secrets = secretValues(config);
  const started = now();
  const run = await createRunDir(deps.artifactsDir, scenarioName, started);
  const bus = new EventBus(run.events, run.runId, scenarioName, secrets, now);

  let status: RunStatus = "failed";
  let reason: string | undefined;
  let blockedOn: BlockedError["kind"] | undefined;
  let failure: RunSummary["failure"];
  let result: AnyResult | undefined;
  const failureScreenshots: string[] = [];
  let players: { alpha: PlayerSession; bravo: PlayerSession } | undefined;
  let timer: NodeJS.Timeout | undefined;
  let ctx: ScenarioContext | undefined;

  try {
    await bus.emit("runner", "planning", "Starting run");
    players = await deps.openPlayers(run, bus, secrets);
    ctx = {
      config,
      secrets,
      run,
      bus,
      alpha: players.alpha,
      bravo: players.bravo,
      deadline: started.getTime() + config.scenarioTimeoutMs,
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ScenarioTimeout()), config.scenarioTimeoutMs);
    });
    const scenarioRun = deps.scenario(ctx);
    scenarioRun.catch(() => undefined); // a late rejection after the timeout must not crash the process
    result = await Promise.race([scenarioRun, timeout]);
    status = "completed";
  } catch (error) {
    if (error instanceof BlockedError) {
      status = "blocked";
      blockedOn = error.kind;
    }
    if (error instanceof InteractionFailure) failure = { category: error.category, ...(error.agent ? { agent: error.agent } : {}) };
    reason = redact(error instanceof Error ? error.message : String(error), secrets).slice(0, 500);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (status !== "completed" && players) {
    for (const player of [players.alpha, players.bravo]) {
      const shot = await player.failureScreenshot();
      if (shot.path) failureScreenshots.push(shot.path);
      const note = shot.skipped ? " (screenshot skipped: sensitive screen)" : "";
      await bus.emit(player.agent, status === "blocked" ? "blocked" : "failed", `${reason ?? "Run ended"}${note}`, shot.path);
    }
  }
  if (status !== "completed" && ctx && deps.cleanup) await deps.cleanup(ctx).catch(() => undefined);
  await bus.emit(
    "runner",
    status === "completed" ? "completed" : status === "blocked" ? "blocked" : "failed",
    reason ?? "Run completed",
  );

  if (players) {
    await Promise.all([players.alpha.close(), players.bravo.close()]);
  }

  const finished = now();
  // `reason` is the only free-text field and is redacted above; the rest is fixed vocabulary.
  const summary: RunSummary = {
      runId: run.runId,
      scenario: scenarioName,
      flow: deps.flow,
      status,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      loginMode: config.devLogin.enabled ? "dev-login" : "email-password",
      players: ["player-alpha", "player-bravo"],
      ...(result ? { result } : {}),
      ...(reason ? { reason } : {}),
      ...(blockedOn ? { blockedOn } : {}),
      ...(failure ? { failure } : {}),
      evidence: {
        events: "events.jsonl",
        console: "console.jsonl",
        networkFailures: "network-failures.jsonl",
        failureScreenshots,
      },
    };
  await writeFile(run.summary, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
