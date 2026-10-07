import { lstat, open, readFile } from "node:fs/promises";
import path from "node:path";
import { AGENTS, EVENT_STATUSES, type AgentName, type EventStatus } from "../orchestrator/eventBus.js";
import { INTERACTION_CATEGORIES, type InteractionCategory } from "../errors.js";
import type { InputIssues } from "./schema.js";

/**
 * Allowed inputs of a run directory, opened by fixed name only. The observer never lists
 * or walks a run directory, so traces, videos, env files and raw payloads are never opened.
 */
export const SAFE_INPUTS = ["summary.json", "events.jsonl", "console.jsonl", "network-failures.jsonl"] as const;

export const RUN_NAME = /^\d{4}-\d{2}-\d{2}T[0-9-]+Z-[a-z0-9-]+$/;
/** Runner step/failure screenshots: `<alpha|bravo>/NN-name.png`. */
const SCREENSHOT_PATH = /^(alpha|bravo)\/\d{2,}-[a-z0-9-]+\.png$/;
const FORBIDDEN =
  /(^|\/)(\.env[^/]*|[^/]*\.(zip|webm|mp4|mkv|har|key|pem)|trace[^/]*|videos?|traces?)(\/|$)/i;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

/** True for anything the observer must never read: env files, traces, videos, HAR, keys. */
export function isForbiddenArtifact(rel: string): boolean {
  return FORBIDDEN.test(rel.replace(/\\/g, "/"));
}

export interface SafeSummary {
  status: "completed" | "blocked" | "failed";
  scenario?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  reason?: string;
  blockedOn?: string;
  failure?: { category: InteractionCategory; agent?: AgentName };
  /** Fixed-vocabulary match outcome and turn counts, only when both players are fully valid. */
  result?: RunResult;
  failureScreenshots: string[];
}

export const OUTCOMES = ["win", "loss", "draw", "unknown"] as const;
export interface RunResult {
  outcome: { alpha: (typeof OUTCOMES)[number]; bravo: (typeof OUTCOMES)[number] };
  turns: { alpha: number; bravo: number };
}

function parseResult(value: unknown): RunResult | undefined {
  if (!isObj(value) || !isObj(value.outcome) || !isObj(value.turns)) return undefined;
  const outcome = (v: unknown) => OUTCOMES.find((o) => o === v);
  const turns = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000 ? v : undefined);
  const [oa, ob, ta, tb] = [outcome(value.outcome.alpha), outcome(value.outcome.bravo), turns(value.turns.alpha), turns(value.turns.bravo)];
  if (!oa || !ob || ta === undefined || tb === undefined) return undefined;
  return { outcome: { alpha: oa, bravo: ob }, turns: { alpha: ta, bravo: tb } };
}

export interface SafeEvent {
  line: number;
  at: string;
  agent: AgentName;
  status: EventStatus;
  activity: string;
  artifactPath?: string;
}

export interface SafeConsole {
  line: number;
  at?: string;
  agent?: AgentName;
  kind: "console-error" | "page-error";
  text: string;
}

export interface SafeNetwork {
  line: number;
  at?: string;
  agent?: AgentName;
  kind: "request-failed" | "http-error";
  method?: string;
  url?: string;
  failure?: string;
  status?: number;
}

export interface RunInputs {
  runId: string;
  summary?: SafeSummary;
  events: SafeEvent[];
  console: SafeConsole[];
  network: SafeNetwork[];
  issues: InputIssues;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const agentOf = (v: unknown): AgentName | undefined => (AGENTS.includes(v as AgentName) ? (v as AgentName) : undefined);

/** Reads one regular, size-capped file by fixed name. Missing, symlinked or oversized: undefined. */
async function readSafeFile(file: string, issues: InputIssues): Promise<string | undefined> {
  try {
    const info = await lstat(file);
    if (!info.isFile()) return undefined; // symlinks and directories are not followed
    if (info.size > MAX_FILE_BYTES) {
      issues.oversizedFiles += 1;
      return undefined;
    }
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

function parseSummary(raw: string): SafeSummary | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isObj(value) || !["completed", "blocked", "failed"].includes(value.status as string)) return undefined;
  const failure = isObj(value.failure) ? value.failure : undefined;
  const category = INTERACTION_CATEGORIES.find((c) => c === failure?.category);
  const evidence = isObj(value.evidence) ? value.evidence : undefined;
  const shots = Array.isArray(evidence?.failureScreenshots) ? evidence.failureScreenshots : [];
  return {
    status: value.status as SafeSummary["status"],
    scenario: str(value.scenario),
    startedAt: str(value.startedAt),
    finishedAt: str(value.finishedAt),
    durationMs: typeof value.durationMs === "number" ? value.durationMs : undefined,
    reason: str(value.reason),
    blockedOn: str(value.blockedOn),
    ...(category ? { failure: { category, agent: agentOf(failure?.agent) } } : {}),
    ...(parseResult(value.result) ? { result: parseResult(value.result) } : {}),
    failureScreenshots: shots.filter((s): s is string => typeof s === "string"),
  };
}

function parseJsonl<T>(
  raw: string | undefined,
  issues: InputIssues,
  accept: (record: Record<string, unknown>, line: number) => T | undefined,
): T[] {
  if (!raw) return [];
  const out: T[] = [];
  raw.split("\n").forEach((text, index) => {
    if (!text.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      issues.malformedLines += 1;
      return;
    }
    const accepted = isObj(value) ? accept(value, index + 1) : undefined;
    if (accepted) out.push(accepted);
    else issues.invalidRecords += 1;
  });
  return out;
}

export async function readRunInputs(runRoot: string, runId: string): Promise<RunInputs> {
  const issues: InputIssues = { malformedSummary: false, malformedLines: 0, invalidRecords: 0, oversizedFiles: 0 };
  const [summaryRaw, eventsRaw, consoleRaw, networkRaw] = await Promise.all(
    SAFE_INPUTS.map((name) => readSafeFile(path.join(runRoot, name), issues)),
  );
  const summary = summaryRaw === undefined ? undefined : parseSummary(summaryRaw);
  if (summaryRaw !== undefined && !summary) issues.malformedSummary = true;

  const events = parseJsonl<SafeEvent>(eventsRaw, issues, (r, line) => {
    const agent = agentOf(r.agent);
    const at = str(r.at);
    const status = EVENT_STATUSES.find((s) => s === r.status);
    const activity = str(r.activity);
    if (!agent || !at || !status || activity === undefined) return undefined;
    return { line, at, agent, status, activity, artifactPath: str(r.artifactPath) };
  });
  const consoleRecords = parseJsonl<SafeConsole>(consoleRaw, issues, (r, line) => {
    const text = str(r.text);
    if ((r.kind !== "console-error" && r.kind !== "page-error") || text === undefined) return undefined;
    return { line, at: str(r.at), agent: agentOf(r.agent), kind: r.kind, text };
  });
  const network = parseJsonl<SafeNetwork>(networkRaw, issues, (r, line) => {
    if (r.kind !== "request-failed" && r.kind !== "http-error") return undefined;
    const status = typeof r.status === "number" ? r.status : undefined;
    if (r.kind === "http-error" && (status === undefined || status < 400 || status > 599)) return undefined;
    return {
      line,
      at: str(r.at),
      agent: agentOf(r.agent),
      kind: r.kind,
      method: str(r.method),
      url: str(r.url),
      failure: str(r.failure),
      status,
    };
  });
  return { runId, summary, events, console: consoleRecords, network, issues };
}

export interface ApprovedScreenshot {
  /** Relative POSIX path inside the run directory. Used for local evidence refs only. */
  rel: string;
  player: "alpha" | "bravo";
  label: string;
}

/**
 * Screenshots the observer may show: only files the runner itself referenced (an event's
 * `artifactPath` or `summary.evidence.failureScreenshots`), matching the runner's naming,
 * regular files (no symlinks), size-capped and never a forbidden artifact. The runner takes
 * them before credentials are typed and never on the login, join-code or waiting-room screens.
 */
export async function approvedScreenshots(runRoot: string, inputs: RunInputs, limit: number): Promise<ApprovedScreenshot[]> {
  const referenced = new Set<string>();
  for (const e of inputs.events) if (e.artifactPath) referenced.add(e.artifactPath);
  for (const s of inputs.summary?.failureScreenshots ?? []) referenced.add(s);
  const out: ApprovedScreenshot[] = [];
  for (const rel of [...referenced].sort()) {
    if (out.length >= limit) break;
    if (!SCREENSHOT_PATH.test(rel) || isForbiddenArtifact(rel)) continue;
    try {
      const info = await lstat(path.join(runRoot, ...rel.split("/")));
      if (!info.isFile() || info.size > MAX_SCREENSHOT_BYTES) continue;
    } catch {
      continue;
    }
    out.push({
      rel,
      player: rel.startsWith("alpha/") ? "alpha" : "bravo",
      label: rel.replace(/^[^/]+\/\d+-/, "").replace(/\.png$/, "").replace(/-/g, " "),
    });
  }
  return out;
}

/** Opens a screenshot only when it is in the approved list (the dashboard never takes a path). */
export async function readApprovedScreenshot(runRoot: string, shot: ApprovedScreenshot): Promise<Buffer> {
  const handle = await open(path.join(runRoot, ...shot.rel.split("/")), "r");
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
