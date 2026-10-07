import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBridgeUrl, createOfficeHub } from "../src/office/hub.js";
import { buildDashboardState, startDashboard } from "../src/observer/dashboard.js";
import { config, NOW } from "./observerFixtures.js";

let dir: string;
let server: Server | undefined;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-hub-"));
});
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

const metrics = { tasksCompleted: 1, tasksBlocked: 0, tokensUsed: 10, reputation: 0.55 };
const ndjson = (lines: unknown[]) => new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", { status: 200, headers: { "Content-Type": "application/x-ndjson" } });

/** A fake bridge: GET /agents answers, POST /tasks streams the given events for whatever task it receives. */
function fakeBridge(events: (taskId: string, agentId: string) => unknown[], calls: { url: string; body?: string }[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.endsWith("/agents")) return Response.json([{ id: "explorer", busy: false, metrics }, { id: "not-an-agent" }]);
    const task = JSON.parse(String(init?.body)) as { taskId: string; agentId: string };
    return ndjson(events(task.taskId, task.agentId));
  }) as typeof fetch;
}

const flow = (taskId: string, agentId: string) => [
  { at: "2026-10-07T12:00:00.000Z", taskId, agentId, status: "working", activity: "Claimed task", tool: "run_playwright_scenario" },
  {
    at: "2026-10-07T12:01:00.000Z", taskId, agentId, status: "completed", activity: "Report written",
    result: { status: "completed", summary: "2 screens checked", reportPath: "reports/explorer-1.md", tokensUsed: 5, usedFallback: false, metrics },
  },
];

describe("office hub", () => {
  it("only talks to a loopback bridge", () => {
    expect(checkBridgeUrl("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
    expect(checkBridgeUrl("http://localhost:3100/")).toBe("http://localhost:3100");
    for (const bad of ["https://127.0.0.1:3100", "http://example.com:3100", "http://10.0.0.2:3100", "not a url"]) expect(() => checkBridgeUrl(bad), bad).toThrow();
  });

  it("forwards a task to the bridge and keeps its events and outcome", async () => {
    const calls: { url: string; body?: string }[] = [];
    const hub = await createOfficeHub({ bridgeUrl: "http://127.0.0.1:3100", readonly: false, fetchImpl: fakeBridge(flow, calls), storeFile: path.join(dir, "office", "tasks.json") });
    const res = await hub.assign({ agentId: "explorer", title: "  Check the Missions screen  " });
    expect(res.status).toBe(202);
    await hub.idle();

    const sent = JSON.parse(calls.find((c) => c.url.endsWith("/tasks"))?.body ?? "{}") as Record<string, unknown>;
    expect(sent).toMatchObject({ agentId: "explorer", title: "Check the Missions screen", memories: [] });

    const view = await hub.view();
    expect(view.connected).toBe(true);
    expect(view.agents).toEqual([{ id: "explorer", busy: false, metrics }]);
    expect(view.tasks[0]).toMatchObject({ agentId: "explorer", status: "completed", summary: "2 screens checked", reportPath: "reports/explorer-1.md" });
    expect(view.events.map((e) => e.activity)).toEqual(["Report written", "Claimed task"]);

    const stored = JSON.parse(await readFile(path.join(dir, "office", "tasks.json"), "utf8")) as unknown[];
    expect(stored).toHaveLength(1);
  });

  it("refuses bad input, a second task for a working agent, and everything in read-only mode", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = (async (input: string | URL | Request, init?: RequestInit) => {
      const task = JSON.parse(String(init?.body)) as { taskId: string };
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ at: NOW.toISOString(), taskId: task.taskId, agentId: "explorer", status: "working", activity: "Working" }) + "\n"));
          await gate;
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const hub = await createOfficeHub({ bridgeUrl: "http://127.0.0.1:3100", readonly: false, fetchImpl: slow });
    expect((await hub.assign({ agentId: "nobody", title: "x" })).status).toBe(400);
    expect((await hub.assign({ agentId: "explorer", title: " " })).status).toBe(400);
    expect((await hub.assign({ agentId: "explorer", title: "x".repeat(201) })).status).toBe(400);
    expect((await hub.assign({ agentId: "explorer", title: "First" })).status).toBe(202);
    expect((await hub.assign({ agentId: "explorer", title: "Second" })).status).toBe(409);
    release();
    await hub.idle();
    // The stream ended without a result: the task is blocked, not silently "working" forever.
    expect((await hub.view()).tasks[0]).toMatchObject({ status: "blocked", activity: "The bridge stopped before the task finished" });

    const ro = await createOfficeHub({ bridgeUrl: "http://127.0.0.1:3100", readonly: true, fetchImpl: slow });
    expect((await ro.assign({ agentId: "explorer", title: "Anything" })).status).toBe(403);
  });

  it("reports an offline bridge instead of idle agents, and blocks the task it could not start", async () => {
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const hub = await createOfficeHub({ bridgeUrl: "http://127.0.0.1:3100", readonly: false, fetchImpl: down });
    await hub.assign({ agentId: "qa-analyst", title: "Review the latest run" });
    await hub.idle();
    const view = await hub.view();
    expect(view.connected).toBe(false);
    expect(view.tasks[0]).toMatchObject({ status: "blocked", activity: "Bridge offline: the task was not started" });
  });

  it("marks tasks that were running when the office stopped as interrupted", async () => {
    const file = path.join(dir, "tasks.json");
    await writeFile(file, JSON.stringify([{ taskId: "t-1", agentId: "explorer", title: "Old", status: "working", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), activity: "Working" }]));
    const hub = await createOfficeHub({ bridgeUrl: "http://127.0.0.1:3100", readonly: false, fetchImpl: fakeBridge(flow), storeFile: file });
    expect((await hub.view()).tasks[0]?.status).toBe("blocked");
  });
});

describe("dashboard with the office", () => {
  function post(port: number, body: string, headers: Record<string, string>) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/api/tasks", method: "POST", headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = "";
        res.on("data", (c: Buffer) => (text += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  it("accepts a same-origin JSON task and rejects cross-site or non-JSON posts", async () => {
    const hub = await createOfficeHub({ bridgeUrl: "http://127.0.0.1:3100", readonly: false, fetchImpl: fakeBridge(flow) });
    const started = await startDashboard(config(dir), hub);
    server = started.server;
    const { port } = started;
    const json = { "content-type": "application/json" };
    const body = JSON.stringify({ agentId: "explorer", title: "Check the Missions screen" });

    expect((await post(port, body, { ...json, origin: "http://evil.example.com" })).status).toBe(403);
    expect((await post(port, body, { ...json, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post(port, body, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post(port, "{not json", json)).status).toBe(400);

    const ok = await post(port, body, { ...json, origin: `http://127.0.0.1:${port}`, "sec-fetch-site": "same-origin" });
    expect(ok.status).toBe(202);
    expect(JSON.parse(ok.body)).toMatchObject({ task: { agentId: "explorer", title: "Check the Missions screen" } });
    await hub.idle();
  });

  it("puts the sanitized office into the page state", async () => {
    const hub = await createOfficeHub({
      bridgeUrl: "http://127.0.0.1:3100",
      readonly: false,
      fetchImpl: fakeBridge((taskId, agentId) => [
        { at: "2026-10-07T12:00:00.000Z", taskId, agentId, status: "working", activity: "Opened https://qa-secret-preview.vercel.app/online?room=xk29qa for owner@example.com" },
        { at: "not-a-time", taskId, agentId, status: "completed", activity: "Done", result: { status: "completed", summary: "Mailed owner@example.com", reportPath: "C:\\Users\\hugo\\reports\\explorer-1.md", runId: "../../etc", tokensUsed: 0, usedFallback: true, metrics } },
      ]),
    });
    await hub.assign({ agentId: "explorer", title: "Check https://qa-secret-preview.vercel.app" });
    await hub.idle();
    const state = buildDashboardState([], config(dir), NOW, await hub.view());
    const text = JSON.stringify(state);
    for (const value of ["qa-secret-preview.vercel.app", "owner@example.com", "xk29qa", "Users", "../"]) expect(text, value).not.toContain(value);
    expect(state.office?.tasks[0]).toMatchObject({ reportPath: "explorer-1.md", runId: "run" });
    expect(state.office?.events.map((e) => e.at)).toEqual(["", "2026-10-07T12:00:00.000Z"]);
    expect(state.agents.map((a) => a.id)).toEqual(["player-alpha", "player-bravo", "explorer", "qa-analyst", "design-critic", "test-planner"]);
  });
});
