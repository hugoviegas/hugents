import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { OFFICE_AGENT_IDS, type OfficeAgentId } from "./contract.js";

/**
 * Reports index for the office. Reports are the Markdown files in `artifacts/reports/`; the task that made one is kept in a
 * small `<name>.meta.json` beside it. Older reports without that file still list (agent and date come from the file name,
 * severity from the text), they just have no task attached.
 */

export const REPORT_SEVERITIES = ["none", "low", "medium", "high"] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];

export interface ReportMeta {
  taskId?: string;
  taskTitle?: string;
  objective?: string;
  runId?: string;
  /** The user stopped the task: the report is partial. */
  interrupted?: boolean;
}

export interface ReportEntry extends ReportMeta {
  /** File name inside `reports/`, e.g. `explorer-2026-10-07T12-00-00-000Z.md`. */
  file: string;
  agentId: OfficeAgentId;
  /** ISO time from the file name. */
  at: string;
  /** `YYYY-MM-DD`, UTC, taken from `at`. */
  day: string;
  title: string;
  severity: ReportSeverity;
  findings: number;
}

export interface ReportFilter {
  agent?: string;
  severity?: string;
  /** Matches the task id or part of the task title. */
  task?: string;
  /** Inclusive `YYYY-MM-DD` bounds. */
  from?: string;
  to?: string;
}

export const REPORT_FILE = /^(.+?)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-\d+)?\.md$/;
const FINDING_LINE = /^\s*-\s*\[(low|medium|high)\]/gim;
const RANK: Record<ReportSeverity, number> = { none: 0, low: 1, medium: 2, high: 3 };
const MAX_REPORT_BYTES = 120_000;

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v ? v.slice(0, max) : undefined);

export function severityOf(markdown: string): { severity: ReportSeverity; findings: number } {
  let severity: ReportSeverity = "none";
  let findings = 0;
  for (const m of markdown.matchAll(FINDING_LINE)) {
    findings += 1;
    const s = (m[1] ?? "").toLowerCase() as ReportSeverity;
    if (RANK[s] > RANK[severity]) severity = s;
  }
  return { severity, findings };
}

export function parseMeta(raw: string): ReportMeta {
  try {
    const m = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...(str(m.taskId, 64) ? { taskId: str(m.taskId, 64) } : {}),
      ...(str(m.taskTitle, 200) ? { taskTitle: str(m.taskTitle, 200) } : {}),
      ...(str(m.objective, 300) ? { objective: str(m.objective, 300) } : {}),
      ...(str(m.runId, 80) ? { runId: str(m.runId, 80) } : {}),
      ...(m.interrupted === true ? { interrupted: true } : {}),
    };
  } catch {
    return {};
  }
}

function describe(file: string, markdown: string, meta: ReportMeta): ReportEntry | undefined {
  const name = REPORT_FILE.exec(file);
  if (!name || !(OFFICE_AGENT_IDS as readonly string[]).includes(name[1] as string)) return undefined;
  const [, agent, day, hh, mm, ss, ms] = name;
  const heading = /^#{1,3}\s+(.+)$/m.exec(markdown)?.[1]?.trim().slice(0, 120);
  return {
    file,
    agentId: agent as OfficeAgentId,
    at: `${day}T${hh}:${mm}:${ss}.${ms}Z`,
    day: day as string,
    title: heading ?? file,
    ...severityOf(markdown),
    ...meta,
  };
}

export function matches(entry: ReportEntry, f: ReportFilter): boolean {
  if (f.agent && entry.agentId !== f.agent) return false;
  if (f.severity && entry.severity !== f.severity) return false;
  if (f.from && entry.day < f.from) return false;
  if (f.to && entry.day > f.to) return false;
  if (f.task) {
    const q = f.task.toLowerCase();
    if (!(entry.taskId ?? "").toLowerCase().includes(q) && !(entry.taskTitle ?? "").toLowerCase().includes(q)) return false;
  }
  return true;
}

/** Newest first. Unreadable files are skipped; a missing folder means no reports. */
export async function listReports(artifactsDir: string, filter: ReportFilter = {}): Promise<ReportEntry[]> {
  const dir = path.join(artifactsDir, "reports");
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => REPORT_FILE.test(n));
  } catch {
    return [];
  }
  const out: ReportEntry[] = [];
  for (const file of names) {
    try {
      const markdown = await readFile(path.join(dir, file), "utf8");
      const meta = parseMeta(await readFile(path.join(dir, file.replace(/\.md$/, ".meta.json")), "utf8").catch(() => "{}"));
      const entry = describe(file, markdown, meta);
      if (entry && matches(entry, filter)) out.push(entry);
    } catch {
      // unreadable: skipped
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.file < b.file ? 1 : -1));
}

/** One report's text. Only a name that matches the report pattern is ever opened. */
export async function readReport(artifactsDir: string, file: string): Promise<string | undefined> {
  if (!REPORT_FILE.test(file) || file !== path.basename(file)) return undefined;
  try {
    return (await readFile(path.join(artifactsDir, "reports", file), "utf8")).slice(0, MAX_REPORT_BYTES);
  } catch {
    return undefined;
  }
}
