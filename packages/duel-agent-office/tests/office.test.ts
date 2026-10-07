import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTask, type TaskDeps } from "../src/office/agents.js";
import { createBridge } from "../src/office/bridge.js";
import { OFFICE_AGENT_IDS, type OfficeEvent, type OfficeTask } from "../src/office/contract.js";
import type { CompleteRequest, Inference } from "../src/office/inference.js";
import { ollamaInference } from "../src/office/inference.js";
import { openMetrics } from "../src/office/metrics.js";
import { createReportChain } from "../src/office/provider/chain.js";
import type { ProviderAttempt, ReportProvider, SafeInput, StructuredReport } from "../src/office/provider/types.js";
import { loadObserverConfig } from "../src/observer/config.js";
import { observe } from "../src/observer/scan.js";
import { readArtifacts, runPlaywrightScenario, writeReport, type SpawnResult, type ToolDeps } from "../src/office/tools.js";

const SECRET = "hunter2-qa-password";
const EMAIL = "alpha@qa.example";
const RUN_ID = "2026-10-06T12-30-45-123Z-explore-screens";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-office-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makeRun(runId = RUN_ID, summary: Record<string, unknown> = {}) {
  const root = path.join(dir, "runs", runId);
  await mkdir(path.join(root, "alpha", "video"), { recursive: true });
  await mkdir(path.join(root, "bravo"), { recursive: true });
  await writeFile(
    path.join(root, "summary.json"),
    JSON.stringify({
      runId,
      scenario: "explore-screens",
      status: "completed",
      durationMs: 12_000,
      reason: `typed ${SECRET} for ${EMAIL}`,
      result: { screens: [{ screen: "menu", ok: true }, { screen: "shop", ok: false, reason: "redirected" }] },
      ...summary,
    }),
  );
  await writeFile(
    path.join(root, "events.jsonl"),
    `${JSON.stringify({
      at: "2026-10-06T12:30:46.000Z",
      runId,
      agent: "player-alpha",
      status: "working",
      scenario: "explore-screens",
      activity: `login ${EMAIL}`,
      artifactPath: "alpha/01-menu.png",
    })}\n`,
  );
  await writeFile(
    path.join(root, "console.jsonl"),
    `${JSON.stringify({ kind: "console-error", text: `boom ${SECRET}` })}\nnot json\n`,
  );
  await writeFile(path.join(root, "network-failures.jsonl"), `${JSON.stringify({ kind: "http-error", method: "GET", status: 500 })}\n`);
  await writeFile(path.join(root, "alpha", "01-menu.png"), PNG);
  await writeFile(path.join(root, "alpha", "99-unreferenced.png"), PNG); // no event references it: not approved
  await writeFile(path.join(root, "alpha", "trace.zip"), "SENSITIVE");
  await writeFile(path.join(root, "alpha", "video", "clip.webm"), "SENSITIVE");
  await writeFile(path.join(root, ".env"), `QA=${SECRET}`);
  return runId;
}

const tools = (extra: Partial<ToolDeps> = {}): ToolDeps => ({
  artifactsDir: dir,
  secrets: () => [SECRET],
  now: () => new Date("2026-10-06T13:00:00.000Z"),
  ...extra,
});

describe("read_artifacts", () => {
  it("returns redacted evidence and only approved screenshots", async () => {
    await makeRun();
    const result = await readArtifacts(tools(), { runId: RUN_ID });
    expect(result.ok).toBe(true);
    const text = JSON.stringify(result.data);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain("SENSITIVE");
    expect(result.data?.screenshots).toEqual(["alpha/01-menu.png"]);
    expect(result.data?.findings).toBeNull();
    expect(result.data?.console).toHaveLength(2); // the unparsable line is kept as a (redacted) string
    expect(result.data?.totals).toEqual({ events: 1, console: 2, networkFailures: 1 });
  });

  it("runs the local observer when findings.json is missing and returns its validated report", async () => {
    await makeRun();
    const observeRun = async (runId: string) => {
      await observe(loadObserverConfig({}, dir), { runDir: runId });
    };
    const data = (await readArtifacts(tools({ observe: observeRun }), { runId: RUN_ID })).data;
    expect(data?.findings).toMatchObject({ kind: "duel-agent-office/findings", scope: "run" });
    const categories = data?.findings?.runs[0]?.findings.map((f) => f.category) ?? [];
    expect(categories).toEqual(expect.arrayContaining(["console-error", "http-5xx"]));
    expect(JSON.stringify(data)).not.toContain(SECRET);
    // the existing file is reused, the observer is not asked again
    let calls = 0;
    await readArtifacts(tools({ observe: async () => void (calls += 1) }), { runId: RUN_ID });
    expect(calls).toBe(0);
  });

  it("flags an unusable findings.json and a failing observer without losing the rest", async () => {
    await makeRun();
    await writeFile(path.join(dir, "runs", RUN_ID, "findings.json"), JSON.stringify({ findings: [{ id: "f1" }] }));
    expect((await readArtifacts(tools(), { runId: RUN_ID })).data).toMatchObject({ findings: null, findingsNote: "invalid" });

    await rm(path.join(dir, "runs", RUN_ID, "findings.json"));
    const failing = tools({ observe: async () => Promise.reject(new Error("boom")) });
    const data = (await readArtifacts(failing, { runId: RUN_ID })).data;
    expect(data).toMatchObject({ findings: null, findingsNote: "observer-failed" });
    expect(data?.summary).toBeTruthy();
  });

  it("resolves 'latest' and rejects ids that could escape the runs folder", async () => {
    await makeRun("2026-10-05T10-00-00-000Z-explore-screens");
    await makeRun();
    expect((await readArtifacts(tools(), { runId: "latest" })).data?.runId).toBe(RUN_ID);
    for (const bad of ["../x", "..\\..\\.env", "alpha", "", 5]) {
      expect((await readArtifacts(tools(), { runId: bad })).ok).toBe(false);
    }
  });

  it("'latest' skips a run that has no summary yet, so an unfinished run never hides the last finished one", async () => {
    await makeRun("2026-10-05T10-00-00-000Z-explore-screens");
    await mkdir(path.join(dir, "runs", "2026-10-07T09-00-00-000Z-explore-screens", "alpha"), { recursive: true }); // in progress
    expect((await readArtifacts(tools(), { runId: "latest" })).data?.runId).toBe("2026-10-05T10-00-00-000Z-explore-screens");
    // an explicit id of the unfinished run is still refused
    expect((await readArtifacts(tools(), { runId: "2026-10-07T09-00-00-000Z-explore-screens" })).ok).toBe(false);
  });

  it("fails clearly when no run exists", async () => {
    const result = await readArtifacts(tools(), { runId: "latest" });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("write_report", () => {
  it("saves a redacted .md under reports/ and rejects unknown agents", async () => {
    const result = await writeReport(tools(), { agentId: "explorer", content: `found ${SECRET} and ${EMAIL}` });
    expect(result.data?.reportPath).toBe("reports/explorer-2026-10-06T13-00-00-000Z.md");
    const saved = await readFile(path.join(dir, result.data!.reportPath), "utf8");
    expect(saved).not.toContain(SECRET);
    expect(saved).not.toContain(EMAIL);
    expect((await writeReport(tools(), { agentId: "../evil", content: "x" })).ok).toBe(false);
    expect((await writeReport(tools(), { agentId: "explorer", content: "  " })).ok).toBe(false);
    expect(await readdir(path.join(dir, "reports"))).toHaveLength(1);
  });
});

describe("run_playwright_scenario", () => {
  const spawnOk = (stdout: string): ToolDeps["spawnRun"] => async () => ({ code: 0, stdout, stderr: "" });

  it("parses the runner result, redacts the reason and lists existing artifacts", async () => {
    await makeRun();
    const result = await runPlaywrightScenario(
      tools({ spawnRun: spawnOk(`Run ${RUN_ID}: failed - lost ${SECRET}\nArtifacts: x`) }),
      { scenario: "explore-screens" },
    );
    expect(result.data).toMatchObject({ runId: RUN_ID, status: "failed" });
    expect(result.data?.reason).not.toContain(SECRET);
    expect(result.data?.artifactPaths).toContain(`runs/${RUN_ID}/summary.json`);
    expect(result.data?.artifactPaths).not.toContain(`runs/${RUN_ID}/findings.json`);
  });

  it("refuses credentials/config params and unknown scenarios without starting anything", async () => {
    let started = 0;
    const deps = tools({ spawnRun: async () => ((started += 1), { code: 0, stdout: "", stderr: "" }) });
    for (const params of [
      { scenario: "explore-screens", qaCredentials: { email: EMAIL } },
      { scenario: "explore-screens", config: {} },
      { scenario: "rm -rf" },
      {},
    ]) {
      expect((await runPlaywrightScenario(deps, params)).ok).toBe(false);
    }
    expect(started).toBe(0);
  });

  it("reports blocked with a redacted reason when the runner prints no result (invalid config)", async () => {
    const result = await runPlaywrightScenario(
      tools({ spawnRun: async () => ({ code: 64, stdout: "", stderr: `Invalid configuration: GAME_BASE_URL is empty ${SECRET}\n` }) }),
      { scenario: "private-match-full-game" },
    );
    expect(result.data).toMatchObject({ status: "blocked", artifactPaths: [] });
    expect(result.data?.reason).toContain("GAME_BASE_URL is empty");
    expect(result.data?.reason).not.toContain(SECRET);
  });

  it("never runs two scenarios at once (same QA accounts)", async () => {
    let active = 0;
    let peak = 0;
    const spawnRun = async (): Promise<SpawnResult> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return { code: 0, stdout: `Run ${RUN_ID}: completed`, stderr: "" };
    };
    await Promise.all([1, 2, 3].map(() => runPlaywrightScenario(tools({ spawnRun }), { scenario: "explore-screens" })));
    expect(peak).toBe(1);
  });
});

function fakeInference(text: string | null, vision = false) {
  const requests: CompleteRequest[] = [];
  const inference: Inference = {
    vision,
    async complete(request) {
      requests.push(request);
      return text === null ? null : { text, tokens: 42 };
    },
  };
  return { inference, requests };
}

async function setupTask(agentId: OfficeTask["agentId"], inference: Inference, title = "Test the Missions screen") {
  await makeRun();
  const events: OfficeEvent[] = [];
  const metrics = await openMetrics(path.join(dir, "office", "metrics.json"));
  const deps: TaskDeps = {
    tools: tools({
      spawnRun: async () => ({ code: 0, stdout: `Run ${RUN_ID}: completed`, stderr: "" }),
    }),
    inference,
    metrics,
    emit: (e: OfficeEvent) => events.push(e),
    now: () => new Date("2026-10-06T13:00:00.000Z"),
  };
  const task: OfficeTask = { taskId: "t1", agentId, title };
  return { deps, task, events, metrics };
}

describe("agent tasks", () => {
  // design-critic has its own tests below: without a vision model it never calls a model.
  it.each(OFFICE_AGENT_IDS.filter((id) => id !== "design-critic"))("%s claims a task, runs its tools and reports back", async (agentId) => {
    const { inference } = fakeInference("## Verdict\nAll good");
    const { deps, task, events } = await setupTask(agentId, inference);
    const outcome = await runTask(deps, task);

    expect(outcome).toMatchObject({ status: "completed", usedFallback: false, tokensUsed: 42, runId: RUN_ID });
    expect(outcome.reportPath).toMatch(new RegExp(`^reports/${agentId}-`));
    expect((await readFile(path.join(dir, outcome.reportPath!), "utf8"))).toContain("All good");
    expect(events[0]).toMatchObject({ status: "working", agentId });
    expect(events.at(-1)).toMatchObject({ status: "completed", result: { reportPath: outcome.reportPath } });
    expect(events.every((e) => e.taskId === "t1")).toBe(true);
    expect(outcome.metrics).toMatchObject({ tasksCompleted: 1, tokensUsed: 42, reputation: 0.55 });
  });

  it("falls back to the deterministic template when Ollama is unavailable", async () => {
    const { inference } = fakeInference(null);
    const { deps, task, events } = await setupTask("explorer", inference);
    const outcome = await runTask(deps, task);
    expect(outcome).toMatchObject({ status: "completed", usedFallback: true, tokensUsed: 0 });
    const report = await readFile(path.join(dir, outcome.reportPath!), "utf8");
    expect(report).toContain("## Screens");
    expect(report).toContain("- shop: redirected");
    expect(events.some((e) => e.activity.includes("Ollama unavailable"))).toBe(true);
  });

  it("fails soft when the Ollama HTTP call itself fails", async () => {
    const inference = ollamaInference({
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    expect(await inference.complete({ system: "s", prompt: "p" })).toBeNull();
  });

  it("never lets secrets or e-mails reach events or the report", async () => {
    const { inference } = fakeInference(`model echoed ${SECRET} and ${EMAIL}`);
    const { deps, task, events } = await setupTask("qa-analyst", inference);
    const outcome = await runTask(deps, task);
    const everything = JSON.stringify(events) + (await readFile(path.join(dir, outcome.reportPath!), "utf8"));
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(EMAIL);
  });

  it("is blocked, with metrics updated, when the run cannot start", async () => {
    const { inference } = fakeInference("x");
    const { deps, task, metrics } = await setupTask("player-alpha", inference);
    deps.tools.spawnRun = async () => ({ code: 64, stdout: "", stderr: "Invalid configuration: GAME_BASE_URL is empty" });
    const outcome = await runTask(deps, task);
    expect(outcome).toMatchObject({ status: "blocked" });
    expect(outcome.summary).toContain("GAME_BASE_URL is empty");
    expect(metrics.get("player-alpha")).toMatchObject({ tasksBlocked: 1, reputation: 0.45 });
  });

  it("is blocked when the analyst has no run to read", async () => {
    const { inference } = fakeInference("x");
    const { deps, task } = await setupTask("qa-analyst", inference);
    await rm(path.join(dir, "runs"), { recursive: true });
    expect(await runTask(deps, task)).toMatchObject({ status: "blocked" });
  });

  it("keeps the run id readable in event text while still redacting secrets", async () => {
    const { inference } = fakeInference("ok");
    const { deps, task, events } = await setupTask("qa-analyst", inference, `Analyse ${RUN_ID} with ${SECRET}`);
    await runTask(deps, task);
    expect(events[0]?.activity).toContain(RUN_ID);
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  it("analyses the run id named in the task title", async () => {
    await makeRun("2026-10-01T08-00-00-000Z-explore-screens");
    const { inference } = fakeInference("ok");
    const { deps, task } = await setupTask("qa-analyst", inference, "Analyse 2026-10-01T08-00-00-000Z-explore-screens");
    expect((await runTask(deps, task)).runId).toBe("2026-10-01T08-00-00-000Z-explore-screens");
  });

  it("marks the task blocked when the run itself ended blocked", async () => {
    const { inference } = fakeInference("x");
    const { deps, task } = await setupTask("player-alpha", inference);
    await writeFile(path.join(dir, "runs", RUN_ID, "summary.json"), JSON.stringify({ status: "blocked", reason: "missing-precondition" }));
    deps.tools.spawnRun = async () => ({ code: 2, stdout: `Run ${RUN_ID}: blocked - missing-precondition`, stderr: "" });
    expect(await runTask(deps, task)).toMatchObject({ status: "blocked" });
  });

  it("design-critic without a vision model answers at once with the checklist: no model call at all", async () => {
    const noVision = fakeInference("would be generic text", false);
    const { deps, task, events } = await setupTask("design-critic", noVision.inference);
    const outcome = await runTask(deps, task);
    expect(noVision.requests).toHaveLength(0);
    expect(outcome).toMatchObject({ status: "completed", usedFallback: true, tokensUsed: 0 });
    expect(await readFile(path.join(dir, outcome.reportPath!), "utf8")).toContain("Design checklist (no vision model");
    expect(events.some((e) => e.activity.includes("No vision model configured"))).toBe(true);
  });

  it("sends screenshots to a vision model only when one is configured (design-critic)", async () => {
    const withVision = fakeInference("looks fine", true);
    const a = await setupTask("design-critic", withVision.inference);
    await runTask(a.deps, a.task);
    expect(withVision.requests[0]?.images).toEqual([PNG.toString("base64")]);

    const noVision = fakeInference("looks fine", false);
    const b = await setupTask("design-critic", noVision.inference);
    await runTask(b.deps, b.task);
    expect(noVision.requests).toHaveLength(0);
  });
});

describe("analyst report", () => {
  it("leads with the observer verdict and findings, and does not call cancelled requests problems", async () => {
    const { inference } = fakeInference(null);
    const { deps, task } = await setupTask("qa-analyst", inference);
    await writeFile(
      path.join(dir, "runs", RUN_ID, "network-failures.jsonl"),
      `${JSON.stringify({ at: "2026-10-06T12:30:47.000Z", agent: "player-alpha", kind: "request-failed", method: "GET", url: "x", failure: "net::ERR_ABORTED" })}\n`,
    );
    deps.tools.observe = async (runId) => {
      await observe(loadObserverConfig({}, dir), { runDir: runId });
    };
    const outcome = await runTask(deps, task);
    const report = await readFile(path.join(dir, outcome.reportPath!), "utf8");
    expect(report).toContain("## Observer verdict");
    expect(report).toMatch(/Observer: \d+ finding\(s\)/);
    expect(report).toContain("console-error");
    expect(report).toContain("Ignored by default: 1 cancelled network request(s)");
    expect(report).not.toContain("GET net::ERR_ABORTED");
    expect(report).toMatch(/Events: 1, console records: 2, network failures: 1 \(the last 1\/2\/1 lines were read\)/);
  });

  it("falls back to raw records and counts cancelled requests apart when there is no observer", async () => {
    const { inference } = fakeInference(null);
    const { deps, task } = await setupTask("qa-analyst", inference);
    await writeFile(
      path.join(dir, "runs", RUN_ID, "network-failures.jsonl"),
      [
        { kind: "request-failed", method: "GET", failure: "net::ERR_ABORTED" },
        { kind: "http-error", method: "GET", status: 500 },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
    );
    const outcome = await runTask(deps, task);
    const report = await readFile(path.join(dir, outcome.reportPath!), "utf8");
    expect(report).toContain("observer not available, raw records instead");
    expect(report).toContain("GET 500");
    expect(report).toContain("1 cancelled request(s) (net::ERR_ABORTED) not counted as problems");
  });
});

describe("report providers in a task", () => {
  const REPORT: StructuredReport = {
    verdict: "issues",
    summary: "The run completed with one observation.",
    findings: [{ severity: "low", category: "console-error", assessment: "One page error.", area: "missions" }],
    repeatedProblems: [],
    nextSteps: ["Reproduce once more."],
  };
  const provider = (attempts: ProviderAttempt[], report?: StructuredReport, tokens = 0) => {
    const seen: SafeInput[] = [];
    const p: ReportProvider = { name: "gemini", generate: async (input) => (seen.push(input), { attempts, ...(report ? { report } : {}), tokens }) };
    return { p, seen };
  };
  const GEMINI_OK: ProviderAttempt = { provider: "gemini", model: "gemini-3.5-flash-lite", status: "ok" };

  async function withChain(agentId: OfficeTask["agentId"], p: ReportProvider, title?: string) {
    const { inference } = fakeInference("legacy text");
    const ctx = await setupTask(agentId, inference, title);
    ctx.deps.reporter = createReportChain({ providers: [p], secrets: () => [SECRET] });
    return ctx;
  }

  it("writes the provider's structured report, its provider line and its tokens", async () => {
    const { p, seen } = provider([GEMINI_OK], REPORT, 321);
    const { deps, task, events } = await withChain("qa-analyst", p);
    const outcome = await runTask(deps, task);
    const report = await readFile(path.join(dir, outcome.reportPath!), "utf8");
    expect(report).toContain("## Verdict: issues");
    expect(report).toContain("[low] console-error: One page error.");
    expect(report).toContain("Report provider: gemini (gemini-3.5-flash-lite)");
    expect(report).toContain("## Evidence"); // the deterministic block is always kept
    expect(outcome).toMatchObject({ usedFallback: false, tokensUsed: 321, provider: { used: "gemini", model: "gemini-3.5-flash-lite" } });
    expect(events.some((e) => e.activity === "Report provider: gemini (gemini-3.5-flash-lite)")).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it("falls back to the deterministic template and says why, with statuses only", async () => {
    const { p } = provider([{ provider: "gemini", model: "gemini-3.5-flash-lite", status: "rate-limit" }]);
    const { deps, task, events } = await withChain("qa-analyst", p);
    const outcome = await runTask(deps, task);
    const report = await readFile(path.join(dir, outcome.reportPath!), "utf8");
    expect(outcome).toMatchObject({ usedFallback: true, tokensUsed: 0, provider: { used: "deterministic" }, status: "completed" });
    expect(report).toContain("## Evidence");
    expect(report).toContain("Report provider: deterministic; skipped or failed: gemini gemini-3.5-flash-lite: rate-limit");
    expect(events.some((e) => e.activity.startsWith("Report provider: deterministic"))).toBe(true);
  });

  it("never gives a provider the task title, memories or raw record text", async () => {
    const { p, seen } = provider([GEMINI_OK], REPORT);
    const { deps, task } = await withChain("qa-analyst", p, `Analyst: review with ${SECRET} please`);
    task.memories = [`earlier note ${EMAIL}`];
    await runTask(deps, task);
    const sent = JSON.stringify(seen);
    for (const forbidden of [SECRET, EMAIL, "review with", "earlier note", "boom"]) expect(sent, forbidden).not.toContain(forbidden);
  });

  it("covers player-alpha and explorer too, but design-critic keeps its local path (screenshots never leave)", async () => {
    for (const agent of ["player-alpha", "explorer"] as const) {
      const { p, seen } = provider([GEMINI_OK], REPORT);
      const { deps, task } = await withChain(agent, p);
      await runTask(deps, task);
      expect(seen, agent).toHaveLength(1);
    }
    const { p, seen } = provider([GEMINI_OK], REPORT);
    const { deps, task } = await withChain("design-critic", p);
    const outcome = await runTask(deps, task);
    expect(seen).toHaveLength(0);
    expect(outcome.provider).toBeUndefined();
  });
});

describe("metrics", () => {
  it("persists across sessions and keeps reputation within 0..1", async () => {
    const file = path.join(dir, "office", "metrics.json");
    const first = await openMetrics(file);
    for (let i = 0; i < 30; i += 1) await first.record("explorer", "completed", 10);
    expect(first.get("explorer")).toMatchObject({ tasksCompleted: 30, tokensUsed: 300, reputation: 1 });
    const second = await openMetrics(file);
    expect(second.get("explorer").tasksCompleted).toBe(30);
    for (let i = 0; i < 30; i += 1) await second.record("explorer", "blocked", 0);
    expect(second.get("explorer").reputation).toBe(0);
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

function request(port: number, opts: { method: string; path: string; body?: string; headers?: Record<string, string> }) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: opts.method, path: opts.path, headers: opts.headers },
      (res) => {
        let text = "";
        res.on("data", (c: Buffer) => (text += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}

describe("bridge", () => {
  async function start(inference: Inference) {
    await makeRun();
    const port = await freePort();
    const metrics = await openMetrics(path.join(dir, "office", "metrics.json"));
    const server = createBridge({
      port,
      inference,
      metrics,
      tools: tools({ spawnRun: async () => ({ code: 0, stdout: `Run ${RUN_ID}: completed`, stderr: "" }) }),
    });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    return { port, close: () => new Promise((r) => server.close(r)) };
  }
  const json = { "Content-Type": "application/json" };
  const task = (agentId: string) => JSON.stringify({ taskId: "t9", agentId, title: "Explorer: test Missions" });

  it("streams NDJSON events and ends with the task result", async () => {
    const bridge = await start(fakeInference("done").inference);
    const res = await request(bridge.port, { method: "POST", path: "/tasks", body: task("explorer"), headers: json });
    const lines = res.text.trim().split("\n").map((l) => JSON.parse(l) as OfficeEvent);
    expect(res.status).toBe(200);
    expect(lines[0]).toMatchObject({ status: "working", agentId: "explorer" });
    expect(lines.at(-1)).toMatchObject({ status: "completed", result: { status: "completed" } });

    const agents = JSON.parse((await request(bridge.port, { method: "GET", path: "/agents" })).text) as { id: string; metrics: { tasksCompleted: number } }[];
    expect(agents.map((a) => a.id)).toEqual([...OFFICE_AGENT_IDS]);
    expect(agents.find((a) => a.id === "explorer")?.metrics.tasksCompleted).toBe(1);
    await bridge.close();
  });

  it("rejects bad input, foreign hosts, non-JSON posts and a busy agent", async () => {
    let release!: () => void;
    const slow: Inference = { vision: false, complete: () => new Promise((r) => (release = () => r({ text: "ok", tokens: 1 }))) };
    const bridge = await start(slow);

    expect((await request(bridge.port, { method: "POST", path: "/tasks", body: task("nobody"), headers: json })).status).toBe(400);
    expect((await request(bridge.port, { method: "POST", path: "/tasks", body: "{", headers: json })).status).toBe(400);
    expect((await request(bridge.port, { method: "POST", path: "/tasks", body: task("explorer"), headers: { "Content-Type": "text/plain" } })).status).toBe(415);
    expect((await request(bridge.port, { method: "GET", path: "/agents", headers: { Host: "evil.example" } })).status).toBe(403);
    expect((await request(bridge.port, { method: "GET", path: "/nope" })).status).toBe(404);

    const first = request(bridge.port, { method: "POST", path: "/tasks", body: task("explorer"), headers: json });
    await new Promise((r) => setTimeout(r, 100));
    expect((await request(bridge.port, { method: "POST", path: "/tasks", body: task("explorer"), headers: json })).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    await bridge.close();
  });
});
