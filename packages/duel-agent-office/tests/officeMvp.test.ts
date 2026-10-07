import { execFileSync } from "node:child_process";
import net from "node:net";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIGS, fileAgentConfigStore, validateAgentConfig } from "../src/office/agentConfig.js";
import { playerView, runTask, type TaskDeps } from "../src/office/agents.js";
import { createBridge } from "../src/office/bridge.js";
import { fileConnectionStore, validateConnections } from "../src/office/connections.js";
import type { OfficeEvent, OfficeTask } from "../src/office/contract.js";
import { openMetrics } from "../src/office/metrics.js";
import { extractEnvNames, extractRoutes, extractTargets, keywordsOf, planTests } from "../src/office/planner.js";
import { fileProcessRegistry, type ProcessOps } from "../src/office/procs.js";
import { fileQuotaStore, localDay } from "../src/office/quota.js";
import { createRepoReader, isSecretPath, type RepoReader } from "../src/office/repoSource.js";
import { listReports, readReport, severityOf } from "../src/office/reports.js";
import { runPlaywrightScenario, scopeEnv, type SpawnResult, type ToolDeps } from "../src/office/tools.js";
import { startDashboard } from "../src/observer/dashboard.js";
import { selectScreens } from "../src/scenarios/exploreScreens.js";
import { createOfficeHub } from "../src/office/hub.js";
import { config } from "./observerFixtures.js";

let dir: string;
let server: Server | undefined;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-mvp-"));
});
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

const RUN_ID = "2026-10-06T12-30-45-123Z-private-match-full-game";

describe("agent configuration", () => {
  it("merges a valid patch and rejects the rest in plain words", () => {
    const base = DEFAULT_CONFIGS.explorer;
    const ok = validateAgentConfig(base, { objective: "  Only Missions  ", scope: { screens: ["missions", "missions"], focus: "tabs" }, quota: { maxTasksPerDay: 3, maxTokensPerDay: 0 } });
    expect(ok).toMatchObject({ ok: true, config: { objective: "Only Missions", scope: { screens: ["missions"], focus: "tabs" }, quota: { maxTasksPerDay: 3, maxTokensPerDay: 0 } } });
    expect(validateAgentConfig(base, { objective: "" }).ok).toBe(false);
    expect(validateAgentConfig(base, { quota: { maxTasksPerDay: -1, maxTokensPerDay: 0 } }).ok).toBe(false);
    expect(validateAgentConfig(base, { scope: { screens: ["admin"], focus: "" } }).ok).toBe(false);
    expect(validateAgentConfig(base, "nope").ok).toBe(false);
  });

  it("persists per agent, ignores unknown keys and respects read-only", async () => {
    const file = path.join(dir, "agent-config.json");
    const store = fileAgentConfigStore({ file, readonly: false });
    expect((await store.get("explorer")).objective).toBe(DEFAULT_CONFIGS.explorer.objective);
    expect((await store.save("explorer", { objective: "Mine", credentials: "x" })).status).toBe(200);
    expect((await store.get("explorer")).objective).toBe("Mine");
    expect(await readFile(file, "utf8")).not.toContain("credentials");
    expect((await store.save("nobody", { objective: "x" })).status).toBe(400);
    expect((await fileAgentConfigStore({ file, readonly: true }).save("explorer", { objective: "x" })).status).toBe(403);
  });
});

describe("daily quota", () => {
  it("blocks at the task or token limit and starts over on a new day", async () => {
    let now = new Date(2026, 9, 7, 10);
    const quota = fileQuotaStore(path.join(dir, "usage.json"), () => now);
    const limits = { maxTasksPerDay: 2, maxTokensPerDay: 100 };
    expect(await quota.check("explorer", limits)).toBeUndefined();
    await quota.start("explorer");
    await quota.start("explorer");
    expect(await quota.check("explorer", limits)).toMatch(/task limit/);
    expect(await quota.check("explorer", { maxTasksPerDay: 0, maxTokensPerDay: 0 })).toBeUndefined();
    await quota.addTokens("qa-analyst", 120);
    expect(await quota.check("qa-analyst", limits)).toMatch(/token limit/);
    now = new Date(2026, 9, 8, 10);
    expect(localDay(now)).toBe("2026-10-08");
    expect(await quota.check("explorer", limits)).toBeUndefined();
  });
});

describe("reports index", () => {
  async function put(name: string, body: string, meta?: object) {
    await mkdir(path.join(dir, "reports"), { recursive: true });
    await writeFile(path.join(dir, "reports", name), body);
    if (meta) await writeFile(path.join(dir, "reports", name.replace(/\.md$/, ".meta.json")), JSON.stringify(meta));
  }

  it("lists newest first with severity, task and day, and filters", async () => {
    await put("explorer-2026-10-06T10-00-00-000Z.md", "# Explorer report\n- [low] x\n- [high] y\n");
    await put("player-alpha-2026-10-07T09-00-00-000Z.md", "# Player report\nNothing here\n", { taskId: "t-1", taskTitle: "Play the match", runId: RUN_ID });
    await put("qa-analyst-2026-10-07T11-00-00-000Z.md", "## Findings\n- [medium] cat (x1, alpha): msg\n", { interrupted: true });
    await put("notes.md", "not a report");
    const all = await listReports(dir);
    expect(all.map((r) => r.agentId)).toEqual(["qa-analyst", "player-alpha", "explorer"]);
    expect(all[2]).toMatchObject({ severity: "high", findings: 2, day: "2026-10-06" });
    expect(all[1]).toMatchObject({ severity: "none", taskId: "t-1", runId: RUN_ID });
    expect(all[0]).toMatchObject({ interrupted: true, severity: "medium" });
    expect((await listReports(dir, { agent: "explorer" })).length).toBe(1);
    expect((await listReports(dir, { severity: "none" })).length).toBe(1);
    expect((await listReports(dir, { task: "play the" })).map((r) => r.agentId)).toEqual(["player-alpha"]);
    expect((await listReports(dir, { from: "2026-10-07" })).length).toBe(2);
    expect((await listReports(dir, { to: "2026-10-06" })).length).toBe(1);
    expect(severityOf("- [low] a")).toEqual({ severity: "low", findings: 1 });
  });

  it("opens only files that look like reports", async () => {
    await put("explorer-2026-10-06T10-00-00-000Z.md", "# Hello");
    expect(await readReport(dir, "explorer-2026-10-06T10-00-00-000Z.md")).toBe("# Hello");
    for (const bad of ["../summary.json", "notes.md", "..\\x.md", "explorer-2026-10-06T10-00-00-000Z.md/../../x"]) expect(await readReport(dir, bad), bad).toBeUndefined();
    expect(await listReports(path.join(dir, "missing"))).toEqual([]);
  });
});

describe("runner processes", () => {
  function fakeOps(lines: Record<number, string | undefined>) {
    const killed: number[] = [];
    const ops: ProcessOps = { kill: async (pid) => void killed.push(pid), commandLine: async (pid) => lines[pid] };
    return { ops, killed };
  }

  it("stops a tracked process and forgets it", async () => {
    const { ops, killed } = fakeOps({});
    const reg = fileProcessRegistry(path.join(dir, "pids.json"), ops);
    await reg.track(111, "explore-screens");
    expect(await reg.stale()).toEqual([]); // owned by this office
    await reg.stop(111);
    expect(killed).toEqual([111]);
    expect(JSON.parse(await readFile(path.join(dir, "pids.json"), "utf8"))).toEqual([]);
  });

  it("cleans up only a recorded pid that still runs the runner, and forgets the rest", async () => {
    const file = path.join(dir, "pids.json");
    await writeFile(file, JSON.stringify([
      { pid: 201, label: "explore-screens", startedAt: "2026-10-07T10:00:00.000Z" },
      { pid: 202, label: "explore-screens", startedAt: "2026-10-07T10:00:00.000Z" }, // pid reused by something else
      { pid: 203, label: "explore-screens", startedAt: "2026-10-07T10:00:00.000Z" }, // already gone
    ]));
    const { ops, killed } = fakeOps({ 201: "node --import tsx src/cli.ts explore-screens --headless", 202: "chrome.exe --some-flag" });
    const result = await fileProcessRegistry(file, ops).cleanupStale();
    expect(killed).toEqual([201]);
    expect(result.stopped.map((p) => p.pid)).toEqual([201]);
    expect(result.forgotten.map((p) => p.pid)).toEqual([202, 203]);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual([]);
  });
});

describe("read-only repositories", () => {
  it("never lists or reads secret-looking files", () => {
    for (const p of [".env", ".env.local", "src/.env.production", "keys/server.pem", "a/id_rsa", "node_modules/x/index.js", ".git/config", "svc-service-account.json"]) expect(isSecretPath(p), p).toBe(true);
    for (const p of [".env.example", "src/App.tsx", "docs/environment.md"]) expect(isSecretPath(p), p).toBe(false);
  });

  it("reads a local checkout inside its folder only", async () => {
    const repo = path.join(dir, "game");
    await mkdir(path.join(repo, "src"), { recursive: true });
    await writeFile(path.join(repo, "src", "App.tsx"), '<Route path="/shop" />');
    await writeFile(path.join(repo, ".env"), "SECRET=1");
    await writeFile(path.join(repo, "bin.dat"), Buffer.from([1, 0, 2]));
    await writeFile(path.join(dir, "outside.txt"), "outside");
    await symlink(path.join(dir, "outside.txt"), path.join(repo, "link.txt")).catch(() => undefined);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", "add", "-A", "-f"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "-m", "first commit"], { cwd: repo });
    const reader = createRepoReader({ id: "game", kind: "local", label: "Game", path: repo });
    expect(await reader.listFiles()).toEqual(expect.arrayContaining(["src/App.tsx", "bin.dat"]));
    expect(await reader.listFiles()).not.toContain(".env");
    expect(await reader.readFile("src/App.tsx")).toContain("/shop");
    expect(await reader.readFile(".env")).toBeUndefined();
    expect(await reader.readFile("../outside.txt")).toBeUndefined();
    expect(await reader.readFile("link.txt")).toBeUndefined();
    expect(await reader.readFile("bin.dat")).toBeUndefined();
    const summary = await reader.summary();
    expect(summary).toMatchObject({ kind: "local", changedFiles: 0 });
    expect(summary.commits[0]?.subject).toBe("first commit");
  });

  it("reads GitHub with GET only and keeps the token out of results", async () => {
    const calls: { url: string; method?: string; auth?: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method, auth: (init?.headers as Record<string, string>)?.Authorization });
      if (url.endsWith("/repos/o/r")) return Response.json({ default_branch: "main", description: "d" });
      if (url.includes("/commits")) return Response.json([{ sha: "abcdef123456", commit: { message: "Fix thing\n\nbody", committer: { date: "2026-10-07T10:00:00Z" } } }]);
      if (url.includes("/pulls")) return Response.json([{ number: 4, title: "Design", user: { login: "hugo" }, html_url: "https://github.com/o/r/pull/4" }]);
      if (url.includes("/issues")) return Response.json([{ number: 5, title: "Bug", html_url: "https://github.com/o/r/issues/5" }, { number: 4, title: "PR", pull_request: {} }]);
      if (url.includes("/contents/missing")) return new Response("{}", { status: 404 });
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const reader = createRepoReader({ id: "g", kind: "github", label: "G", repo: "o/r" }, { token: "ghp_secret_token_value", fetchImpl });
    const summary = await reader.summary();
    expect(summary).toMatchObject({ kind: "github", branch: "main", commits: [{ sha: "abcdef1", subject: "Fix thing" }], pulls: [{ number: 4, url: "https://github.com/o/r/pull/4" }], issues: [{ number: 5 }] });
    expect(summary.issues).toHaveLength(1);
    expect(JSON.stringify(summary)).not.toContain("ghp_secret_token_value");
    expect(calls.every((c) => (c.method ?? "GET") === "GET" && c.auth === "Bearer ghp_secret_token_value")).toBe(true);
    expect(await reader.readFile(".env")).toBeUndefined();
    expect(await reader.readFile("missing.txt")).toBeUndefined();
  });

  it("validates sources", () => {
    expect(validateConnections({ sources: [{ id: "game", kind: "github", repo: "hugoviegas/hugents" }], gameSource: "game" }).ok).toBe(true);
    for (const bad of [
      { sources: [{ id: "a", kind: "github", repo: "not a repo" }] },
      { sources: [{ id: "a", kind: "local", path: "relative/path" }] },
      { sources: [{ id: "a", kind: "local", path: "/x/../etc" }] },
      { sources: [{ id: "a", kind: "ssh", path: "/x" }] },
      { sources: [{ id: "a", kind: "github", repo: "o/r" }, { id: "a", kind: "github", repo: "o/r" }] },
      { sources: [{ id: "a", kind: "github", repo: "o/r" }], gameSource: "zzz" },
    ]) expect(validateConnections(bad).ok, JSON.stringify(bad)).toBe(false);
  });

  it("seeds a local source from OFFICE_GAME_REPO when nothing is saved", async () => {
    const store = fileConnectionStore({ file: path.join(dir, "c.json"), readonly: false, seedLocalPath: "/home/game" });
    expect(await store.get()).toMatchObject({ gameSource: "game", sources: [{ kind: "local", path: "/home/game" }] });
  });
});

describe("test planner", () => {
  const files: Record<string, string> = {
    "src/App.tsx": '<Route path="/missions" element={<Missions/>} /><Route path="/online" />',
    "src/pages/Missions.tsx": '<button data-testid="claim-reward" aria-label="Resgatar">x</button> {import.meta.env.VITE_FIREBASE_PROJECT}',
    ".env.example": "VITE_ENABLE_DEV_LOGIN=true\nVITE_FIREBASE_PROJECT=qa\n",
  };
  const reader: RepoReader = {
    summary: async () => ({ kind: "local", label: "x", commits: [] }),
    listFiles: async () => Object.keys(files),
    readFile: async (rel) => files[rel],
  };

  it("extracts names, never values", () => {
    expect(extractRoutes('<Route path="/a/:id" /> {path: "/b"}')).toEqual(["/a/:id", "/b"]);
    expect(extractTargets('<i data-testid="x" aria-label="Y" placeholder="{n}">')).toEqual({ testIds: ["x"], labels: ["Y"] });
    expect(extractEnvNames("import.meta.env.VITE_A + process.env.TOKEN_B")).toEqual(["VITE_A", "TOKEN_B"]);
    expect(keywordsOf("Test the Missions screen")).toEqual(["missions", "screen"]);
  });

  it("writes a plan with routes, targets, env names and the matching scenario", async () => {
    const { markdown, filesRead } = await planTests(reader, { task: "Check the Missions page", objective: "Plan", focus: "" });
    expect(filesRead).toBeGreaterThan(1);
    expect(markdown).toContain("/missions (matches the task), covered by explore-screens");
    expect(markdown).toContain("data-testid: claim-reward");
    expect(markdown).toContain("VITE_FIREBASE_PROJECT (src/pages/Missions.tsx)");
    expect(markdown).toContain("limit it to: missions");
    expect(markdown).not.toContain("=qa");
    expect(severityOf(markdown).findings).toBe(0);
  });
});

describe("agent tasks with configuration", () => {
  const tools = (over: Partial<ToolDeps> = {}): ToolDeps => ({ artifactsDir: dir, secrets: () => [], ...over });

  async function setup(agentId: OfficeTask["agentId"], extra: Partial<TaskDeps> = {}) {
    const events: OfficeEvent[] = [];
    const metrics = await openMetrics(path.join(dir, "office", "metrics.json"));
    const deps: TaskDeps = {
      tools: tools(),
      inference: { vision: false, complete: async () => null },
      metrics,
      emit: (e) => events.push(e),
      now: () => new Date("2026-10-07T13:00:00.000Z"),
      ...extra,
    };
    const task: OfficeTask = { taskId: "t1", agentId, title: "Do it" };
    return { deps, task, events, metrics };
  }

  it("refuses at the quota without touching the agent's record or the runner", async () => {
    let spawned = 0;
    const quota = fileQuotaStore(path.join(dir, "usage.json"));
    const configs = fileAgentConfigStore({ file: path.join(dir, "cfg.json"), readonly: false });
    await configs.save("explorer", { quota: { maxTasksPerDay: 1, maxTokensPerDay: 0 } });
    const { deps, task } = await setup("explorer", { quota, configs, tools: tools({ spawnRun: async () => (spawned++, { code: 1, stdout: "", stderr: "" }) }) });
    await runTask(deps, task);
    const second = await runTask(deps, { ...task, taskId: "t2" });
    expect(second).toMatchObject({ status: "blocked", summary: expect.stringMatching(/Daily task limit/) });
    expect(second.metrics.tasksBlocked).toBe(1); // only the first, blocked by the missing run
    expect(spawned).toBe(1);
  });

  it("rejects a command the agent does not have", async () => {
    const { deps, task } = await setup("explorer");
    expect(await runTask(deps, { ...task, command: "plan" })).toMatchObject({ status: "blocked", summary: "Unknown command for Explorer" });
  });

  it("planner: blocked without a game source, completed with one", async () => {
    const none = await setup("test-planner");
    expect(await runTask(none.deps, none.task)).toMatchObject({ status: "blocked" });
    const reader: RepoReader = { summary: async () => ({ kind: "local", label: "x", commits: [] }), listFiles: async () => ["src/App.tsx"], readFile: async () => '<Route path="/shop" />' };
    const { deps, task } = await setup("test-planner", { gameSource: async () => reader });
    const outcome = await runTask(deps, { ...task, title: "Check the shop", command: "plan" });
    expect(outcome).toMatchObject({ status: "completed", tokensUsed: 0 });
    expect(await readFile(path.join(dir, outcome.reportPath!), "utf8")).toContain("# Test plan");
    const [entry] = await listReports(dir);
    expect(entry).toMatchObject({ agentId: "test-planner", taskId: "t1", taskTitle: "Check the shop" });
  });

  it("a stopped task leaves an interrupted report and says so", async () => {
    const controller = new AbortController();
    const spawnRun = (_s: string, _h: boolean, o?: { signal?: AbortSignal }) =>
      new Promise<SpawnResult>((resolve) => o?.signal?.addEventListener("abort", () => resolve({ code: null, stdout: "", stderr: "", aborted: true })));
    const { deps, task, events } = await setup("explorer", { tools: tools({ spawnRun }) });
    const running = runTask(deps, task, controller.signal);
    setTimeout(() => controller.abort(), 20);
    const outcome = await running;
    expect(outcome).toMatchObject({ status: "blocked", stopped: true, summary: "Stopped by the user" });
    expect(await readFile(path.join(dir, outcome.reportPath!), "utf8")).toContain("interrupted");
    expect((await listReports(dir))[0]).toMatchObject({ interrupted: true, taskId: "t1" });
    expect(events.at(-1)?.result?.stopped).toBe(true);
  });

  it("each player reports only its own side", () => {
    const finding = (player: string) => ({ player, severity: "low", category: "c", count: 1, message: "m" });
    const artifacts = {
      runId: RUN_ID,
      summary: {},
      events: [{ agent: "player-alpha" }, { agent: "player-bravo" }],
      console: [{ agent: "player-bravo" }],
      networkFailures: [],
      totals: { events: 2, console: 1, networkFailures: 0 },
      findings: { runs: [{ runId: RUN_ID, findings: [finding("alpha"), finding("bravo"), finding("runner")], ignored: { networkFailures: 0 } }], repeated: [], totals: { bySeverity: {} } },
      screenshots: [],
    } as unknown as Parameters<typeof playerView>[0];
    const bravo = playerView(artifacts, "player-bravo");
    expect(bravo.events).toEqual([{ agent: "player-bravo" }]);
    expect(bravo.findings?.runs[0]?.findings.map((f) => f.player)).toEqual(["bravo"]);
    expect(playerView(artifacts, "player-alpha").console).toEqual([]);
    expect(playerView(artifacts, "explorer")).toBe(artifacts);
  });
});

describe("the shared match run", () => {
  it("lets Alpha and Bravo join one run, and stops it for both", async () => {
    let spawned = 0;
    const spawnRun = (_s: string, _h: boolean, o?: { signal?: AbortSignal }) =>
      new Promise<SpawnResult>((resolve) => {
        spawned += 1;
        o?.signal?.addEventListener("abort", () => resolve({ code: null, stdout: "", stderr: "", aborted: true }));
      });
    const alpha = new AbortController();
    const a = runPlaywrightScenario({ artifactsDir: dir, spawnRun, signal: alpha.signal }, { scenario: "private-match-full-game" });
    const b = runPlaywrightScenario({ artifactsDir: dir, spawnRun }, { scenario: "private-match-full-game" });
    await new Promise((r) => setTimeout(r, 10));
    alpha.abort();
    expect((await a).data).toMatchObject({ stopped: true });
    expect((await b).data).toMatchObject({ stopped: true });
    expect(spawned).toBe(1);
  });

  it("passes the explorer's scope as a fixed environment name", () => {
    expect(scopeEnv(["missions", "shop"])).toEqual({ QA_EXPLORE_SCREENS: "missions,shop" });
    expect(scopeEnv([])).toEqual({});
    expect(selectScreens({ QA_EXPLORE_SCREENS: "missions, nope" }).map((s) => s.name)).toEqual(["missions"]);
    expect(selectScreens({ QA_EXPLORE_SCREENS: "nope" }).length).toBe(9);
    expect(selectScreens({}).length).toBe(9);
  });
});

describe("bridge and dashboard routes", () => {
  function call(port: number, method: string, pathname: string, body?: unknown, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: pathname, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = "";
        res.on("data", (c: Buffer) => (text += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  it("stops a running task through the bridge", async () => {
    const spawnRun = (_s: string, _h: boolean, o?: { signal?: AbortSignal }) =>
      new Promise<SpawnResult>((resolve) => o?.signal?.addEventListener("abort", () => resolve({ code: null, stdout: "", stderr: "", aborted: true })));
    const metrics = await openMetrics(path.join(dir, "m.json"));
    // `createBridge` checks Host against the port it was given, so find a free one first.
    const probe = net.createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const real = createBridge({ port, tools: { artifactsDir: dir, spawnRun }, inference: { vision: false, complete: async () => null }, metrics });
    await new Promise<void>((r) => real.listen(port, "127.0.0.1", r));
    server = real;
    const json = { "content-type": "application/json" };

    expect((await call(port, "POST", "/agents/explorer/stop", {}, json)).status).toBe(404);
    expect((await call(port, "POST", "/agents/explorer/stop", {}, { "content-type": "text/plain" })).status).toBe(415);
    const task = call(port, "POST", "/tasks", { taskId: "t-1", agentId: "explorer", title: "Tour" }, json);
    await new Promise((r) => setTimeout(r, 100));
    expect((await call(port, "POST", "/agents/explorer/stop", {}, json)).status).toBe(202);
    const lines = (await task).body.trim().split("\n").map((l) => JSON.parse(l) as OfficeEvent);
    expect(lines.at(-1)?.result).toMatchObject({ status: "blocked", stopped: true });
    expect(JSON.parse((await call(port, "GET", "/processes")).body)).toEqual({ stale: [] });
  });

  it("serves settings, reports and a GitHub summary, and saves only from the page", async () => {
    await mkdir(path.join(dir, "reports"), { recursive: true });
    await writeFile(path.join(dir, "reports", "explorer-2026-10-07T10-00-00-000Z.md"), "# Explorer report\n- [high] Opened https://qa-secret.vercel.app/x for owner@example.com\n");
    const configs = fileAgentConfigStore({ file: path.join(dir, "office", "agent-config.json"), readonly: false });
    const connections = fileConnectionStore({ file: path.join(dir, "office", "connections.json"), readonly: false });
    const quota = fileQuotaStore(path.join(dir, "office", "usage.json"));
    const fetchImpl = (async (input: string | URL | Request) => (String(input).endsWith("/repos/o/r") ? Response.json({ default_branch: "main" }) : Response.json([]))) as typeof fetch;
    const hub = await createOfficeHub({ bridgeUrl: "http://127.0.0.1:3100", readonly: false, fetchImpl: (async () => { throw new Error("down"); }) as typeof fetch });
    const started = await startDashboard(config(dir), hub, undefined, { configs, quota, connections, github: { fetchImpl } });
    server = started.server;
    const { port } = started;
    const same = { "content-type": "application/json", origin: `http://127.0.0.1:${port}`, "sec-fetch-site": "same-origin" };

    expect((await call(port, "POST", "/api/agent-config", { agentId: "explorer", config: { objective: "Mine" } }, { "content-type": "application/json", origin: "http://evil.example.com" })).status).toBe(403);
    expect((await call(port, "POST", "/api/agent-config", { agentId: "explorer", config: { objective: "Mine" } }, same)).status).toBe(200);
    expect((await call(port, "POST", "/api/agent-config", { agentId: "explorer", config: { quota: { maxTasksPerDay: -5, maxTokensPerDay: 1 } } }, same)).status).toBe(400);
    expect((await call(port, "POST", "/api/connections", { sources: [{ id: "g", kind: "github", repo: "o/r" }], gameSource: "g" }, same)).status).toBe(200);
    expect((await call(port, "POST", "/api/stop", { agentId: "explorer" }, same)).status).toBe(502); // bridge offline: says so, claims nothing

    const state = JSON.parse((await call(port, "GET", "/api/state")).body) as { settings: { configs: { explorer: { objective: string } }; connections: { gameSource: string } } };
    expect(state.settings.configs.explorer.objective).toBe("Mine");
    expect(state.settings.connections.gameSource).toBe("g");

    const list = JSON.parse((await call(port, "GET", "/api/reports?severity=high")).body) as { total: number; reports: { file: string }[] };
    expect(list.total).toBe(1);
    const text = (JSON.parse((await call(port, "GET", `/api/report?file=${list.reports[0]?.file}`)).body) as { text: string }).text;
    expect(text).not.toContain("qa-secret");
    expect(text).not.toContain("owner@example.com");
    expect((await call(port, "GET", "/api/report?file=..%2Fsummary.json")).status).toBe(404);

    expect(JSON.parse((await call(port, "GET", "/api/github?source=g")).body)).toMatchObject({ kind: "github", branch: "main" });
    expect((await call(port, "GET", "/api/github?source=nope")).status).toBe(404);
  });
});
