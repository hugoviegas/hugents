import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface CleanupConfig {
  maxBytes: number;
  keepRecent: number;
  keepFailure: number;
}

export const CLEANUP_DEFAULTS: CleanupConfig = {
  maxBytes: 2_147_483_648,
  keepRecent: 20,
  keepFailure: 10,
};

/** Runs without a summary newer than this are treated as still running. */
export const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

const RUN_NAME = /^\d{4}-\d{2}-\d{2}T[0-9-]+Z-[a-z0-9-]+$/;
const HEAVY_PATHS = ["alpha/trace.zip", "bravo/trace.zip", "alpha/video", "bravo/video"];

export class CleanupConfigError extends Error {}

export function parseCleanupConfig(env: Record<string, string | undefined>): CleanupConfig {
  const problems: string[] = [];
  const read = (name: string, fallback: number): number => {
    const raw = (env[name] ?? "").trim();
    if (raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 0) {
      problems.push(`${name} must be a non-negative integer`);
      return fallback;
    }
    return n;
  };
  const config = {
    maxBytes: read("QA_ARTIFACT_MAX_BYTES", CLEANUP_DEFAULTS.maxBytes),
    keepRecent: read("QA_ARTIFACT_KEEP_RECENT_RUNS", CLEANUP_DEFAULTS.keepRecent),
    keepFailure: read("QA_ARTIFACT_KEEP_FAILURE_RUNS", CLEANUP_DEFAULTS.keepFailure),
  };
  if (problems.length) throw new CleanupConfigError(`Invalid cleanup configuration: ${problems.join("; ")}`);
  return config;
}

export type RunStatus = "completed" | "blocked" | "failed" | "unknown";

export interface RunEntry {
  /** Directory name. Used only to act on the run; it is never printed. */
  name: string;
  bytes: number;
  /** Bytes held by traces and videos. */
  heavyBytes: number;
  status: RunStatus;
  active: boolean;
}

export interface CleanupPlan {
  stripHeavy: string[];
  deleteRuns: string[];
  totalBefore: number;
  totalAfter: number;
  /** True when protected runs alone still exceed the budget. */
  overBudget: boolean;
}

/**
 * Order (only when the total is above `maxBytes`, stopping as soon as it fits):
 *   1. delete traces and videos, oldest runs first, from runs outside the newest
 *      `keepRecent` (failed/blocked runs keep their summary and screenshots);
 *   2. delete whole run directories, oldest first: successful runs first, then other
 *      runs beyond the protected sets.
 * Never touched: the newest `keepRecent` runs, the newest `keepFailure` failed/blocked
 * runs (directories), and any active run.
 */
export function planCleanup(runs: readonly RunEntry[], config: CleanupConfig): CleanupPlan {
  const newestFirst = [...runs].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const oldestFirst = [...newestFirst].reverse();

  const recent = new Set(newestFirst.slice(0, config.keepRecent).map((r) => r.name));
  const failures = new Set(
    newestFirst
      .filter((r) => r.status !== "completed" && !r.active)
      .slice(0, config.keepFailure)
      .map((r) => r.name),
  );
  const isProtected = (r: RunEntry) => r.active || recent.has(r.name) || failures.has(r.name);

  const totalBefore = runs.reduce((sum, r) => sum + r.bytes, 0);
  let total = totalBefore;
  const stripped = new Map<string, number>();
  const stripHeavy: string[] = [];
  const deleteRuns: string[] = [];

  for (const run of oldestFirst) {
    if (total <= config.maxBytes) break;
    if (run.active || recent.has(run.name) || run.heavyBytes <= 0) continue;
    stripped.set(run.name, run.heavyBytes);
    stripHeavy.push(run.name);
    total -= run.heavyBytes;
  }

  const remaining = (r: RunEntry) => r.bytes - (stripped.get(r.name) ?? 0);
  const deletable = oldestFirst.filter((r) => !isProtected(r));
  for (const group of [deletable.filter((r) => r.status === "completed"), deletable.filter((r) => r.status !== "completed")]) {
    for (const run of group) {
      if (total <= config.maxBytes) break;
      deleteRuns.push(run.name);
      total -= remaining(run);
    }
  }

  const deleted = new Set(deleteRuns);
  return {
    // A deleted run needs no separate strip.
    stripHeavy: stripHeavy.filter((n) => !deleted.has(n)),
    deleteRuns,
    totalBefore,
    totalAfter: total,
    overBudget: total > config.maxBytes,
  };
}

async function sizeOf(target: string): Promise<number> {
  const info = await stat(target).catch(() => null);
  if (!info) return 0;
  if (!info.isDirectory()) return info.size;
  let sum = 0;
  for (const entry of await readdir(target)) sum += await sizeOf(path.join(target, entry));
  return sum;
}

/** Reads sizes, status and activity of every run directory. File contents other than summary.json are never read. */
export async function scanRuns(artifactsDir: string, now: number = Date.now()): Promise<RunEntry[]> {
  const runsDir = path.join(artifactsDir, "runs");
  const names = (await readdir(runsDir).catch(() => [] as string[])).filter((n) => RUN_NAME.test(n));
  const entries: RunEntry[] = [];
  for (const name of names) {
    const root = path.join(runsDir, name);
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) continue;

    let status: RunStatus = "unknown";
    let hasSummary = false;
    try {
      const summary = JSON.parse(await readFile(path.join(root, "summary.json"), "utf8")) as { status?: string };
      hasSummary = true;
      if (summary.status === "completed" || summary.status === "blocked" || summary.status === "failed") {
        status = summary.status;
      }
    } catch {
      // No (or unreadable) summary: still running, or crashed.
    }
    const events = await stat(path.join(root, "events.jsonl")).catch(() => null);
    const lastActivity = Math.max(info.mtimeMs, events?.mtimeMs ?? 0);
    const active = !hasSummary && now - lastActivity < ACTIVE_WINDOW_MS;

    let heavyBytes = 0;
    for (const rel of HEAVY_PATHS) heavyBytes += await sizeOf(path.join(root, rel));
    entries.push({ name, bytes: await sizeOf(root), heavyBytes, status, active });
  }
  return entries;
}

export interface CleanupResult {
  runs: number;
  strippedRuns: number;
  deletedRuns: number;
  bytesBefore: number;
  bytesAfter: number;
  maxBytes: number;
  overBudget: boolean;
  dryRun: boolean;
}

export async function applyCleanup(
  artifactsDir: string,
  plan: CleanupPlan,
  runsCount: number,
  config: CleanupConfig,
  dryRun: boolean,
): Promise<CleanupResult> {
  const runsDir = path.join(artifactsDir, "runs");
  const safe = (name: string) => RUN_NAME.test(name) && path.dirname(path.join(runsDir, name)) === runsDir;
  if (!dryRun) {
    for (const name of plan.stripHeavy.filter(safe)) {
      for (const rel of HEAVY_PATHS) await rm(path.join(runsDir, name, rel), { recursive: true, force: true });
    }
    for (const name of plan.deleteRuns.filter(safe)) {
      await rm(path.join(runsDir, name), { recursive: true, force: true });
    }
  }
  return {
    runs: runsCount,
    strippedRuns: plan.stripHeavy.length,
    deletedRuns: plan.deleteRuns.length,
    bytesBefore: plan.totalBefore,
    bytesAfter: plan.totalAfter,
    maxBytes: config.maxBytes,
    overBudget: plan.overBudget,
    dryRun,
  };
}

/** Counts and byte totals only: no run names that could reveal a URL, code, e-mail or secret. */
export function formatCleanupResult(r: CleanupResult): string {
  const mode = r.dryRun ? "Dry run: nothing deleted. " : "";
  return [
    `${mode}Runs scanned: ${r.runs}.`,
    `Runs with traces/videos removed: ${r.strippedRuns}. Runs deleted: ${r.deletedRuns}.`,
    `Bytes before: ${r.bytesBefore}. Bytes after: ${r.bytesAfter}. Limit: ${r.maxBytes}.`,
    r.overBudget ? "Still above the limit: only protected runs remain." : "Within the limit.",
  ].join("\n");
}
