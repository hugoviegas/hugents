import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTask, type TaskDeps } from "../src/office/agents.js";
import type { OfficeEvent } from "../src/office/contract.js";
import { investigate } from "../src/office/investigation.js";
import { openMetrics } from "../src/office/metrics.js";
import { openBudget } from "../src/office/provider/budget.js";
import { createReportChain } from "../src/office/provider/chain.js";
import { geminiProvider, type GeminiClientLike } from "../src/office/provider/gemini.js";
import type { ReportProvider, SafeInput } from "../src/office/provider/types.js";
import type { RepoReader } from "../src/office/repoSource.js";
import { latestRunId, type ArtifactsData } from "../src/office/tools.js";
import { pickTargetShots, scenarioIn, screensIn, triage } from "../src/office/triage.js";

// The tasks below are the ones from the first audit of the reports.
const SOLO = "can you play a solo match";
const HOWTO = "see how to create a test run to play solo";
const WHO_WON = "your task is to understand why one of the players won and how.\nCheck the test report and the files to make the report";
const BATTLE = "check why the run battle image is out of range. its only on playwright. just use the battle runs image, from alpha battle over, or bravo first turn";

describe("triage: does the task fit the agent?", () => {
  it("sends a how-to question to the Planner instead of touring screens", () => {
    expect(triage("explorer", HOWTO)).toMatchObject({ decision: "decline", redirect: "test-planner" });
  });

  it("declines solo play for the players: the only match flow needs two players", () => {
    const t = triage("player-alpha", SOLO);
    expect(t).toMatchObject({ decision: "decline", redirect: "test-planner" });
    expect(t.reason).toMatch(/solo play is not a scenario/);
  });

  it("accepts the questions and reviews the audited tasks asked", () => {
    expect(triage("qa-analyst", WHO_WON)).toMatchObject({ decision: "run", scenario: "private-match-full-game" });
    expect(triage("design-critic", BATTLE)).toMatchObject({ decision: "run", scenario: "private-match-full-game" });
  });

  it("sends a question about a result to the Analyst, not a new run", () => {
    expect(triage("player-bravo", "why did alpha lose")).toMatchObject({ decision: "decline", redirect: "qa-analyst" });
    expect(triage("player-bravo", "play a match and tell me why alpha lost")).toMatchObject({ decision: "run" });
  });

  it("declines a task about another agent's job, and runs a task that matches nobody", () => {
    expect(triage("player-alpha", "check the missions screen")).toMatchObject({ decision: "decline", redirect: "explorer" });
    expect(triage("explorer", "review the layout of the battle image")).toMatchObject({ decision: "decline", redirect: "design-critic" });
    expect(triage("explorer", "Do it")).toMatchObject({ decision: "run" });
    expect(triage("test-planner", "anything at all")).toMatchObject({ decision: "run" });
  });

  it("runs every agent's default objective", () => {
    const defaults: [Parameters<typeof triage>[0], string][] = [
      ["player-alpha", "Host a private match and play it to the end, reporting Alpha's turns and any failure."],
      ["player-bravo", "Join the private match with the room code and play it to the end, reporting Bravo's turns and any failure."],
      ["explorer", "Open every player screen once and note redirects, alerts and untranslated text."],
      ["qa-analyst", "Judge the latest run: verdict, severity and suspected area for every finding."],
      ["design-critic", "Review the approved screenshots for layout, readability, touch targets and theme consistency."],
    ];
    for (const [agent, title] of defaults) expect(triage(agent, title).decision, agent).toBe("run");
  });

  it("reads the screens, scenario and run id a task names", () => {
    expect(screensIn("check the shop and the match history")).toEqual(["shop", "match-history"]);
    expect(triage("explorer", "check the shop")).toMatchObject({ decision: "run", screens: ["shop"] });
    expect(scenarioIn("why did bravo win")).toBe("private-match-full-game");
    expect(scenarioIn("how does the missions screen look")).toBe("explore-screens");
    expect(triage("qa-analyst", "analyse 2026-10-01T08-00-00-000Z-explore-screens").runId).toBe("2026-10-01T08-00-00-000Z-explore-screens");
  });
});

describe("triage: screenshots the task points at", () => {
  const names = [
    "alpha/02-logged-in.png", "alpha/03-lobby-create.png", "alpha/04-battle-start.png", "alpha/05-first-turn.png", "alpha/06-game-over.png",
    "bravo/02-logged-in.png", "bravo/03-battle-start.png", "bravo/04-first-turn.png", "bravo/05-game-over.png",
  ];

  it("pairs each side with the words after it", () => {
    expect(pickTargetShots(names, BATTLE, 4)).toEqual(["alpha/06-game-over.png", "bravo/04-first-turn.png"]);
  });

  it("takes the named screen for both sides when no side is given, and the battle screens for a bare 'battle'", () => {
    expect(pickTargetShots(names, "look at the game over screens", 4)).toEqual(["alpha/06-game-over.png", "bravo/05-game-over.png"]);
    expect(pickTargetShots(names, "bravo battle", 4)).toEqual(["bravo/03-battle-start.png", "bravo/04-first-turn.png", "bravo/05-game-over.png"]);
  });

  it("names nothing for a generic review, and respects the cap", () => {
    expect(pickTargetShots(names, "review the screenshots", 4)).toEqual([]);
    expect(pickTargetShots(names, "game over", 1)).toHaveLength(1);
  });
});

describe("who won, and how", () => {
  const events = (agent: string, cards: string[]) => cards.map((c, i) => ({ agent, activity: `Turn ${i + 1}: played ${c}` }));
  const run = (alpha: string[], bravo: string[]): ArtifactsData => ({
    runId: "2026-10-07T14-16-10-419Z-private-match-full-game",
    summary: { result: { outcome: { alpha: "loss", bravo: "win" }, turns: { alpha: alpha.length, bravo: bravo.length } } },
    events: [],
    eventLog: [...events("player-alpha", alpha), ...events("player-bravo", bravo)],
    console: [],
    networkFailures: [],
    totals: { events: 8, console: 0, networkFailures: 0 },
    findings: null,
    screenshots: [],
  });
  const alpha = ["Recarga", "Tiro", "Desvio", "Recarga", "Tiro"];
  const bravo = ["Recarga", "Recarga", "Tiro Duplo", "Recarga", "Contra-golpe"];
  const game: RepoReader = {
    summary: async () => ({ kind: "local", label: "game", commits: [] }),
    listFiles: async () => ["lib/gameEngine.ts"],
    readFile: async () => "if (card === 'Contra-golpe') { attacker.lives -= 1; }",
  };

  it("states the winner, how each side played and the last exchange, with the game rule cited", async () => {
    const inv = await investigate(WHO_WON, run(alpha, bravo), game);
    expect(inv.hypotheses.map((h) => `${h.id}:${h.status}`)).toEqual(["H1:refuted", "H2:confirmed", "H3:confirmed"]);
    expect(inv.conclusion).toMatch(/^Bravo won and Alpha lost\./);
    expect(inv.conclusion).toContain("Alpha attacked with Tiro into Contra-golpe");
    expect(inv.hypotheses[2]!.evidence.join("\n")).toContain("lib/gameEngine.ts:1");
    expect(inv.conclusion).toMatch(/does not record lives or damage per turn/);
  });

  it("does not claim the rule without a game source", async () => {
    const inv = await investigate(WHO_WON, run(alpha, bravo));
    expect(inv.hypotheses[2]!.status).toBe("unverified");
    expect(inv.conclusion).not.toContain("into Contra-golpe");
  });

  it("the generic investigator skips docs and the .github folder", async () => {
    const reader: RepoReader = {
      summary: async () => ({ kind: "local", label: "game", commits: [] }),
      listFiles: async () => [".github/MISSION_FIX_REPORT.md", "docs/missions.md", "lib/missions.ts"],
      readFile: async (f) => `missions are here in ${f}`,
    };
    const inv = await investigate("understand the missions screen behaviour", run(alpha, bravo), reader);
    expect(inv.sources.join(" ")).toContain("lib/missions.ts");
    expect(inv.sources.join(" ")).not.toMatch(/\.github|docs\//);
  });
});

describe("the provider side", () => {
  const input = { agent: "design-critic", run: { id: "r" } } as unknown as SafeInput;

  it("keeps one budget per run and agent, so the Explorer cannot use up the Critic's requests", async () => {
    const seen: string[] = [];
    const p: ReportProvider = { name: "gemini", generate: async (_i, ctx) => (seen.push(ctx.runKey), { attempts: [], tokens: 0 }) };
    const chain = createReportChain({ providers: [p], secrets: () => [] });
    await chain.generate({ ...input, agent: "explorer" } as SafeInput);
    await chain.generate(input);
    expect(seen).toEqual(["r:explorer", "r:design-critic"]);
  });

  it("retries a timeout with half of the screenshots, not the same heavy request", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "triage-budget-"));
    try {
      const sizes: number[] = [];
      const good = JSON.stringify({ verdict: "issues", summary: "ok", findings: [], repeatedProblems: [], nextSteps: [] });
      const client: GeminiClientLike = {
        models: {
          generateContent: async (params) => {
            const parts = (params.contents as { parts: { inlineData?: unknown }[] }[])[0]!.parts;
            sizes.push(parts.filter((x) => x.inlineData).length);
            if (sizes.length === 1) throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
            return { text: good };
          },
        },
      };
      const provider = geminiProvider({
        apiKey: "k", models: ["m1"], timeoutMs: 1_000, maxOutputTokens: 256, client, sendImages: true, retryDelayMs: 0, sleep: async () => undefined,
        budget: await openBudget(path.join(dir, "b.json"), { perRun: 3, perDayPerModel: 50 }),
      });
      const png = { mimeType: "image/png" as const, data: "AAAA" };
      const images = ["a", "b", "c", "d"].map((n) => ({ ...png, name: `alpha/0${n.charCodeAt(0) - 96}-x.png` }));
      const result = await provider.generate(input, { runKey: "r:design-critic", images });
      expect(sizes).toEqual([4, 2]);
      expect(result.report).toBeTruthy();
      expect(result.imagesSent).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("a task through the playbook", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "triage-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const MATCH = "2026-10-07T14-16-10-419Z-private-match-full-game";
  const TOUR = "2026-10-07T14-25-27-885Z-explore-screens";
  async function makeRun(runId: string, summary: object = {}) {
    await mkdir(path.join(dir, "runs", runId), { recursive: true });
    await writeFile(path.join(dir, "runs", runId, "summary.json"), JSON.stringify({ runId, status: "completed", ...summary }));
    await writeFile(path.join(dir, "runs", runId, "events.jsonl"), "");
  }
  async function deps(over: Partial<TaskDeps> = {}, spawnRun?: NonNullable<TaskDeps["tools"]["spawnRun"]>) {
    const events: OfficeEvent[] = [];
    const d: TaskDeps = {
      tools: { artifactsDir: dir, secrets: () => [], spawnRun: spawnRun ?? (async () => { throw new Error("must not start a run"); }) },
      inference: { vision: false, complete: async () => null },
      metrics: await openMetrics(path.join(dir, "metrics.json")),
      emit: (e) => events.push(e),
      ...over,
    };
    return { d, events };
  }

  it("declines a task that is not the agent's job: no run, no quota used, no record change, and says who to ask", async () => {
    const { d, events } = await deps();
    const outcome = await runTask(d, { taskId: "t1", agentId: "explorer", title: HOWTO });
    expect(outcome).toMatchObject({ status: "blocked", declined: true, summary: expect.stringMatching(/^Declined: .*Ask Planner/) });
    expect(outcome.metrics.tasksBlocked).toBe(0);
    expect(events.some((e) => e.activity.startsWith("Not running:"))).toBe(true);
    const report = await readFile(path.join(dir, outcome.reportPath!), "utf8");
    expect(report).toContain("(declined)");
    expect(report).toContain("Suggested agent: Planner");
  });

  it("the Critic and the Analyst read the run of the scenario the task is about, not just the latest run", async () => {
    await makeRun(MATCH);
    await makeRun(TOUR); // newer, but the task is about the match
    expect(await latestRunId(dir)).toBe(TOUR);
    expect(await latestRunId(dir, "private-match-full-game")).toBe(MATCH);
    const { d } = await deps();
    expect((await runTask(d, { taskId: "t1", agentId: "qa-analyst", title: WHO_WON })).runId).toBe(MATCH);
    expect((await runTask(d, { taskId: "t2", agentId: "qa-analyst", title: "Judge the latest run" })).runId).toBe(TOUR);
  });

  it("the Critic loads the screenshots the task names and says so", async () => {
    await makeRun(MATCH, { scenario: "private-match-full-game" });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("x")]);
    const shots = ["alpha/04-battle-start.png", "alpha/06-game-over.png", "bravo/04-first-turn.png"];
    for (const s of shots) {
      await mkdir(path.join(dir, "runs", MATCH, s.split("/")[0]!), { recursive: true });
      await writeFile(path.join(dir, "runs", MATCH, s), png);
    }
    await writeFile(path.join(dir, "runs", MATCH, "events.jsonl"), shots.map((s) => JSON.stringify({ at: "2026-10-07T14:16:10.000Z", runId: MATCH, agent: "player-alpha", status: "working", activity: "shot", scenario: "private-match-full-game", artifactPath: s })).join("\n"));
    const sent: string[][] = [];
    const reporter = { generate: async (_i: SafeInput, o?: { images?: { name: string }[] }) => (sent.push((o?.images ?? []).map((i) => i.name)), { tokens: 0, used: "deterministic" as const, attempts: [] }) };
    const { d, events } = await deps({ reporter, screenshots: { max: 4, maxBytes: 100_000, remote: true } });
    await runTask(d, { taskId: "t1", agentId: "design-critic", title: BATTLE });
    expect(sent[0]).toEqual(["alpha/06-game-over.png", "bravo/04-first-turn.png"]);
    expect(events.some((e) => e.activity === "The task points at: alpha/06-game-over.png, bravo/04-first-turn.png")).toBe(true);
  });

  it("the provider receives the task and the turns each player played", async () => {
    await makeRun(MATCH, { scenario: "private-match-full-game", result: { outcome: { alpha: "loss", bravo: "win" }, turns: { alpha: 1, bravo: 1 } } });
    await writeFile(path.join(dir, "runs", MATCH, "events.jsonl"), [
      { agent: "player-alpha", activity: "Turn 1: played Tiro" },
      { agent: "player-bravo", activity: "Turn 1: played Contra-golpe" },
    ].map((e) => JSON.stringify(e)).join("\n"));
    const seen: SafeInput[] = [];
    const reporter = { generate: async (i: SafeInput) => (seen.push(i), { tokens: 0, used: "deterministic" as const, attempts: [] }) };
    const { d } = await deps({ reporter }, async () => ({ code: 0, stdout: `Run ${MATCH}: completed`, stderr: "" }));
    const outcome = await runTask(d, { taskId: "t1", agentId: "player-alpha", title: "Play the private match" });
    expect(seen[0]).toMatchObject({ task: "Play the private match", turns: { alpha: ["Tiro"] } });
    expect(seen[0]!.turns).not.toHaveProperty("bravo");
    expect(await readFile(path.join(dir, outcome.reportPath!), "utf8")).toContain("## Turns\n- 1: Tiro");
  });
});
