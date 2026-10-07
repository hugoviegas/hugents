/** Versioned shape of the local `findings.json` written by the QA observer (issue #96). */
export const FINDINGS_KIND = "duel-agent-office/findings";
export const FINDINGS_SCHEMA_VERSION = 1;

export const SEVERITIES = ["low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = [
  "console-error",
  "page-error",
  "http-4xx",
  "http-5xx",
  "network-failure",
  "timeout",
  "run-blocked",
  "run-failed",
  "interaction",
  "completed-with-errors",
  "input",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** `status` of a run as the observer reports it. `active` = no summary yet and recent activity. */
export const RUN_STATUSES = ["active", "completed", "blocked", "failed"] as const;
export type ObservedStatus = (typeof RUN_STATUSES)[number];

export const PLAYER_LABELS = ["alpha", "bravo", "runner", "unknown"] as const;
export type PlayerLabel = (typeof PLAYER_LABELS)[number];

/** Pointer into a local, approved artifact. Relative name only, never an absolute path. */
export interface EvidenceRef {
  file: string;
  line?: number;
}

export interface Finding {
  id: string;
  /** Run-independent identity used to find the same observation in other runs. */
  fingerprint: string;
  ruleId: string;
  category: Category;
  severity: Severity;
  runId: string;
  player: PlayerLabel;
  count: number;
  firstAt?: string;
  lastAt?: string;
  /** Redacted and sanitized (no URLs, e-mails, tokens). */
  message: string;
  evidence: EvidenceRef[];
}

export interface InputIssues {
  malformedSummary: boolean;
  malformedLines: number;
  invalidRecords: number;
  oversizedFiles: number;
}

export interface RunReport {
  runId: string;
  scenario?: string;
  status: ObservedStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  /** Match outcome and turn counts from the runner's summary (fixed vocabulary, optional). */
  result?: { outcome: { alpha: string; bravo: string }; turns: { alpha: number; bravo: number } };
  findings: Finding[];
  /** Aggregate counts of events dropped by ignore rules. */
  ignored: { networkFailures: number };
  inputIssues: InputIssues;
}

export interface RepeatedFinding {
  fingerprint: string;
  ruleId: string;
  category: Category;
  severity: Severity;
  message: string;
  runs: number;
  occurrences: number;
  firstAt?: string;
  lastAt?: string;
  runIds: string[];
}

export interface FindingsReport {
  kind: typeof FINDINGS_KIND;
  schemaVersion: number;
  generatedAt: string;
  scope: "run" | "root";
  options: { reportAborted: boolean };
  totals: {
    runs: number;
    findings: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
    ignoredNetworkFailures: number;
  };
  runs: RunReport[];
  repeated: RepeatedFinding[];
}

export type ParseResult = { ok: true; report: FindingsReport } | { ok: false; error: "invalid" | "unsupported-version" };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);
const optStr = (v: unknown) => v === undefined || typeof v === "string";

function validFinding(f: unknown): boolean {
  if (!isObj(f)) return false;
  return (
    typeof f.id === "string" &&
    typeof f.fingerprint === "string" &&
    typeof f.ruleId === "string" &&
    oneOf(CATEGORIES, f.category) &&
    oneOf(SEVERITIES, f.severity) &&
    typeof f.runId === "string" &&
    oneOf(PLAYER_LABELS, f.player) &&
    Number.isInteger(f.count) &&
    (f.count as number) >= 1 &&
    optStr(f.firstAt) &&
    optStr(f.lastAt) &&
    typeof f.message === "string" &&
    Array.isArray(f.evidence) &&
    f.evidence.every((e) => isObj(e) && typeof e.file === "string" && (e.line === undefined || Number.isInteger(e.line)))
  );
}

function validRun(r: unknown): boolean {
  if (!isObj(r)) return false;
  return (
    typeof r.runId === "string" &&
    oneOf(RUN_STATUSES, r.status) &&
    optStr(r.scenario) &&
    optStr(r.startedAt) &&
    optStr(r.finishedAt) &&
    (r.result === undefined ||
      (isObj(r.result) &&
        isObj(r.result.outcome) &&
        typeof r.result.outcome.alpha === "string" &&
        typeof r.result.outcome.bravo === "string" &&
        isObj(r.result.turns) &&
        Number.isInteger(r.result.turns.alpha) &&
        Number.isInteger(r.result.turns.bravo))) &&
    Array.isArray(r.findings) &&
    r.findings.every(validFinding) &&
    isObj(r.ignored) &&
    isObj(r.inputIssues)
  );
}

/**
 * Validates a parsed `findings.json`. A newer `schemaVersion` is rejected rather than
 * half-understood; older versions do not exist yet.
 */
export function parseFindingsReport(value: unknown): ParseResult {
  if (!isObj(value) || value.kind !== FINDINGS_KIND || !Number.isInteger(value.schemaVersion)) {
    return { ok: false, error: "invalid" };
  }
  if ((value.schemaVersion as number) > FINDINGS_SCHEMA_VERSION) return { ok: false, error: "unsupported-version" };
  if ((value.schemaVersion as number) < 1) return { ok: false, error: "invalid" };
  const ok =
    typeof value.generatedAt === "string" &&
    (value.scope === "run" || value.scope === "root") &&
    isObj(value.options) &&
    isObj(value.totals) &&
    Array.isArray(value.runs) &&
    value.runs.every(validRun) &&
    Array.isArray(value.repeated) &&
    value.repeated.every(
      (r) => isObj(r) && typeof r.fingerprint === "string" && Number.isInteger(r.runs) && Array.isArray(r.runIds),
    );
  return ok ? { ok: true, report: value as unknown as FindingsReport } : { ok: false, error: "invalid" };
}

/** True when `value` is a findings file of ours at any version (used by the overwrite guard). */
export function isObserverFile(value: unknown): boolean {
  return isObj(value) && value.kind === FINDINGS_KIND;
}
