import { lstat, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRun, findRepeated, type AnalyzeOptions } from "./analyze.js";
import type { ObserverConfig } from "./config.js";
import { approvedScreenshots, isForbiddenArtifact, readRunInputs, RUN_NAME, SAFE_INPUTS, type ApprovedScreenshot } from "./inputs.js";
import {
  FINDINGS_KIND,
  FINDINGS_SCHEMA_VERSION,
  isObserverFile,
  type FindingsReport,
  type RunReport,
} from "./schema.js";

export class ObserverInputError extends Error {}

export interface ScannedRun {
  report: RunReport;
  root: string;
  screenshots: ApprovedScreenshot[];
  /** Latest runner/player event per agent label (sanitized by the caller before display). */
  latest: { agent: string; status: string; activity: string; at: string }[];
}

const options = (config: ObserverConfig, now: Date): AnalyzeOptions => ({
  ignoreNetworkFailures: config.ignoreNetworkFailures,
  activeWindowMs: config.activeWindowMs,
  now,
});

export async function scanRunDir(runRoot: string, config: ObserverConfig, now: Date): Promise<ScannedRun> {
  const runId = path.basename(runRoot);
  if (!RUN_NAME.test(runId) || isForbiddenArtifact(runId)) throw new ObserverInputError("Not a run directory name");
  const info = await lstat(runRoot).catch(() => undefined);
  if (!info?.isDirectory()) throw new ObserverInputError("Run directory not found");
  const inputs = await readRunInputs(runRoot, runId);
  const latest = new Map<string, ScannedRun["latest"][number]>();
  for (const e of inputs.events) latest.set(e.agent, { agent: e.agent, status: e.status, activity: e.activity, at: e.at });
  return {
    report: analyzeRun(inputs, options(config, now)),
    root: runRoot,
    screenshots: await approvedScreenshots(runRoot, inputs, config.screenshotLimit),
    latest: [...latest.values()],
  };
}

/** Scans every `<artifactsDir>/runs/<run>` directory. Symlinks and odd names are skipped. */
export async function scanArtifactRoot(config: ObserverConfig, now: Date): Promise<ScannedRun[]> {
  const runsDir = path.join(config.artifactsDir, "runs");
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  const names = entries
    .filter((e) => e.isDirectory() && RUN_NAME.test(e.name))
    .map((e) => e.name)
    .sort();
  return Promise.all(names.map((name) => scanRunDir(path.join(runsDir, name), config, now)));
}

const count = (target: Record<string, number>, key: string, by = 1) => {
  target[key] = (target[key] ?? 0) + by;
};

/** Pure: same runs and clock in, same report out. Keys are inserted in sorted order. */
export function buildReport(runs: readonly RunReport[], scope: "run" | "root", config: ObserverConfig, now: Date): FindingsReport {
  const sorted = [...runs].sort((a, b) => a.runId.localeCompare(b.runId));
  const byStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let findings = 0;
  let ignored = 0;
  for (const run of sorted) {
    count(byStatus, run.status);
    ignored += run.ignored.networkFailures;
    for (const f of run.findings) {
      findings += 1;
      count(bySeverity, f.severity);
      count(byCategory, f.category);
    }
  }
  const ordered = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
  return {
    kind: FINDINGS_KIND,
    schemaVersion: FINDINGS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    scope,
    options: { reportAborted: config.reportAborted },
    totals: {
      runs: sorted.length,
      findings,
      byStatus: ordered(byStatus),
      bySeverity: ordered(bySeverity),
      byCategory: ordered(byCategory),
      ignoredNetworkFailures: ignored,
    },
    runs: sorted,
    repeated: findRepeated(sorted),
  };
}

/** Resolves where findings.json goes and refuses names that could clobber inputs or foreign files. */
export async function resolveFindingsFile(target: string): Promise<string> {
  const base = path.basename(target);
  if ((SAFE_INPUTS as readonly string[]).includes(base) || isForbiddenArtifact(base) || !base.toLowerCase().endsWith(".json")) {
    throw new ObserverInputError("Refusing to write findings to that file name");
  }
  const existing = await readFile(target, "utf8").catch(() => undefined);
  if (existing !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch {
      parsed = undefined;
    }
    if (!isObserverFile(parsed)) throw new ObserverInputError("Refusing to overwrite a file that is not an observer findings file");
  }
  return target;
}

export async function writeFindings(target: string, report: FindingsReport): Promise<void> {
  await resolveFindingsFile(target);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify(report, null, 2)}\n`);
  await rename(tmp, target);
}

export interface ObserveResult {
  report: FindingsReport;
  /** Where the report was (or, in dry-run, would have been) written. */
  target: string;
  written: boolean;
}

/** One run (`runDir` given) or the whole artifact root. `dryRun` computes everything and writes nothing. */
export async function observe(
  config: ObserverConfig,
  opts: { runDir?: string; dryRun?: boolean; now?: Date },
): Promise<ObserveResult> {
  const now = opts.now ?? new Date();
  // A bare run name is looked up under `<artifactsDir>/runs`; anything else is used as a path.
  const runDir = opts.runDir
    ? /[\\/]/.test(opts.runDir)
      ? path.resolve(opts.runDir)
      : path.join(config.artifactsDir, "runs", opts.runDir)
    : undefined;
  const scanned = runDir ? [await scanRunDir(runDir, config, now)] : await scanArtifactRoot(config, now);
  const report = buildReport(
    scanned.map((s) => s.report),
    runDir ? "run" : "root",
    config,
    now,
  );
  const target = config.findingsFile ?? path.join(runDir ?? config.artifactsDir, "findings.json");
  await resolveFindingsFile(target);
  if (opts.dryRun) return { report, target, written: false };
  await writeFindings(target, report);
  return { report, target, written: true };
}

/** One safe line: aggregate counts only, no run names, paths or messages. */
export function formatSummary(result: ObserveResult): string {
  const { totals } = result.report;
  const part = (r: Record<string, number>) =>
    Object.entries(r)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ") || "none";
  return [
    `runs: ${totals.runs} (${part(totals.byStatus)})`,
    `findings: ${totals.findings} | severity: ${part(totals.bySeverity)}`,
    `categories: ${part(totals.byCategory)}`,
    `repeated: ${result.report.repeated.length} | ignored network failures: ${totals.ignoredNetworkFailures}`,
    result.written ? "findings.json written" : "dry run: nothing written",
  ].join("\n");
}
