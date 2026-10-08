import type { HugentsEvent, Phase, Sanitizer, Status, Store, TaskStatus } from "@hugents/core";
import type { AgentDefinition } from "./agent.js";
import type { ArtifactRef, ArtifactRegistry } from "./artifacts.js";
import { actorRef, type Actor, type ActorRef, type BoardItem, type BoardService } from "./boards.js";
import { RuntimeError, ToolFailure, type RuntimeReasonCode } from "./errors.js";
import type { Db } from "./persist.js";
import type { AgentRegistry } from "./registry.js";
import { sanitizeFreeText, validateValue } from "./schema.js";
import type { InputArtifact, ToolContext, ToolOutput, ToolRegistry } from "./tools.js";
import { OPAQUE_ID, defaultNewId, hashValue, isObject, snapshot } from "./util.js";

export const TASK_STATES = ["queued", "running", "retrying", "succeeded", "failed", "cancelled", "timed-out"] as const;
export type TaskState = (typeof TASK_STATES)[number];
const FINAL: ReadonlySet<TaskState> = new Set(["succeeded", "failed", "cancelled", "timed-out"]);
/** Failures worth another attempt. Validation and permission failures are deterministic and never retried. */
const RETRYABLE: ReadonlySet<RuntimeReasonCode> = new Set(["timeout", "tool-failed"]);

export const TASK_CONTRACT_VERSION = 1;

/**
 * Versioned task contract. Routes work to one exact agent version and carries only schema-validated input and verified
 * artifact references. The input is a frozen snapshot with its hash; the agent content hash pins what ran.
 */
export interface AgentTask {
  v: typeof TASK_CONTRACT_VERSION;
  id: string;
  agentId: string;
  agentVersion: string;
  agentContentHash: string;
  input: Record<string, unknown>;
  inputHash: string;
  artifacts: ArtifactRef[];
  createdBy: ActorRef;
  createdAt: string;
  state: TaskState;
  attempts: number;
  history: { at: string; state: TaskState; attempt: number; reason?: RuntimeReasonCode }[];
  result?: AgentResult;
}

export interface AgentResult {
  output?: unknown;
  outputHash?: string;
  /** Shape only (keys, counts, numbers). Never free text. */
  outputSummary: string;
  proposedItemIds: string[];
  transitionedItemIds: string[];
  producedArtifacts: ArtifactRef[];
  usage: { provider: string; model?: string; tokens?: number; costUsd?: number };
  reason?: RuntimeReasonCode;
  startedAt: string;
  finishedAt: string;
}

export interface SubmitInput {
  id?: string;
  agentId: string;
  agentVersion: string;
  input: unknown;
  artifacts?: readonly unknown[];
}

const STATE_EVENT: Record<TaskState, { status: Status; phase: Phase; task: TaskStatus }> = {
  queued: { status: "waiting", phase: "queued", task: "pending" },
  running: { status: "working", phase: "analyze", task: "in_progress" },
  retrying: { status: "waiting", phase: "analyze", task: "in_progress" },
  succeeded: { status: "completed", phase: "report", task: "completed" },
  failed: { status: "failed", phase: "teardown", task: "failed" },
  cancelled: { status: "blocked", phase: "teardown", task: "blocked" },
  "timed-out": { status: "failed", phase: "teardown", task: "failed" },
};

/** FIFO slots. `acquire` resolves in request order, so who runs next is deterministic. */
class Limiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    else this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    };
  }
}

export function summarizeOutput(output: unknown): string {
  if (!isObject(output)) return "";
  return Object.entries(output)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `${v.length} item(s)` : typeof v === "number" || typeof v === "boolean" ? String(v) : typeof v}`)
    .join(", ")
    .slice(0, 200);
}

export interface RunnerOptions {
  db: Db;
  store: Store;
  sanitizer: Sanitizer;
  registry: AgentRegistry;
  tools: ToolRegistry;
  artifacts: ArtifactRegistry;
  boards: BoardService;
  now: () => Date;
  newId?: (prefix: string) => string;
  /** Source of declared environment variables. Defaults to `process.env`. Values never leave the tool context. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Tasks running at once across all agents. Each agent version also has its own `limits.maxConcurrency`. */
  maxConcurrency?: number;
}

export class AgentRunner {
  private readonly global: Limiter;
  private readonly perAgent = new Map<string, Limiter>();
  private readonly running = new Map<string, { abort: (why: "cancelled") => void }>();
  private readonly cancelRequested = new Set<string>();
  private readonly newId: (prefix: string) => string;

  constructor(private readonly o: RunnerOptions) {
    this.global = new Limiter(o.maxConcurrency ?? 4);
    this.newId = o.newId ?? defaultNewId;
  }

  /** Validates and queues a task. Nothing runs here. */
  async submit(req: SubmitInput, actor: Actor): Promise<AgentTask> {
    if (actor.kind === "agent") throw new RuntimeError("capability-denied", "actor");
    const agent = await this.o.registry.get(req.agentId, req.agentVersion);
    if (!agent) throw new RuntimeError("agent-not-registered", "agentVersion");
    const latest = (await this.o.registry.versions(req.agentId)).at(-1);
    if (latest !== req.agentVersion) throw new RuntimeError("stale-version", "agentVersion");
    const id = req.id ?? this.newId("task");
    if (!OPAQUE_ID.test(id)) throw new RuntimeError("invalid-value", "id");

    const issues = validateValue(agent.inputSchema, req.input, "input");
    if (issues.length) throw new RuntimeError("invalid-input", issues[0]!.path, issues);
    const input = sanitizeFreeText(agent.inputSchema, req.input, (t, max) => this.o.sanitizer.sanitizeText(t, max)) as Record<string, unknown>;

    const refs = req.artifacts ?? [];
    if (refs.length > agent.manifest.limits.maxInputArtifacts) throw new RuntimeError("too-many-artifacts", "artifacts");
    const artifacts: ArtifactRef[] = [];
    for (const ref of refs) {
      const { record } = await this.o.artifacts.resolve(ref);
      if (!agent.manifest.artifacts.accepts.includes(record.kind)) throw new RuntimeError("artifact-kind-not-allowed", "artifacts");
      artifacts.push({ id: record.id, kind: record.kind, sha256: record.sha256, size: record.size });
    }

    const at = this.o.now().toISOString();
    const task: AgentTask = {
      v: TASK_CONTRACT_VERSION,
      id,
      agentId: agent.manifest.id,
      agentVersion: agent.manifest.version,
      agentContentHash: agent.contentHash,
      input,
      inputHash: hashValue({ input, artifacts: artifacts.map((a) => [a.id, a.sha256]) }),
      artifacts,
      createdBy: actorRef(actor),
      createdAt: at,
      state: "queued",
      attempts: 0,
      history: [{ at, state: "queued", attempt: 0 }],
    };
    await this.o.db.mutate<AgentTask, void>("tasks", (all) => {
      if (all[id]) throw new RuntimeError("duplicate-task", "id");
      all[id] = task;
    });
    await this.announce(task, agent);
    return snapshot(task);
  }

  async get(id: string): Promise<AgentTask | undefined> {
    const t = (await this.o.db.read<AgentTask>("tasks"))[id];
    return t && snapshot(t);
  }

  async list(): Promise<AgentTask[]> {
    return Object.values(await this.o.db.read<AgentTask>("tasks"))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
      .map((t) => snapshot(t));
  }

  /**
   * After a restart: tasks that were claimed or running when the process stopped end `failed` with `interrupted`.
   * Their artifacts and any board items already committed stay as they were. Queued, unclaimed tasks stay queued.
   */
  async recoverInterrupted(): Promise<string[]> {
    const stuck = (await this.list()).filter((t) => !FINAL.has(t.state) && t.attempts !== 0).map((t) => t.id);
    for (const id of stuck) await this.finish(id, "failed", "interrupted", undefined, this.o.now().toISOString());
    return stuck;
  }

  /** Cancels a queued task at once, or aborts the running attempt. Returns false for tasks already finished. */
  async cancel(id: string): Promise<boolean> {
    const task = await this.get(id);
    if (!task || FINAL.has(task.state)) return false;
    const live = this.running.get(id);
    if (live) {
      this.cancelRequested.add(id);
      live.abort("cancelled");
    } else if (task.attempts === -1) {
      // claimed and waiting for a slot: `execute` sees the flag when it gets one
      this.cancelRequested.add(id);
    } else {
      await this.finish(id, "cancelled", "cancelled", undefined, this.o.now().toISOString());
    }
    return true;
  }

  /**
   * Runs a queued task to a final state: waits for a slot, calls the agent's entry tool with a capability-gated context,
   * enforces the timeout, retries retryable failures, validates the output and writes proposals and transitions in one
   * commit. Never throws for a task failure: the task ends `failed`, `timed-out` or `cancelled` with a reason code.
   */
  async execute(id: string): Promise<AgentTask> {
    const task = await this.get(id);
    if (!task) throw new RuntimeError("task-unknown", "id");
    if (task.state !== "queued") throw new RuntimeError("task-not-runnable", "state");
    const startedAt = this.o.now().toISOString();

    let agent: AgentDefinition | undefined;
    try {
      agent = await this.o.registry.get(task.agentId, task.agentVersion);
    } catch {
      agent = undefined;
    }
    if (!agent || agent.contentHash !== task.agentContentHash) return this.finish(id, "failed", "agent-tampered", undefined, startedAt);

    // claim before waiting, so a second `execute` of the same task fails instead of running it twice
    await this.o.db.mutate<AgentTask, void>("tasks", (all) => {
      const t = all[id];
      if (!t || t.state !== "queued" || t.attempts !== 0 || t.history.length !== 1) throw new RuntimeError("task-not-runnable", "state");
      t.attempts = -1; // claimed, not started
    });

    const key = `${agent.manifest.id}@${agent.manifest.version}`;
    if (!this.perAgent.has(key)) this.perAgent.set(key, new Limiter(agent.manifest.limits.maxConcurrency));
    const releaseGlobal = await this.global.acquire();
    const releaseAgent = await this.perAgent.get(key)!.acquire();
    try {
      if (this.cancelRequested.has(id)) return await this.finish(id, "cancelled", "cancelled", undefined, startedAt);
      const { maxRetries } = agent.manifest.limits;
      let reason: RuntimeReasonCode = "tool-failed";
      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        await this.setState(id, "running", attempt, agent);
        const outcome = await this.attempt(task, agent);
        if (outcome.ok) return await this.finish(id, "succeeded", undefined, outcome.result, startedAt);
        reason = outcome.reason;
        if (reason === "cancelled") return await this.finish(id, "cancelled", reason, outcome.result, startedAt);
        if (!RETRYABLE.has(reason) || attempt > maxRetries) return await this.finish(id, reason === "timeout" ? "timed-out" : "failed", reason, outcome.result, startedAt);
        await this.setState(id, "retrying", attempt, agent, reason);
      }
      return await this.finish(id, "failed", reason, undefined, startedAt);
    } finally {
      releaseAgent();
      releaseGlobal();
      this.cancelRequested.delete(id);
    }
  }

  private async attempt(
    task: AgentTask,
    agent: AgentDefinition,
  ): Promise<{ ok: true; result: Partial<AgentResult> } | { ok: false; reason: RuntimeReasonCode; result?: Partial<AgentResult> }> {
    const m = agent.manifest;
    const tool = this.o.tools.get(m.entry);
    if (!tool) return { ok: false, reason: "tool-failed" };
    const actor: Actor = { kind: "agent", agentId: m.id, agentVersion: m.version, taskId: task.id };
    const has = (c: string) => (m.capabilities as readonly string[]).includes(c);
    const deny = (): never => {
      throw new RuntimeError("capability-denied", "tool");
    };

    const ctrl = new AbortController();
    let why: "timeout" | "cancelled" | "done" | undefined;
    const abort = (w: "timeout" | "cancelled" | "done") => {
      if (!why) why = w;
      ctrl.abort(w);
    };
    this.running.set(task.id, { abort });
    const timer = setTimeout(() => abort("timeout"), m.limits.timeoutMs);
    const aborted = new Promise<never>((_, reject) => ctrl.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    aborted.catch(() => undefined);

    const usage: AgentResult["usage"] = { provider: m.model.provider, ...(m.model.model ? { model: m.model.model } : {}) };
    const produced: ArtifactRef[] = [];
    const readable = new Map<string, ArtifactRef>(task.artifacts.map((a) => [a.id, a]));
    const seenItems = new Map<string, BoardItem>();
    let overBudget = false;

    const inputs: InputArtifact[] = [];
    try {
      for (const ref of task.artifacts) {
        const { record, read } = await this.o.artifacts.resolve(ref);
        inputs.push({ ref, mime: record.mime, read: async () => (has("artifact:read") ? read() : deny()) });
      }
    } catch (err) {
      clearTimeout(timer);
      this.running.delete(task.id);
      return { ok: false, reason: err instanceof RuntimeError ? err.code : "artifact-tampered" };
    }

    const env = Object.fromEntries(m.env.map((name) => [name, (this.o.env ?? process.env)[name]]));
    const ctx: ToolContext = {
      agent: { id: m.id, version: m.version },
      taskId: task.id,
      input: snapshot(task.input),
      artifacts: inputs,
      prompt: snapshot(agent.prompt),
      model: snapshot(m.model),
      env: Object.freeze(env),
      signal: ctrl.signal,
      readItem: async (itemId) => {
        if (!has("board:read")) deny();
        const item = await this.o.boards.get(itemId);
        if (item) {
          seenItems.set(item.id, item);
          for (const a of item.artifacts) readable.set(a.id, a);
        }
        return item;
      },
      readArtifact: async (artifactId) => {
        const ref = readable.get(artifactId);
        if (!has("artifact:read") || !ref) deny();
        const { record, read } = await this.o.artifacts.resolve(ref);
        return { ref: ref!, mime: record.mime, bytes: await read() };
      },
      writeArtifact: async (kind, mime, data) => {
        if (!has("artifact:write") || !m.artifacts.produces.includes(kind)) deny();
        if (ctrl.signal.aborted) throw new RuntimeError("cancelled");
        const ref = await this.o.artifacts.register({ kind, mime, data, origin: { kind: "agent", agentId: m.id, agentVersion: m.version, taskId: task.id } });
        produced.push(ref);
        readable.set(ref.id, ref);
        return ref;
      },
      sanitize: (text, max) => this.o.sanitizer.sanitizeText(text, max),
      reportUsage: ({ tokens, costUsd }) => {
        if (tokens) usage.tokens = (usage.tokens ?? 0) + Math.max(0, Math.floor(tokens));
        if (costUsd) usage.costUsd = (usage.costUsd ?? 0) + Math.max(0, costUsd);
        if (m.limits.maxTokens > 0 && (usage.tokens ?? 0) > m.limits.maxTokens) {
          overBudget = true;
          ctrl.abort("done");
        }
      },
    };

    const partial = (): Partial<AgentResult> => ({ producedArtifacts: [...produced], usage: { ...usage } });
    try {
      const out: ToolOutput = await Promise.race([tool.run(ctx), aborted]);
      if (overBudget) return { ok: false, reason: "token-limit", result: partial() };
      const result = await this.applyOutput(agent, actor, out, readable, seenItems);
      return { ok: true, result: { ...result, ...partial() } };
    } catch (err) {
      const reason: RuntimeReasonCode = overBudget
        ? "token-limit"
        : why === "timeout" || why === "cancelled"
          ? why === "timeout" ? "timeout" : "cancelled"
          : err instanceof RuntimeError || err instanceof ToolFailure
            ? err.code
            : "tool-failed";
      return { ok: false, reason, result: partial() };
    } finally {
      clearTimeout(timer);
      abort("done"); // releases whatever the tool still holds
      this.running.delete(task.id);
    }
  }

  /** Validates output, proposals and transitions, then writes all board changes in one commit. */
  private async applyOutput(
    agent: AgentDefinition,
    actor: Actor,
    out: ToolOutput,
    readable: ReadonlyMap<string, ArtifactRef>,
    seenItems: ReadonlyMap<string, BoardItem>,
  ): Promise<Partial<AgentResult>> {
    if (!isObject(out)) throw new RuntimeError("invalid-output", "$");
    const issues = validateValue(agent.outputSchema, out.output, "output");
    if (issues.length) throw new RuntimeError("invalid-output", issues[0]!.path, issues);
    const output = sanitizeFreeText(agent.outputSchema, out.output, (t, max) => this.o.sanitizer.sanitizeText(t, max));
    if (Buffer.byteLength(JSON.stringify(output), "utf8") > agent.manifest.limits.maxOutputBytes) throw new RuntimeError("output-too-large", "output");

    const proposals = out.proposals ?? [];
    const transitions = out.transitions ?? [];
    if (proposals.length > 20 || transitions.length > 20) throw new RuntimeError("too-many-items", "proposals");
    // a tool may only attach artifacts this task was given, produced, or read through an item it was allowed to read
    for (const p of proposals) for (const a of p.artifacts ?? []) if (!readable.has(a.id)) throw new RuntimeError("capability-denied", "proposals.artifacts");
    const items = [];
    for (const p of proposals) items.push(await this.o.boards.prepare(actor, p));
    const plans = [];
    for (const t of transitions) {
      const seen = seenItems.get(t.itemId) ?? (await this.o.boards.get(t.itemId));
      if (!seen) throw new RuntimeError("item-unknown", "transitions");
      plans.push(await this.o.boards.prepareTransition(t.itemId, t.to, actor, { expectedRev: seen.rev, ...(t.reason ? { reason: t.reason } : {}) }));
    }
    const committed = await this.o.boards.commit(items, plans);
    return {
      output,
      outputHash: hashValue(output),
      outputSummary: summarizeOutput(output),
      proposedItemIds: committed.items.map((i) => i.id),
      transitionedItemIds: committed.transitioned.map((i) => i.id),
    };
  }

  private async setState(id: string, state: TaskState, attempt: number, agent: AgentDefinition, reason?: RuntimeReasonCode): Promise<void> {
    const task = await this.o.db.mutate<AgentTask, AgentTask>("tasks", (all) => {
      const t = all[id]!;
      t.state = state;
      t.attempts = attempt;
      t.history.push({ at: this.o.now().toISOString(), state, attempt, ...(reason ? { reason } : {}) });
      return t;
    });
    await this.announce(task, agent, reason);
  }

  private async finish(id: string, state: TaskState, reason: RuntimeReasonCode | undefined, partial: Partial<AgentResult> | undefined, startedAt: string): Promise<AgentTask> {
    let changed = true;
    const task = await this.o.db.mutate<AgentTask, AgentTask>("tasks", (all) => {
      const t = all[id]!;
      if (FINAL.has(t.state)) {
        // already final (e.g. cancelled while queued): first outcome wins
        changed = false;
        return t;
      }
      const at = this.o.now().toISOString();
      t.state = state;
      t.attempts = Math.max(0, t.attempts);
      t.history.push({ at, state, attempt: t.attempts, ...(reason ? { reason } : {}) });
      t.result = {
        outputSummary: "",
        proposedItemIds: [],
        transitionedItemIds: [],
        producedArtifacts: [],
        usage: { provider: "none" },
        ...partial,
        ...(reason ? { reason } : {}),
        startedAt,
        finishedAt: at,
      };
      return t;
    });
    if (changed) await this.announce(task, await this.o.registry.get(task.agentId, task.agentVersion).catch(() => undefined), reason);
    return snapshot(task);
  }

  /** Mirrors the state into the core Store: a `run-agent` task and a sanitized live event with fixed words only. */
  private async announce(task: AgentTask, agent: AgentDefinition | undefined, reason?: RuntimeReasonCode): Promise<void> {
    const map = STATE_EVENT[task.state];
    const at = this.o.now().toISOString();
    await this.o.store.upsertTask({
      id: task.id,
      kind: "run-agent",
      status: map.task,
      params: { agentId: task.agentId, agentVersion: task.agentVersion, inputHash: task.inputHash },
      updatedAt: at,
    });
    const session = `agent-${task.id}`.slice(0, 64);
    const last = (await this.o.store.listEvents(session)).at(-1);
    const event: HugentsEvent = this.o.sanitizer.sanitizeEvent({
      v: 1,
      seq: (last?.seq ?? -1) + 1,
      at,
      origin: "live",
      agent: agent?.manifest.officeAgent ?? "system",
      status: map.status,
      phase: map.phase,
      tool: "agent-runtime",
      taskId: task.id,
      label: `agent task ${task.state}${reason ? `: ${reason}` : ""}`,
    });
    await this.o.store.appendEvent(session, event);
  }
}
