import { createHash } from "node:crypto";
import type { AgentName } from "../orchestrator/eventBus.js";
import type { RunInputs } from "./inputs.js";
import { normalizeForFingerprint, safeUrlLabel, sanitizeText } from "./sanitize.js";
import {
  type Category,
  type EvidenceRef,
  type Finding,
  type ObservedStatus,
  type PlayerLabel,
  type RepeatedFinding,
  type RunReport,
  type Severity,
} from "./schema.js";

export interface AnalyzeOptions {
  /** Case-insensitive substrings of a `request-failed` error text that are counted, not reported. */
  ignoreNetworkFailures: readonly string[];
  /** Runs without a summary and without events newer than this are reported as failed. */
  activeWindowMs: number;
  now: Date;
}

export const DEFAULT_IGNORED_NETWORK = ["net::ERR_ABORTED"] as const;

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };
const MAX_EVIDENCE = 5;
/** The one page error Hugo observed once (issue #96). Matched only in approved redacted text. */
const HE_NOT_A_FUNCTION = /\bhe is not a function\b/i;

export const playerLabel = (agent?: AgentName): PlayerLabel =>
  agent === "player-alpha" ? "alpha" : agent === "player-bravo" ? "bravo" : agent === "runner" ? "runner" : "unknown";

const hash = (...parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 12);
const minAt = (a: string | undefined, b: string | undefined) => (a && b ? (a < b ? a : b) : (a ?? b));
const maxAt = (a: string | undefined, b: string | undefined) => (a && b ? (a > b ? a : b) : (a ?? b));

interface Draft {
  ruleId: string;
  category: Category;
  severity: Severity;
  player: PlayerLabel;
  message: string;
  at?: string;
  evidence: EvidenceRef;
}

/** Collapses equivalent drafts of one run (same rule, player and normalized message) into counted findings. */
function aggregate(runId: string, drafts: Draft[]): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const d of drafts) {
    const fingerprint = hash(d.ruleId, normalizeForFingerprint(d.message));
    const key = `${fingerprint}|${d.player}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.firstAt = minAt(existing.firstAt, d.at);
      existing.lastAt = maxAt(existing.lastAt, d.at);
      if (existing.evidence.length < MAX_EVIDENCE) existing.evidence.push(d.evidence);
      continue;
    }
    byKey.set(key, {
      id: hash(runId, key),
      fingerprint,
      ruleId: d.ruleId,
      category: d.category,
      severity: d.severity,
      runId,
      player: d.player,
      count: 1,
      ...(d.at ? { firstAt: d.at, lastAt: d.at } : {}),
      message: d.message,
      evidence: [d.evidence],
    });
  }
  return [...byKey.values()].sort(compareFindings);
}

function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.fingerprint.localeCompare(b.fingerprint) ||
    a.player.localeCompare(b.player)
  );
}

/** Observed status: summary first, then a terminal runner event, then active-or-crashed by recency. */
function observedStatus(inputs: RunInputs, opts: AnalyzeOptions): { status: ObservedStatus; crashed: boolean } {
  if (inputs.summary) return { status: inputs.summary.status, crashed: false };
  const lastRunner = [...inputs.events].reverse().find((e) => e.agent === "runner");
  if (lastRunner && (lastRunner.status === "completed" || lastRunner.status === "failed" || lastRunner.status === "blocked")) {
    return { status: lastRunner.status, crashed: false };
  }
  const lastAt = inputs.events.reduce<string | undefined>((acc, e) => maxAt(acc, e.at), undefined);
  const lastMs = lastAt ? Date.parse(lastAt) : Number.NaN;
  const recent = Number.isFinite(lastMs) && opts.now.getTime() - lastMs <= opts.activeWindowMs;
  return recent ? { status: "active", crashed: false } : { status: "failed", crashed: true };
}

const TIMEOUT = /\btime(?:d)? ?out\b/i;

export function analyzeRun(inputs: RunInputs, opts: AnalyzeOptions): RunReport {
  const { runId, summary } = inputs;
  const drafts: Draft[] = [];
  const { status, crashed } = observedStatus(inputs, opts);
  const ignoreList = opts.ignoreNetworkFailures.map((s) => s.toLowerCase());
  let ignoredNetwork = 0;

  // --- console / page errors ---
  for (const record of inputs.console) {
    const text = sanitizeText(record.text);
    const known = HE_NOT_A_FUNCTION.test(text);
    const page = record.kind === "page-error";
    drafts.push({
      ruleId: known ? "known-he-not-a-function" : page ? "page-error" : "console-error",
      category: page ? "page-error" : "console-error",
      severity: known || page ? "high" : "medium",
      player: playerLabel(record.agent),
      message: text || "(empty message)",
      at: record.at,
      evidence: { file: "console.jsonl", line: record.line },
    });
  }

  // --- network ---
  for (const record of inputs.network) {
    const player = playerLabel(record.agent);
    const target = `${record.method ?? "?"} ${record.url ? safeUrlLabel(record.url) : "unknown"}`;
    const evidence = { file: "network-failures.jsonl", line: record.line };
    if (record.kind === "http-error") {
      const code = record.status as number;
      const server = code >= 500;
      // 401/403 are authentication/authorization problems: never downgraded.
      drafts.push({
        ruleId: server ? "http-5xx" : code === 401 || code === 403 ? "http-auth" : "http-4xx",
        category: server ? "http-5xx" : "http-4xx",
        severity: server || code === 401 || code === 403 ? "high" : "medium",
        player,
        message: `${code} ${target}`,
        at: record.at,
        evidence,
      });
      continue;
    }
    const failure = sanitizeText(record.failure ?? "unknown", 120);
    if (ignoreList.some((pattern) => failure.toLowerCase().includes(pattern))) {
      ignoredNetwork += 1;
      continue;
    }
    drafts.push({
      ruleId: "network-failure",
      category: "network-failure",
      severity: "medium",
      player,
      message: `${failure} ${target}`,
      at: record.at,
      evidence,
    });
  }

  const signalCount = drafts.length;

  // --- run-level rules (summary) ---
  const reason = summary?.reason ? sanitizeText(summary.reason) : undefined;
  const at = summary?.finishedAt;
  const summaryRef: EvidenceRef = { file: "summary.json" };
  const interaction = summary?.failure;
  if (interaction) {
    drafts.push({
      ruleId: `interaction-${interaction.category}`,
      category: interaction.category === "turn-state-timeout" ? "timeout" : "interaction",
      severity: "high",
      player: playerLabel(interaction.agent),
      message: `Battle interaction failed: ${interaction.category}`,
      at,
      evidence: summaryRef,
    });
  }
  const timedOut = status === "failed" && !interaction && reason !== undefined && TIMEOUT.test(reason);
  if (timedOut) {
    drafts.push({ ruleId: "run-timeout", category: "timeout", severity: "high", player: "runner", message: reason, at, evidence: summaryRef });
  }
  if (status === "blocked") {
    const kind = summary?.blockedOn ? sanitizeText(summary.blockedOn, 40) : "unknown";
    drafts.push({
      ruleId: "run-blocked",
      category: "run-blocked",
      severity: "medium",
      player: "runner",
      message: `Run blocked (${kind})${reason ? `: ${reason}` : ""}`,
      at,
      evidence: summaryRef,
    });
  }
  if (status === "failed" && !interaction && !timedOut) {
    drafts.push({
      ruleId: crashed ? "run-incomplete" : "run-failed",
      category: "run-failed",
      severity: "high",
      player: "runner",
      message: crashed ? "Run has no summary and no recent activity" : `Run failed${reason ? `: ${reason}` : ""}`,
      at,
      evidence: crashed ? { file: "events.jsonl" } : summaryRef,
    });
  }
  if (status === "completed" && signalCount > 0) {
    drafts.push({
      ruleId: "completed-with-error-signals",
      category: "completed-with-errors",
      severity: "medium",
      player: "runner",
      message: `Run completed but recorded error signals (${signalCount})`,
      at,
      evidence: summaryRef,
    });
  }

  // --- unreadable inputs ---
  const issueCount =
    Number(inputs.issues.malformedSummary) + inputs.issues.malformedLines + inputs.issues.invalidRecords + inputs.issues.oversizedFiles;
  if (issueCount > 0) {
    drafts.push({
      ruleId: "input-unreadable",
      category: "input",
      severity: "low",
      player: "runner",
      message: "Some run artifacts were malformed, invalid or too large and were skipped",
      evidence: { file: inputs.issues.malformedSummary ? "summary.json" : "events.jsonl" },
    });
  }

  const findings = aggregate(runId, drafts);
  // The unreadable-inputs finding counts skipped records, not occurrences of one message.
  const unreadable = findings.find((f) => f.ruleId === "input-unreadable");
  if (unreadable) unreadable.count = issueCount;
  return {
    runId,
    ...(summary?.scenario ? { scenario: sanitizeText(summary.scenario, 60) } : {}),
    status,
    ...(summary?.startedAt ? { startedAt: summary.startedAt } : {}),
    ...(summary?.finishedAt ? { finishedAt: summary.finishedAt } : {}),
    ...(summary?.durationMs !== undefined ? { durationMs: summary.durationMs } : {}),
    ...(summary?.result ? { result: summary.result } : {}),
    findings,
    ignored: { networkFailures: ignoredNetwork },
    inputIssues: inputs.issues,
  };
}

/**
 * Same fingerprint seen in two or more runs. Run-level status findings (failed, blocked,
 * completed-with-errors) repeat too: "this run kind keeps failing" is worth showing.
 */
export function findRepeated(runs: readonly RunReport[]): RepeatedFinding[] {
  const groups = new Map<string, RepeatedFinding>();
  for (const run of runs) {
    for (const f of run.findings) {
      const g = groups.get(f.fingerprint);
      if (!g) {
        groups.set(f.fingerprint, {
          fingerprint: f.fingerprint,
          ruleId: f.ruleId,
          category: f.category,
          severity: f.severity,
          message: f.message,
          runs: 1,
          occurrences: f.count,
          firstAt: f.firstAt,
          lastAt: f.lastAt,
          runIds: [run.runId],
        });
        continue;
      }
      if (!g.runIds.includes(run.runId)) {
        g.runIds.push(run.runId);
        g.runs += 1;
      }
      g.occurrences += f.count;
      g.firstAt = minAt(g.firstAt, f.firstAt);
      g.lastAt = maxAt(g.lastAt, f.lastAt);
    }
  }
  return [...groups.values()]
    .filter((g) => g.runs >= 2)
    .map(({ firstAt, lastAt, ...rest }) => ({ ...rest, ...(firstAt ? { firstAt } : {}), ...(lastAt ? { lastAt } : {}) }))
    .sort((a, b) => b.runs - a.runs || b.occurrences - a.occurrences || a.fingerprint.localeCompare(b.fingerprint));
}
