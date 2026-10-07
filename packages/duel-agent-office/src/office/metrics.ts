import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { OFFICE_AGENT_IDS, type AgentMetrics, type OfficeAgentId } from "./contract.js";

const empty = (): AgentMetrics => ({ tasksCompleted: 0, tasksBlocked: 0, tokensUsed: 0, reputation: 0.5 });
const clamp01 = (n: number) => Math.min(1, Math.max(0, Math.round(n * 100) / 100));

export interface MetricsStore {
  get(agentId: OfficeAgentId): AgentMetrics;
  all(): Record<OfficeAgentId, AgentMetrics>;
  record(agentId: OfficeAgentId, outcome: "completed" | "blocked", tokens: number): Promise<AgentMetrics>;
}

/**
 * Per-agent counters in one JSON file (`artifacts/office/metrics.json`).
 * Reputation is a plain heuristic: +0.05 per completed task, -0.05 per blocked one, kept in 0..1.
 */
export async function openMetrics(file: string): Promise<MetricsStore> {
  const data = Object.fromEntries(OFFICE_AGENT_IDS.map((id) => [id, empty()])) as Record<OfficeAgentId, AgentMetrics>;
  try {
    const saved = JSON.parse(await readFile(file, "utf8")) as Partial<Record<OfficeAgentId, Partial<AgentMetrics>>>;
    for (const id of OFFICE_AGENT_IDS) Object.assign(data[id], saved[id]);
  } catch {
    // first run or unreadable file: start from zero
  }
  let writing: Promise<void> = Promise.resolve();
  return {
    get: (id) => ({ ...data[id] }),
    all: () => structuredClone(data),
    async record(id, outcome, tokens) {
      const m = data[id];
      if (outcome === "completed") m.tasksCompleted += 1;
      else m.tasksBlocked += 1;
      m.tokensUsed += Math.max(0, Math.round(tokens));
      m.reputation = clamp01(m.reputation + (outcome === "completed" ? 0.05 : -0.05));
      writing = writing.then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
      });
      await writing;
      return { ...m };
    },
  };
}
