import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Actor, Schema, ToolDefinition, ToolRegistry } from "../src/index.js";
import { PLANTED, PNG, hugo, makeRuntime, schemas, tempDir, testAgent } from "./helpers.js";

const { OBJ } = schemas;
const TEXT = { type: "string", maxLength: 100 } as const;

/** Observations the test tools record, so tests can see starts, aborts and concurrency. */
function probe() {
  return { started: [] as string[], aborted: 0, active: 0, maxActive: 0, calls: 0 };
}

function testTools(p: ReturnType<typeof probe>) {
  const sleep: ToolDefinition = {
    name: "test.sleep",
    version: "1.0.0",
    description: "waits",
    requires: [],
    inputSchema: OBJ({ ms: { type: "integer", minimum: 0, maximum: 5000 }, label: TEXT }, ["ms"]) as Schema,
    outputSchema: OBJ({ waited: { type: "integer", minimum: 0, maximum: 5000 } }, ["waited"]) as Schema,
    async run(ctx) {
      p.started.push(String(ctx.input.label ?? ctx.taskId));
      p.active++;
      p.maxActive = Math.max(p.maxActive, p.active);
      try {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, Number(ctx.input.ms));
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(t);
            p.aborted++;
            resolve();
          });
        });
      } finally {
        p.active--;
      }
      return { output: { waited: Number(ctx.input.ms) } };
    },
  };
  const echo: ToolDefinition = {
    name: "test.echo",
    version: "1.0.0",
    description: "echoes",
    requires: [],
    inputSchema: OBJ({ text: TEXT }, ["text"]) as Schema,
    outputSchema: OBJ({ text: TEXT }, ["text"]) as Schema,
    async run(ctx) {
      p.calls++;
      return { output: { text: `${String(ctx.input.text)} ${PLANTED.token} ${ctx.prompt.system}` } };
    },
  };
  const flaky: ToolDefinition = {
    name: "test.flaky",
    version: "1.0.0",
    description: "fails first",
    requires: [],
    inputSchema: OBJ({}) as Schema,
    outputSchema: OBJ({ ok: { type: "boolean" } }, ["ok"]) as Schema,
    async run() {
      p.calls++;
      if (p.calls === 1) throw new Error(`boom with ${PLANTED.email}`);
      return { output: { ok: true } };
    },
  };
  const badOutput: ToolDefinition = {
    name: "test.bad-output",
    version: "1.0.0",
    description: "wrong shape",
    requires: [],
    inputSchema: OBJ({}) as Schema,
    outputSchema: OBJ({ ok: { type: "boolean" } }, ["ok"]) as Schema,
    async run() {
      p.calls++;
      return { output: { ok: true, raw: "page text" } };
    },
  };
  const sneaky: ToolDefinition = {
    name: "test.sneaky",
    version: "1.0.0",
    description: "uses what it did not declare",
    requires: [],
    inputSchema: OBJ({}) as Schema,
    outputSchema: OBJ({}) as Schema,
    async run(ctx) {
      await ctx.writeArtifact("log", "text/plain", "x");
      return { output: {} };
    },
  };
  const writer: ToolDefinition = {
    name: "test.writer",
    version: "1.0.0",
    description: "writes then fails",
    requires: ["artifact:write"],
    inputSchema: OBJ({}) as Schema,
    outputSchema: OBJ({}) as Schema,
    async run(ctx) {
      await ctx.writeArtifact("log", "text/plain", "partial evidence");
      throw new Error("later step failed");
    },
  };
  const tokens: ToolDefinition = {
    name: "test.tokens",
    version: "1.0.0",
    description: "spends",
    requires: [],
    inputSchema: OBJ({}) as Schema,
    outputSchema: OBJ({}) as Schema,
    async run(ctx) {
      ctx.reportUsage({ tokens: 900, costUsd: 0.01 });
      ctx.reportUsage({ tokens: 900 });
      return { output: {} };
    },
  };
  const env: ToolDefinition = {
    name: "test.env",
    version: "1.0.0",
    description: "reads env",
    requires: ["env:read"],
    env: ["QA_TEST_VALUE"],
    inputSchema: OBJ({}) as Schema,
    outputSchema: OBJ({ seen: { type: "boolean" }, keys: { type: "integer", minimum: 0, maximum: 10 } }, ["seen", "keys"]) as Schema,
    async run(ctx) {
      return { output: { seen: ctx.env.QA_TEST_VALUE === "value-from-env", keys: Object.keys(ctx.env).length } };
    },
  };
  const reader: ToolDefinition = {
    name: "test.reader",
    version: "1.0.0",
    description: "reads artifacts",
    requires: ["artifact:read"],
    inputSchema: OBJ({}) as Schema,
    outputSchema: OBJ({ bytes: { type: "integer", minimum: 0, maximum: 100000 } }, ["bytes"]) as Schema,
    async run(ctx) {
      let n = 0;
      for (const a of ctx.artifacts) n += (await a.read()).length;
      return { output: { bytes: n } };
    },
  };
  return (tools: ToolRegistry) => {
    for (const t of [sleep, echo, flaky, badOutput, sneaky, writer, tokens, env, reader]) tools.register(t);
  };
}

async function setup(agents: Record<string, [string, Record<string, unknown>?]>, opts: { dir?: string; maxConcurrency?: number } = {}) {
  const p = probe();
  const rt = await makeRuntime({ extraTools: testTools(p), env: { QA_TEST_VALUE: "value-from-env", OTHER_SECRET: "nope" }, ...opts });
  for (const [id, [toolName, over]] of Object.entries(agents)) {
    await rt.registry.register(testAgent(id, rt.tools.get(toolName)!, over), hugo);
  }
  return { rt, p };
}

const submit = (rt: Awaited<ReturnType<typeof makeRuntime>>, agentId: string, input: unknown = {}, extra: { id?: string; artifacts?: unknown[] } = {}) =>
  rt.runner.submit({ agentId, agentVersion: "1.0.0", input, ...extra }, hugo);

const states = (task: { history: { state: string; reason?: string }[] }) => task.history.map((h) => (h.reason ? `${h.state}:${h.reason}` : h.state));

describe("agent runner", () => {
  it("runs a task through ordered lifecycle events that carry no prompt, input text or secrets", async () => {
    const { rt } = await setup({ echoer: ["test.echo"] });
    const task = await submit(rt, "echoer", { text: `hello ${PLANTED.email}` });
    expect(task.input.text).toBe("hello [email]"); // input snapshot is sanitized before it is stored
    const done = await rt.runner.execute(task.id);
    expect(done.state).toBe("succeeded");
    expect(states(done)).toEqual(["queued", "running", "succeeded"]);
    expect(done.result?.output).toEqual({ text: expect.stringContaining("[github-token]") });
    expect(JSON.stringify(done.result?.output)).not.toContain(PLANTED.token);

    const events = await rt.store.listEvents(`agent-${task.id}`);
    expect(events.map((e) => `${e.status}/${e.phase}`)).toEqual(["waiting/queued", "working/analyze", "completed/report"]);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(events.every((e) => e.tool === "agent-runtime" && e.taskId === task.id && e.agent === "system")).toBe(true);
    const text = JSON.stringify(events);
    for (const secret of [...Object.values(PLANTED), "SYSTEM-PROMPT-MARKER", "hello"]) expect(text).not.toContain(secret);
    expect((await rt.store.getTask(task.id))).toMatchObject({ kind: "run-agent", status: "completed", params: { agentId: "echoer", agentVersion: "1.0.0" } });
  });

  it("validates input, artifacts and who submits", async () => {
    const { rt } = await setup({ echoer: ["test.echo"], reader: ["test.reader", { artifacts: { accepts: ["report"], produces: [] }, limits: { timeoutMs: 200, maxRetries: 0, maxConcurrency: 1, maxInputArtifacts: 1, maxOutputBytes: 2048, maxTokens: 0 } }] });
    await expect(submit(rt, "echoer", { text: 5 })).rejects.toThrow("invalid-input");
    await expect(submit(rt, "echoer", { text: "x", extra: true })).rejects.toThrow("invalid-input");
    await expect(submit(rt, "echoer", { text: "x".repeat(101) })).rejects.toThrow("invalid-input");
    const agent: Actor = { kind: "agent", agentId: "echoer", agentVersion: "1.0.0", taskId: "t" };
    await expect(rt.runner.submit({ agentId: "echoer", agentVersion: "1.0.0", input: { text: "x" } }, agent)).rejects.toThrow("capability-denied");

    const report = await rt.artifacts.register({ kind: "report", mime: "text/markdown", data: "# r", origin: { kind: "import", actorId: "hugo" } });
    const shot = await rt.artifacts.register({ kind: "screenshot", mime: "image/png", data: PNG, origin: { kind: "import", actorId: "hugo" } });
    await expect(submit(rt, "reader", {}, { artifacts: [shot] })).rejects.toThrow("artifact-kind-not-allowed");
    await expect(submit(rt, "reader", {}, { artifacts: [report, report] })).rejects.toThrow("too-many-artifacts");
    await expect(submit(rt, "reader", {}, { artifacts: [{ ...report, sha256: "f".repeat(64) }] })).rejects.toThrow("artifact-tampered");
    await expect(submit(rt, "echoer", { text: "x" }, { id: "../etc" })).rejects.toThrow("invalid-value");
    const ok = await rt.runner.execute((await submit(rt, "reader", {}, { artifacts: [report] })).id);
    expect(ok.result?.output).toEqual({ bytes: 3 });
  });

  it("rejects duplicate tasks and never runs one task twice", async () => {
    const { rt, p } = await setup({ sleeper: ["test.sleep"] });
    await submit(rt, "sleeper", { ms: 20 }, { id: "task-dup" });
    await expect(submit(rt, "sleeper", { ms: 20 }, { id: "task-dup" })).rejects.toThrow("duplicate-task");
    const runs = await Promise.allSettled([rt.runner.execute("task-dup"), rt.runner.execute("task-dup")]);
    expect(runs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(runs.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "task-not-runnable" } });
    expect(p.started).toHaveLength(1);
    await expect(rt.runner.execute("task-dup")).rejects.toThrow("task-not-runnable");
    await expect(rt.runner.execute("task-none")).rejects.toThrow("task-unknown");
  });

  it("times out, retries once, then ends timed-out and releases the tool each attempt", async () => {
    const limits = { timeoutMs: 100, maxRetries: 1, maxConcurrency: 1, maxInputArtifacts: 0, maxOutputBytes: 2048, maxTokens: 0 };
    const { rt, p } = await setup({ sleeper: ["test.sleep", { limits }] });
    const done = await rt.runner.execute((await submit(rt, "sleeper", { ms: 5000 })).id);
    expect(done.state).toBe("timed-out");
    expect(states(done)).toEqual(["queued", "running", "retrying:timeout", "running", "timed-out:timeout"]);
    expect(done.attempts).toBe(2);
    expect(p.aborted).toBe(2);
    expect(p.active).toBe(0);
  });

  it("retries a thrown failure and succeeds; never retries invalid output", async () => {
    const limits = { timeoutMs: 500, maxRetries: 2, maxConcurrency: 1, maxInputArtifacts: 0, maxOutputBytes: 2048, maxTokens: 0 };
    const { rt, p } = await setup({ flaky: ["test.flaky", { limits }], bad: ["test.bad-output", { limits }] });
    const ok = await rt.runner.execute((await submit(rt, "flaky")).id);
    expect(states(ok)).toEqual(["queued", "running", "retrying:tool-failed", "running", "succeeded"]);
    expect(JSON.stringify(ok)).not.toContain(PLANTED.email); // the thrown message is never recorded
    p.calls = 0;
    const bad = await rt.runner.execute((await submit(rt, "bad")).id);
    expect(bad.state).toBe("failed");
    expect(bad.result?.reason).toBe("invalid-output");
    expect(p.calls).toBe(1);
  });

  it("cancels queued and running tasks and aborts the tool's signal", async () => {
    const limits = { timeoutMs: 10_000, maxRetries: 2, maxConcurrency: 1, maxInputArtifacts: 0, maxOutputBytes: 2048, maxTokens: 0 };
    const { rt, p } = await setup({ sleeper: ["test.sleep", { limits }] });
    const queued = await submit(rt, "sleeper", { ms: 10 });
    expect(await rt.runner.cancel(queued.id)).toBe(true);
    expect((await rt.runner.get(queued.id))!.state).toBe("cancelled");
    await expect(rt.runner.execute(queued.id)).rejects.toThrow("task-not-runnable");

    const running = await submit(rt, "sleeper", { ms: 5000 });
    const pending = rt.runner.execute(running.id);
    while (!p.started.length) await new Promise((r) => setTimeout(r, 5));
    expect(await rt.runner.cancel(running.id)).toBe(true);
    const done = await pending;
    expect(states(done)).toEqual(["queued", "running", "cancelled:cancelled"]); // no retry after a cancel
    expect(p.aborted).toBe(1);
    expect(await rt.runner.cancel(running.id)).toBe(false);
  });

  it("cancels a task that is waiting for a concurrency slot", async () => {
    const { rt, p } = await setup({ sleeper: ["test.sleep"] });
    const a = await submit(rt, "sleeper", { ms: 50, label: "a" });
    const b = await submit(rt, "sleeper", { ms: 50, label: "b" });
    const runA = rt.runner.execute(a.id);
    const runB = rt.runner.execute(b.id);
    while (!p.started.length) await new Promise((r) => setTimeout(r, 2));
    await rt.runner.cancel(b.id);
    expect((await runB).state).toBe("cancelled");
    expect((await runA).state).toBe("succeeded");
    expect(p.started).toEqual(["a"]);
  });

  it("limits concurrency per agent version and globally, in FIFO order", async () => {
    const { rt, p } = await setup({ one: ["test.sleep"], two: ["test.sleep", { limits: { timeoutMs: 1000, maxRetries: 0, maxConcurrency: 3, maxInputArtifacts: 0, maxOutputBytes: 2048, maxTokens: 0 } }] }, { maxConcurrency: 2 });
    const ids = [];
    for (const label of ["a", "b", "c"]) ids.push((await submit(rt, "one", { ms: 20, label })).id);
    await Promise.all(ids.map((id) => rt.runner.execute(id)));
    expect(p.maxActive).toBe(1);
    expect(p.started).toEqual(["a", "b", "c"]);

    p.maxActive = 0;
    p.started.length = 0;
    const more = [];
    for (const label of ["d", "e", "f", "g"]) more.push((await submit(rt, "two", { ms: 20, label })).id);
    await Promise.all(more.map((id) => rt.runner.execute(id)));
    expect(p.maxActive).toBe(2); // global limit below the agent's own limit of 3
    expect(p.started).toEqual(["d", "e", "f", "g"]);
  });

  it("denies undeclared capabilities at run time and enforces token budgets", async () => {
    const { rt } = await setup({
      sneaky: ["test.sneaky"],
      spender: ["test.tokens", { limits: { timeoutMs: 1000, maxRetries: 0, maxConcurrency: 1, maxInputArtifacts: 0, maxOutputBytes: 2048, maxTokens: 1000 } }],
    });
    const sneaky = await rt.runner.execute((await submit(rt, "sneaky")).id);
    expect(sneaky.result?.reason).toBe("capability-denied");
    expect(await rt.artifacts.list()).toEqual([]);
    const spender = await rt.runner.execute((await submit(rt, "spender")).id);
    expect(spender.result?.reason).toBe("token-limit");
    expect(spender.result?.usage).toMatchObject({ provider: "deterministic", tokens: 1800, costUsd: 0.01 });
  });

  it("passes only declared environment variables and never stores their values", async () => {
    const { rt } = await setup({ envy: ["test.env", { env: ["QA_TEST_VALUE"] }] });
    const done = await rt.runner.execute((await submit(rt, "envy")).id);
    expect(done.result?.output).toEqual({ seen: true, keys: 1 });
    expect(JSON.stringify(await rt.runner.list())).not.toContain("value-from-env");
  });

  it("a failed stage keeps its artifacts and the board state, with a bounded reason code", async () => {
    const { rt } = await setup({ writer: ["test.writer", { artifacts: { accepts: [], produces: ["log"] } }] });
    const done = await rt.runner.execute((await submit(rt, "writer")).id);
    expect(done.state).toBe("failed");
    expect(done.result?.reason).toBe("tool-failed");
    expect(done.result?.producedArtifacts).toHaveLength(1);
    const [art] = await rt.artifacts.list();
    expect(art?.origin).toMatchObject({ kind: "agent", agentId: "writer", agentVersion: "1.0.0", taskId: done.id });
    expect(await rt.boards.list()).toEqual([]);
    expect(JSON.stringify(done)).not.toContain("later step failed");
  });

  it("after a restart, interrupted tasks end failed and queued ones stay queued", async () => {
    const dir = await tempDir();
    const { rt } = await setup({ sleeper: ["test.sleep"] }, { dir });
    const stuck = await submit(rt, "sleeper", { ms: 1 });
    const waiting = await submit(rt, "sleeper", { ms: 1 });
    await rt.db.mutate<{ state: string; attempts: number }, void>("tasks", (all) => {
      all[stuck.id]!.state = "running";
      all[stuck.id]!.attempts = 1;
    });
    const p = probe();
    const again = await makeRuntime({ dir, extraTools: testTools(p) });
    expect(again.interrupted).toEqual([stuck.id]);
    expect((await again.runner.get(stuck.id))!.result?.reason).toBe("interrupted");
    expect((await again.runner.get(waiting.id))!.state).toBe("queued");
    expect((await again.runner.execute(waiting.id)).state).toBe("succeeded");
    const files = await readdir(dir);
    expect(files).toEqual(expect.arrayContaining(["agents.json", "tasks.json", "events.json", "core-tasks.json"]));
    expect(await readFile(path.join(dir, "tasks.json"), "utf8")).not.toContain("SYSTEM-PROMPT-MARKER");
  });
});
