import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseConfig, secretValues } from "../src/config.js";
import { InteractionFailure, MissingSelectorError } from "../src/errors.js";
import { EVENT_STATUSES, EventBus, validateEvent, type RunEvent } from "../src/orchestrator/eventBus.js";
import { runScenario } from "../src/orchestrator/runScenario.js";
import type { PlayerSession } from "../src/browser/playerSession.js";
import { createRunDir, runTimestamp } from "../src/storage/artifacts.js";

const env = {
  GAME_BASE_URL: "https://duel-git-qa-team.vercel.app",
  QA_ALPHA_EMAIL: "alpha@qa.invalid",
  QA_ALPHA_PASSWORD: "alpha-pass-123",
  QA_BRAVO_EMAIL: "bravo@qa.invalid",
  QA_BRAVO_PASSWORD: "bravo-pass-456",
  QA_SCENARIO_TIMEOUT_MS: "10000",
};
const config = parseConfig(env);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-runner-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakePlayers(calls: string[]) {
  const make = (agent: "player-alpha" | "player-bravo") =>
    ({
      agent,
      failureScreenshot: async () => {
        calls.push(`${agent}:failure-screenshot`);
        return { path: `${agent === "player-alpha" ? "alpha" : "bravo"}/01-failure.png` };
      },
      close: async () => {
        calls.push(`${agent}:close`);
      },
    }) as unknown as PlayerSession;
  return { alpha: make("player-alpha"), bravo: make("player-bravo") };
}

const readLines = async (file: string) =>
  (await readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

describe("artifact paths", () => {
  it("creates a unique run directory with separate player folders and empty evidence files", async () => {
    const run = await createRunDir(dir, "private-match-full-game", new Date("2026-10-06T12:30:45.123Z"));
    expect(path.basename(run.root)).toBe("2026-10-06T12-30-45-123Z-private-match-full-game");
    expect(await readdir(run.root)).toEqual(
      expect.arrayContaining(["alpha", "bravo", "events.jsonl", "console.jsonl", "network-failures.jsonl"]),
    );
    expect(runTimestamp(new Date("2026-10-06T12:30:45.123Z"))).not.toMatch(/[:.]/);
    const second = await createRunDir(dir, "private-match-full-game", new Date("2026-10-06T12:30:46.000Z"));
    expect(second.root).not.toBe(run.root);
  });
});

describe("event schema", () => {
  const valid: RunEvent = {
    at: "2026-10-06T12:00:00.000Z",
    runId: "r",
    agent: "player-alpha",
    status: "working",
    activity: "x",
    scenario: "s",
  };

  it("accepts exactly the eight documented statuses", () => {
    expect([...EVENT_STATUSES]).toEqual([
      "idle", "planning", "working", "waiting", "reviewing", "blocked", "completed", "failed",
    ]);
    for (const status of EVENT_STATUSES) expect(() => validateEvent({ ...valid, status })).not.toThrow();
    expect(() => validateEvent({ ...valid, status: "quota_exhausted" as never })).toThrow();
  });

  it("rejects unknown agents and absolute artifact paths", () => {
    expect(() => validateEvent({ ...valid, agent: "player-charlie" as never })).toThrow();
    expect(() => validateEvent({ ...valid, artifactPath: "C:/Users/x/shot.png" })).toThrow();
    expect(() => validateEvent({ ...valid, artifactPath: "/home/x/shot.png" })).toThrow();
    expect(() => validateEvent({ ...valid, artifactPath: "alpha/01-login.png" })).not.toThrow();
  });

  it("writes redacted JSONL with the required fields", async () => {
    const run = await createRunDir(dir, "s");
    const bus = new EventBus(run.events, run.runId, "s", secretValues(config));
    await bus.emit("player-alpha", "working", `typed ${env.QA_ALPHA_PASSWORD} at ${env.GAME_BASE_URL}/menu?token=zzz`);
    const [event] = await readLines(run.events);
    expect(Object.keys(event!).sort()).toEqual(["activity", "agent", "at", "runId", "scenario", "status"]);
    const text = JSON.stringify(event);
    for (const secret of secretValues(config)) expect(text).not.toContain(secret);
  });
});

describe("runScenario", () => {
  it("ends blocked on a missing selector, keeps evidence and leaks no credential", async () => {
    const calls: string[] = [];
    const summary = await runScenario({
      config,
      scenarioName: "private-match-full-game",
      flow: "private-room-code",
      artifactsDir: dir,
      openPlayers: async () => fakePlayers(calls),
      scenario: async () => {
        throw new MissingSelectorError(`challenge button for ${env.QA_ALPHA_EMAIL} on ${env.GAME_BASE_URL}`);
      },
    });

    expect(summary.status).toBe("blocked");
    expect(summary.blockedOn).toBe("missing-selector");
    expect(summary.evidence.failureScreenshots).toEqual(["alpha/01-failure.png", "bravo/01-failure.png"]);
    expect(calls).toEqual(
      expect.arrayContaining(["player-alpha:failure-screenshot", "player-bravo:failure-screenshot", "player-alpha:close", "player-bravo:close"]),
    );

    const root = path.join(dir, "runs", summary.runId);
    const files = await Promise.all(
      ["summary.json", "events.jsonl", "console.jsonl", "network-failures.jsonl"].map((f) => readFile(path.join(root, f), "utf8")),
    );
    for (const secret of secretValues(config)) for (const text of files) expect(text).not.toContain(secret);

    const events = await readLines(path.join(root, "events.jsonl"));
    expect(events.at(-1)).toMatchObject({ agent: "runner", status: "blocked" });
    expect(events.filter((e) => e.status === "blocked").map((e) => e.agent)).toEqual(
      expect.arrayContaining(["player-alpha", "player-bravo"]),
    );
    expect(JSON.parse(files[0]!)).toMatchObject({
      status: "blocked",
      flow: "private-room-code",
      loginMode: "email-password",
    });
  });

  it("ends failed for an unexpected error and still closes both players", async () => {
    const calls: string[] = [];
    const summary = await runScenario({
      config,
      scenarioName: "s",
      flow: "private-room-code",
      artifactsDir: dir,
      openPlayers: async () => fakePlayers(calls),
      scenario: async () => {
        throw new Error("boom");
      },
    });
    expect(summary.status).toBe("failed");
    expect(summary.reason).toBe("boom");
    expect(calls.filter((c) => c.endsWith(":close"))).toHaveLength(2);
  });

  it("ends failed with a timeout message when the scenario hangs", async () => {
    const summary = await runScenario({
      config: { ...config, scenarioTimeoutMs: 50 },
      scenarioName: "s",
      flow: "private-room-code",
      artifactsDir: dir,
      openPlayers: async () => fakePlayers([]),
      scenario: () => new Promise(() => undefined),
    });
    expect(summary.status).toBe("failed");
    expect(summary.reason).toBe("Scenario timeout reached");
  });

  it("writes a failed summary when the browser cannot be opened", async () => {
    const summary = await runScenario({
      config,
      scenarioName: "s",
      flow: "private-room-code",
      artifactsDir: dir,
      openPlayers: async () => {
        throw new Error("browser missing");
      },
      scenario: async () => {
        throw new Error("never reached");
      },
    });
    expect(summary.status).toBe("failed");
    expect(summary.reason).toBe("browser missing");
  });
});

describe("battle interaction failures", () => {
  it("records only the sanitized category and failing player in summary and events", async () => {
    const calls: string[] = [];
    const summary = await runScenario({
      config,
      scenarioName: "s",
      flow: "private-room-code",
      artifactsDir: dir,
      openPlayers: async () => fakePlayers(calls),
      scenario: async () => {
        const failure = new InteractionFailure("confirm-did-not-advance");
        failure.agent = "player-bravo";
        throw failure;
      },
    });

    expect(summary.status).toBe("failed");
    expect(summary.failure).toEqual({ category: "confirm-did-not-advance", agent: "player-bravo" });
    expect(summary.reason).toBe("Battle interaction failed: confirm-did-not-advance");

    const root = path.join(dir, "runs", summary.runId);
    const events = await readLines(path.join(root, "events.jsonl"));
    const failed = events.filter((e) => e.status === "failed");
    expect(failed.length).toBeGreaterThanOrEqual(3);
    for (const e of failed) expect(String(e.activity)).toContain("confirm-did-not-advance");
    expect(await readFile(path.join(root, "summary.json"), "utf8")).not.toMatch(/Tiro|Recarga|Desvio/);
  });

  it("notes a skipped screenshot (sensitive screen) and lists no path for it", async () => {
    const make = (agent: "player-alpha" | "player-bravo") =>
      ({
        agent,
        failureScreenshot: async () => ({ skipped: true }),
        close: async () => undefined,
      }) as unknown as PlayerSession;
    const summary = await runScenario({
      config,
      scenarioName: "s",
      flow: "private-room-code",
      artifactsDir: dir,
      openPlayers: async () => ({ alpha: make("player-alpha"), bravo: make("player-bravo") }),
      scenario: async () => {
        throw new Error("lobby failed");
      },
    });
    expect(summary.evidence.failureScreenshots).toEqual([]);
    const events = await readLines(path.join(dir, "runs", summary.runId, "events.jsonl"));
    const playerFailures = events.filter((e) => String(e.agent).startsWith("player-") && e.status === "failed");
    for (const e of playerFailures) {
      expect(String(e.activity)).toContain("screenshot skipped");
      expect(e.artifactPath).toBeUndefined();
    }
  });
});
