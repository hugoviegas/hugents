import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { OFFICE_AGENT_IDS, type AgentMetrics, type OfficeAgentId, type OfficeEvent, type ToolName } from "./contract.js";

/**
 * The office hub sits between the Agent Office page and the bridge. It keeps the task board (what was assigned,
 * to whom, and how it ended) and the latest events, so a page reload or a second browser tab sees the same office.
 * The bridge stays the only process that runs tools or talks to a model; the hub only forwards a task and reads
 * the NDJSON events the bridge streams back.
 */

export type HubTaskStatus = "queued" | "working" | "blocked" | "completed";

export interface HubTask {
  taskId: string;
  agentId: OfficeAgentId;
  title: string;
  status: HubTaskStatus;
  createdAt: string;
  updatedAt: string;
  activity: string;
  summary?: string;
  runId?: string;
  reportPath?: string;
  usedFallback?: boolean;
  /** The command this task came from (`run`, `analyze-latest`, `plan`). */
  command?: string;
  /** The user stopped it. */
  stopped?: boolean;
}

export interface HubEvent {
  at: string;
  taskId: string;
  agentId: OfficeAgentId;
  status: OfficeEvent["status"];
  activity: string;
  tool?: ToolName;
}

export interface HubAgent {
  id: OfficeAgentId;
  busy: boolean;
  metrics?: AgentMetrics;
}

export interface OfficeView {
  /** False when the bridge did not answer: activity is unknown, not idle. */
  connected: boolean;
  readonly: boolean;
  agents: HubAgent[];
  tasks: HubTask[];
  events: HubEvent[];
  /** Runner processes recorded by an earlier office and not owned by the current bridge. */
  staleRunners: number;
}

export interface AssignResult {
  status: number;
  body: { task?: HubTask; error?: string };
}

export interface OfficeHubOptions {
  /** Loopback URL of the bridge, e.g. http://127.0.0.1:3100. */
  bridgeUrl: string;
  readonly: boolean;
  /** Task board file; tasks survive a restart. */
  storeFile?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface OfficeHub {
  view(): Promise<OfficeView>;
  assign(input: unknown): Promise<AssignResult>;
  /** Stops the agent's running task: its runner and browsers are killed and the report is marked as interrupted. */
  stop(agentId: unknown): Promise<{ status: number; body: { stopping?: boolean; error?: string } }>;
  /** Stops recorded runner processes left by an earlier office. */
  cleanup(): Promise<{ status: number; body: { stopped?: number; forgotten?: number; error?: string } }>;
  /** Resolves when every task started by `assign` has finished streaming (tests and shutdown). */
  idle(): Promise<void>;
}

const MAX_TASKS = 50;
const MAX_EVENTS = 60;
const MAX_TITLE = 200;
const AGENTS_TIMEOUT_MS = 1500;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export class OfficeHubConfigError extends Error {}

/** The bridge must be on this machine: the hub never forwards a task anywhere else. */
export function checkBridgeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OfficeHubConfigError("QA_BRIDGE_URL must be a URL like http://127.0.0.1:3100");
  }
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) {
    throw new OfficeHubConfigError("QA_BRIDGE_URL must be http on a loopback address (127.0.0.1, localhost or ::1)");
  }
  return url.origin;
}

const isAgent = (v: unknown): v is OfficeAgentId => (OFFICE_AGENT_IDS as readonly unknown[]).includes(v);

function parseStored(raw: string): HubTask[] {
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((t): t is HubTask => !!t && typeof t === "object" && typeof (t as HubTask).taskId === "string" && isAgent((t as HubTask).agentId) && typeof (t as HubTask).title === "string")
      .slice(-MAX_TASKS);
  } catch {
    return [];
  }
}

export async function createOfficeHub(options: OfficeHubOptions): Promise<OfficeHub> {
  const bridge = checkBridgeUrl(options.bridgeUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const pending = new Set<Promise<void>>();
  const events: HubEvent[] = [];
  let tasks: HubTask[] = [];

  if (options.storeFile) {
    tasks = parseStored(await readFile(options.storeFile, "utf8").catch(() => "[]"));
    // A task that was still running when the office stopped did not finish; say so instead of showing it as live.
    for (const t of tasks) {
      if (t.status === "queued" || t.status === "working") Object.assign(t, { status: "blocked", activity: "Interrupted: the office stopped before this task finished" });
    }
  }

  let saving = Promise.resolve();
  const save = () => {
    const file = options.storeFile;
    if (!file) return;
    const body = JSON.stringify(tasks, null, 2);
    saving = saving
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, body);
        await rename(`${file}.tmp`, file);
      })
      .catch(() => undefined);
  };

  const update = (task: HubTask, patch: Partial<HubTask>) => {
    Object.assign(task, patch, { updatedAt: now().toISOString() });
  };

  const record = (event: OfficeEvent, task: HubTask) => {
    events.push({
      at: typeof event.at === "string" ? event.at : now().toISOString(),
      taskId: task.taskId,
      agentId: task.agentId,
      status: event.status,
      activity: String(event.activity ?? ""),
      ...(event.tool ? { tool: event.tool } : {}),
    });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    if (event.result) {
      update(task, {
        status: event.result.status,
        activity: String(event.activity ?? ""),
        summary: event.result.summary,
        usedFallback: event.result.usedFallback,
        ...(event.result.runId ? { runId: event.result.runId } : {}),
        ...(event.result.reportPath ? { reportPath: event.result.reportPath } : {}),
        ...(event.result.stopped ? { stopped: true } : {}),
      });
    } else {
      update(task, { status: event.status === "idle" ? "working" : event.status, activity: String(event.activity ?? "") });
    }
  };

  const fail = (task: HubTask, activity: string) => {
    record({ at: now().toISOString(), taskId: task.taskId, agentId: task.agentId, status: "blocked", activity }, task);
    update(task, { status: "blocked" });
  };

  async function stream(task: HubTask): Promise<void> {
    let res: Response;
    try {
      res = await fetchImpl(`${bridge}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.taskId, agentId: task.agentId, title: task.title, memories: [], ...(task.command ? { command: task.command } : {}) }),
      });
    } catch {
      return fail(task, "Bridge offline: the task was not started");
    }
    if (!res.ok || !res.body) {
      return fail(task, res.status === 409 ? "The agent is busy with another task" : `The bridge refused the task (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    const line = (raw: string) => {
      if (!raw.trim()) return;
      try {
        const event = JSON.parse(raw) as OfficeEvent;
        if (event.taskId !== task.taskId) return;
        record(event, task);
        if (event.result) finished = true;
      } catch {
        // A malformed line is skipped; the bridge only writes JSON.
      }
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          line(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      }
      line(buffer + decoder.decode());
    } catch {
      // Connection dropped mid-task: handled below as an unfinished task.
    }
    if (!finished && task.status !== "blocked") fail(task, "The bridge stopped before the task finished");
  }

  return {
    async view() {
      let agents: HubAgent[] = [];
      let connected = false;
      let staleRunners = 0;
      try {
        const res = await fetchImpl(`${bridge}/agents`, { signal: AbortSignal.timeout(AGENTS_TIMEOUT_MS) });
        if (res.ok) {
          const list = (await res.json()) as unknown;
          if (Array.isArray(list)) {
            connected = true;
            const procs = await fetchImpl(`${bridge}/processes`, { signal: AbortSignal.timeout(AGENTS_TIMEOUT_MS) }).then((r) => (r.ok ? (r.json() as Promise<{ stale?: unknown[] }>) : null)).catch(() => null);
            staleRunners = Array.isArray(procs?.stale) ? procs.stale.length : 0;
            agents = list
              .filter((a): a is { id: OfficeAgentId; busy?: unknown; metrics?: AgentMetrics } => !!a && isAgent((a as { id?: unknown }).id))
              .map((a) => ({ id: a.id, busy: a.busy === true, ...(a.metrics ? { metrics: a.metrics } : {}) }));
          }
        }
      } catch {
        connected = false;
      }
      return {
        connected,
        readonly: options.readonly,
        agents,
        tasks: tasks.map((t) => ({ ...t })).reverse(),
        events: events.map((e) => ({ ...e })).reverse(),
        staleRunners,
      };
    },

    async stop(agentId) {
      if (options.readonly) return { status: 403, body: { error: "The office is read-only" } };
      if (!isAgent(agentId)) return { status: 400, body: { error: "Unknown agent" } };
      try {
        const res = await fetchImpl(`${bridge}/agents/${agentId}/stop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(AGENTS_TIMEOUT_MS * 3) });
        if (res.status === 404) return { status: 409, body: { error: "That agent has no running task" } };
        return res.ok ? { status: 202, body: { stopping: true } } : { status: 502, body: { error: `The bridge refused to stop the task (${res.status})` } };
      } catch {
        return { status: 502, body: { error: "Bridge offline: nothing was stopped" } };
      }
    },

    async cleanup() {
      if (options.readonly) return { status: 403, body: { error: "The office is read-only" } };
      try {
        const res = await fetchImpl(`${bridge}/processes/cleanup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(30_000) });
        if (!res.ok) return { status: 502, body: { error: `The bridge refused the cleanup (${res.status})` } };
        const body = (await res.json()) as { stopped?: number; forgotten?: number };
        return { status: 200, body: { stopped: Number(body.stopped) || 0, forgotten: Number(body.forgotten) || 0 } };
      } catch {
        return { status: 502, body: { error: "Bridge offline: nothing was cleaned up" } };
      }
    },

    async assign(input) {
      if (options.readonly) return { status: 403, body: { error: "The office is read-only" } };
      const body = (input && typeof input === "object" ? input : {}) as { agentId?: unknown; title?: unknown; command?: unknown };
      if (!isAgent(body.agentId)) return { status: 400, body: { error: "Unknown agent" } };
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title || title.length > MAX_TITLE) return { status: 400, body: { error: `The task needs a title of 1 to ${MAX_TITLE} characters` } };
      if (tasks.some((t) => t.agentId === body.agentId && (t.status === "queued" || t.status === "working"))) {
        return { status: 409, body: { error: "This agent is already working on a task" } };
      }
      const at = now().toISOString();
      const task: HubTask = {
        taskId: `t-${now().getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        agentId: body.agentId,
        title,
        status: "queued",
        createdAt: at,
        updatedAt: at,
        activity: "Task assigned",
        ...(typeof body.command === "string" && /^[a-z-]{1,24}$/.test(body.command) ? { command: body.command } : {}),
      };
      tasks.push(task);
      if (tasks.length > MAX_TASKS) tasks = tasks.slice(-MAX_TASKS);
      save();
      const run = stream(task).finally(() => {
        save();
        pending.delete(run);
      });
      pending.add(run);
      return { status: 202, body: { task: { ...task } } };
    },

    async idle() {
      while (pending.size) await Promise.all([...pending]);
      await saving;
    },
  };
}
