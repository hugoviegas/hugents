import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface BudgetLimits {
  /** Requests per analysed run id, across all models. */
  perRun: number;
  /** Requests per model per day. Another model has its own count, so alternatives stretch the daily quota. */
  perDayPerModel: number;
}

export type Reservation = "ok" | "budget-run" | "budget-daily";

export interface Budget {
  /** Counts one outgoing request. Retries count too. Nothing is sent when this is not `ok`. */
  reserve(runKey: string, model: string): Promise<Reservation>;
}

interface Usage {
  day: string;
  models: Record<string, number>;
  runs: Record<string, number>;
}

const MAX_RUN_KEYS = 200;

/** Google resets daily request quotas at midnight Pacific time; the local counter rolls over at the same moment. */
export function quotaDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
}

/**
 * Local request counters in one JSON file (counts only: model names, run ids and numbers, never prompts or
 * responses). The limits are our own guard rail; the provider's real quota is separate and may be lower.
 */
export async function openBudget(file: string, limits: BudgetLimits, now: () => Date = () => new Date()): Promise<Budget> {
  let usage: Usage = { day: quotaDay(now()), models: {}, runs: {} };
  try {
    const saved = JSON.parse(await readFile(file, "utf8")) as Partial<Usage>;
    if (saved.day === usage.day && saved.models && saved.runs) usage = { day: saved.day, models: saved.models, runs: saved.runs };
    else if (saved.runs) usage.runs = saved.runs; // a new day clears the daily counts, per-run counts stay
  } catch {
    // first run or unreadable file: start from zero
  }

  let queue: Promise<unknown> = Promise.resolve();
  return {
    reserve(runKey, model) {
      const job = queue.then(async (): Promise<Reservation> => {
        const today = quotaDay(now());
        if (usage.day !== today) usage = { day: today, models: {}, runs: usage.runs };
        if ((usage.runs[runKey] ?? 0) >= limits.perRun) return "budget-run";
        if ((usage.models[model] ?? 0) >= limits.perDayPerModel) return "budget-daily";
        usage.models[model] = (usage.models[model] ?? 0) + 1;
        usage.runs[runKey] = (usage.runs[runKey] ?? 0) + 1;
        const keys = Object.keys(usage.runs);
        for (const old of keys.slice(0, Math.max(0, keys.length - MAX_RUN_KEYS))) delete usage.runs[old];
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, `${JSON.stringify(usage, null, 2)}\n`);
        return "ok";
      });
      queue = job.catch(() => undefined);
      return job;
    },
  };
}
