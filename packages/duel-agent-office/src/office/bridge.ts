import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AGENTS, runTask, type TaskDeps } from "./agents.js";
import { OFFICE_AGENT_IDS, type OfficeAgentId, type OfficeEvent, type OfficeTask } from "./contract.js";
import { AGENT_COMMANDS } from "./agentConfig.js";
import type { ProcessRegistry } from "./procs.js";

const MAX_BODY_BYTES = 16_000;

export interface BridgeDeps extends Omit<TaskDeps, "emit"> {
  port: number;
  /** Runner processes this office started. Without it, stopping a task cannot clean up stale processes. */
  registry?: ProcessRegistry;
}

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_BODY_BYTES) {
        req.destroy();
        resolve(undefined);
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", () => resolve(undefined));
  });
}

function parseTask(raw: string): OfficeTask | undefined {
  try {
    const t = JSON.parse(raw) as Partial<OfficeTask>;
    if (typeof t.taskId !== "string" || !t.taskId || t.taskId.length > 64) return undefined;
    if (!(OFFICE_AGENT_IDS as readonly string[]).includes(t.agentId as string)) return undefined;
    if (typeof t.title !== "string" || !t.title.trim() || t.title.length > 200) return undefined;
    const memories = Array.isArray(t.memories) ? t.memories.filter((m): m is string => typeof m === "string").slice(0, 5) : [];
    const command = typeof t.command === "string" && AGENT_COMMANDS[t.agentId as OfficeAgentId].some((c) => c.id === t.command) ? t.command : undefined;
    return { taskId: t.taskId, agentId: t.agentId as OfficeAgentId, title: t.title, memories, ...(command ? { command } : {}) };
  } catch {
    return undefined;
  }
}

/**
 * Local-only HTTP bridge: the contract any office UI uses (see docs/agent-office.md).
 *   GET  /agents   agent list with metrics
 *   GET  /metrics  metrics per agent
 *   POST /tasks    body OfficeTask (application/json) -> NDJSON stream of OfficeEvent, last line has `result`
 *   POST /agents/:id/stop     stops the agent's running task (kills its runner and browsers)
 *   GET  /processes           runner processes left by an earlier office (pid-free summary)
 *   POST /processes/cleanup   stops those that still look like a runner and forgets the rest
 * Bound to 127.0.0.1. The Host check blocks DNS rebinding; the JSON content type blocks cross-site form posts,
 * because a task can start a real browser run against the Preview.
 */
export function createBridge(deps: BridgeDeps): Server {
  const busy = new Set<OfficeAgentId>();
  const running = new Map<OfficeAgentId, AbortController>();
  const hosts = new Set([`127.0.0.1:${deps.port}`, `localhost:${deps.port}`]);
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  return createServer(async (req, res) => {
    if (!hosts.has(req.headers.host ?? "")) return json(res, 403, { error: "forbidden host" });
    const url = (req.url ?? "").split("?")[0];

    if (req.method === "GET" && url === "/agents") {
      const metrics = deps.metrics.all();
      return json(res, 200, OFFICE_AGENT_IDS.map((id) => ({
        id,
        name: AGENTS[id].name,
        role: AGENTS[id].role,
        tools: AGENTS[id].tools,
        metrics: metrics[id],
        busy: busy.has(id),
      })));
    }
    if (req.method === "GET" && url === "/metrics") return json(res, 200, deps.metrics.all());

    if (req.method === "GET" && url === "/processes") {
      const stale = (await deps.registry?.stale()) ?? [];
      return json(res, 200, { stale: stale.map((p) => ({ label: p.label, startedAt: p.startedAt })) });
    }
    const stop = req.method === "POST" ? /^\/agents\/([a-z-]+)\/stop$/.exec(url ?? "") : null;
    if ((stop || (req.method === "POST" && url === "/processes/cleanup")) && !(req.headers["content-type"] ?? "").startsWith("application/json")) {
      return json(res, 415, { error: "application/json required" });
    }
    if (stop) {
      const controller = running.get(stop[1] as OfficeAgentId);
      if (!controller) return json(res, 404, { error: "That agent has no running task" });
      controller.abort();
      return json(res, 202, { stopping: true });
    }
    if (req.method === "POST" && url === "/processes/cleanup") {
      const result = (await deps.registry?.cleanupStale()) ?? { stopped: [], forgotten: [] };
      return json(res, 200, { stopped: result.stopped.length, forgotten: result.forgotten.length });
    }

    if (req.method === "POST" && url === "/tasks") {
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "application/json required" });
      const raw = await readBody(req);
      const task = raw === undefined ? undefined : parseTask(raw);
      if (!task) return json(res, 400, { error: "invalid task" });
      if (busy.has(task.agentId)) return json(res, 409, { error: "agent is busy" });

      busy.add(task.agentId);
      const controller = new AbortController();
      running.set(task.agentId, controller);
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
      const emit = (event: OfficeEvent) => res.write(`${JSON.stringify(event)}\n`);
      try {
        await runTask({ ...deps, emit }, task, controller.signal);
      } catch {
        // runTask handles tool and model failures itself; this only guards against a bug leaking a stack trace.
        emit({
          at: new Date().toISOString(),
          taskId: task.taskId,
          agentId: task.agentId,
          status: "blocked",
          activity: "Task crashed unexpectedly",
        });
      } finally {
        busy.delete(task.agentId);
        running.delete(task.agentId);
        res.end();
      }
      return;
    }
    json(res, 404, { error: "not found" });
  });
}
