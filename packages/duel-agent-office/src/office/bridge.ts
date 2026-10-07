import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AGENTS, runTask, type TaskDeps } from "./agents.js";
import { OFFICE_AGENT_IDS, type OfficeAgentId, type OfficeEvent, type OfficeTask } from "./contract.js";

const MAX_BODY_BYTES = 16_000;

export interface BridgeDeps extends Omit<TaskDeps, "emit"> {
  port: number;
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
    return { taskId: t.taskId, agentId: t.agentId as OfficeAgentId, title: t.title, memories };
  } catch {
    return undefined;
  }
}

/**
 * Local-only HTTP bridge: the contract any office UI uses (see docs/agent-office.md).
 *   GET  /agents   agent list with metrics
 *   GET  /metrics  metrics per agent
 *   POST /tasks    body OfficeTask (application/json) -> NDJSON stream of OfficeEvent, last line has `result`
 * Bound to 127.0.0.1. The Host check blocks DNS rebinding; the JSON content type blocks cross-site form posts,
 * because a task can start a real browser run against the Preview.
 */
export function createBridge(deps: BridgeDeps): Server {
  const busy = new Set<OfficeAgentId>();
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

    if (req.method === "POST" && url === "/tasks") {
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "application/json required" });
      const raw = await readBody(req);
      const task = raw === undefined ? undefined : parseTask(raw);
      if (!task) return json(res, 400, { error: "invalid task" });
      if (busy.has(task.agentId)) return json(res, 409, { error: "agent is busy" });

      busy.add(task.agentId);
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
      const emit = (event: OfficeEvent) => res.write(`${JSON.stringify(event)}\n`);
      try {
        await runTask({ ...deps, emit }, task);
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
        res.end();
      }
      return;
    }
    json(res, 404, { error: "not found" });
  });
}
