import { BOARDS, type BoardService } from "./boards.js";
import type { AgentRegistry } from "./registry.js";
import type { AgentRunner, TaskState } from "./runner.js";

/**
 * Admin inspection data. Ids, versions, capabilities, states, reason codes and artifact references only: no prompt
 * text, no environment values, no artifact contents, no raw page text.
 */
export interface AgentInspection {
  id: string;
  version: string;
  versions: string[];
  name: string;
  role: string;
  contentHash: string;
  model: { provider: string; model?: string };
  tools: string[];
  capabilities: string[];
  boards: { produces: string[]; transitions: string[] };
  currentTask?: { id: string; state: TaskState };
  tasks: Record<TaskState, number>;
  errorsByReason: Record<string, number>;
}

export interface TaskInspection {
  id: string;
  agentId: string;
  agentVersion: string;
  state: TaskState;
  attempts: number;
  inputHash: string;
  artifacts: { id: string; kind: string; size: number }[];
  outputSummary?: string;
  reason?: string;
  usage?: { provider: string; model?: string; tokens?: number; costUsd?: number };
  proposedItems: { id: string; board: string; state: string; approval: "approved" | "pending" | "not-required" }[];
  createdAt: string;
  finishedAt?: string;
}

export interface Inspection {
  agents: AgentInspection[];
  tasks: TaskInspection[];
  boards: { id: string; board: string; state: string; rev: number; title?: string; approvedBy?: string; artifacts: number; parentId?: string }[];
}

const EMPTY_COUNTS = (): Record<TaskState, number> => ({ queued: 0, running: 0, retrying: 0, succeeded: 0, failed: 0, cancelled: 0, "timed-out": 0 });

export async function inspect(deps: { registry: AgentRegistry; runner: AgentRunner; boards: BoardService }): Promise<Inspection> {
  const tasks = await deps.runner.list();
  const items = await deps.boards.list();
  const byId = new Map(items.map((i) => [i.id, i]));

  const agents: AgentInspection[] = [];
  for (const { id, versions } of await deps.registry.list()) {
    const latest = await deps.registry.latest(id);
    if (!latest) continue;
    const m = latest.manifest;
    const mine = tasks.filter((t) => t.agentId === id);
    const counts = EMPTY_COUNTS();
    const errors: Record<string, number> = {};
    for (const t of mine) {
      counts[t.state] += 1;
      if (t.result?.reason) errors[t.result.reason] = (errors[t.result.reason] ?? 0) + 1;
    }
    const current = [...mine].reverse().find((t) => t.state === "running" || t.state === "retrying" || t.state === "queued");
    agents.push({
      id,
      version: m.version,
      versions,
      name: m.identity.name,
      role: m.identity.role,
      contentHash: latest.contentHash.slice(0, 12),
      model: m.model,
      tools: m.tools,
      capabilities: m.capabilities,
      boards: { produces: m.boards.produces.map((p) => `${p.board}:${p.state}`), transitions: m.boards.transitions.map((t) => `${t.board}:${t.from}->${t.to}`) },
      ...(current ? { currentTask: { id: current.id, state: current.state } } : {}),
      tasks: counts,
      errorsByReason: errors,
    });
  }

  return {
    agents,
    tasks: tasks.map((t) => ({
      id: t.id,
      agentId: t.agentId,
      agentVersion: t.agentVersion,
      state: t.state,
      attempts: t.attempts,
      inputHash: t.inputHash.slice(0, 12),
      artifacts: t.artifacts.map((a) => ({ id: a.id, kind: a.kind, size: a.size })),
      ...(t.result?.outputSummary ? { outputSummary: t.result.outputSummary } : {}),
      ...(t.result?.reason ? { reason: t.result.reason } : {}),
      ...(t.result ? { usage: t.result.usage, finishedAt: t.result.finishedAt } : {}),
      proposedItems: (t.result?.proposedItemIds ?? []).flatMap((iid) => {
        const item = byId.get(iid);
        if (!item) return [];
        const needs = BOARDS[item.board].transitions.some((x) => x.approval);
        return [{ id: iid, board: item.board, state: item.state, approval: item.approval ? "approved" : needs ? "pending" : "not-required" } as const];
      }),
      createdAt: t.createdAt,
    })),
    boards: items.map((i) => ({
      id: i.id,
      board: i.board,
      state: i.state,
      rev: i.rev,
      ...(typeof i.payload.title === "string" ? { title: i.payload.title } : typeof i.payload.goal === "string" ? { title: i.payload.goal } : {}),
      ...(i.approval ? { approvedBy: i.approval.by } : {}),
      artifacts: i.artifacts.length,
      ...(i.parentId ? { parentId: i.parentId } : {}),
    })),
  };
}
