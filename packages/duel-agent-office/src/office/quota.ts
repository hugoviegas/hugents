import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { OFFICE_AGENT_IDS, type OfficeAgentId } from "./contract.js";
import type { AgentConfig } from "./agentConfig.js";

/** Per-agent daily usage in one JSON file (counts only). The day is the machine's local day. */
export interface DayUsage {
  tasks: number;
  tokens: number;
}

export interface QuotaStore {
  /** Today's usage per agent. */
  today(): Promise<Record<OfficeAgentId, DayUsage>>;
  /** Why the agent may not start another task today, or `undefined` when it may. */
  check(agentId: OfficeAgentId, quota: AgentConfig["quota"]): Promise<string | undefined>;
  /** Counts a started task (a task counts when it starts, so a stopped or failed one still used the day's allowance). */
  start(agentId: OfficeAgentId): Promise<void>;
  addTokens(agentId: OfficeAgentId, tokens: number): Promise<void>;
}

export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const empty = () => Object.fromEntries(OFFICE_AGENT_IDS.map((id) => [id, { tasks: 0, tokens: 0 }])) as Record<OfficeAgentId, DayUsage>;

export function fileQuotaStore(file: string, now: () => Date = () => new Date()): QuotaStore {
  async function load(): Promise<{ day: string; usage: Record<OfficeAgentId, DayUsage> }> {
    const day = localDay(now());
    const usage = empty();
    try {
      const saved = JSON.parse(await readFile(file, "utf8")) as { day?: string; usage?: Record<string, Partial<DayUsage>> };
      if (saved.day === day && saved.usage) {
        for (const id of OFFICE_AGENT_IDS) {
          const u = saved.usage[id];
          if (u) usage[id] = { tasks: Math.max(0, Number(u.tasks) || 0), tokens: Math.max(0, Number(u.tokens) || 0) };
        }
      }
    } catch {
      // first run or unreadable file: zero
    }
    return { day, usage };
  }
  let queue: Promise<unknown> = Promise.resolve();
  const mutate = (change: (u: Record<OfficeAgentId, DayUsage>) => void): Promise<void> => {
    const job = queue.then(async () => {
      const { day, usage } = await load();
      change(usage);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify({ day, usage }, null, 2));
      await rename(`${file}.tmp`, file);
    });
    queue = job.catch(() => undefined);
    return job;
  };
  return {
    async today() {
      return (await load()).usage;
    },
    async check(agentId, quota) {
      const u = (await load()).usage[agentId];
      if (quota.maxTasksPerDay > 0 && u.tasks >= quota.maxTasksPerDay) return `Daily task limit reached (${u.tasks} of ${quota.maxTasksPerDay}). Raise it in the agent settings or wait for tomorrow.`;
      if (quota.maxTokensPerDay > 0 && u.tokens >= quota.maxTokensPerDay) return `Daily token limit reached (${u.tokens} of ${quota.maxTokensPerDay}). Raise it in the agent settings or wait for tomorrow.`;
      return undefined;
    },
    start: (agentId) => mutate((u) => void (u[agentId].tasks += 1)),
    addTokens: (agentId, tokens) => mutate((u) => void (u[agentId].tokens += Math.max(0, Math.round(tokens)))),
  };
}
