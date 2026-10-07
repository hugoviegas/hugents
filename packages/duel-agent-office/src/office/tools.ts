import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { approvedScreenshots, readRunInputs } from "../observer/inputs.js";
import { parseFindingsReport, type FindingsReport } from "../observer/schema.js";
import { redact } from "../redact.js";
import { runTimestamp } from "../storage/artifacts.js";
import { OFFICE_AGENT_IDS, type ToolName, type ToolResult, type ToolSpec } from "./contract.js";
import type { ImagePart } from "./provider/types.js";

/** Scenarios an agent may start. The runner itself re-checks the Preview target. */
export const SCENARIOS = ["private-match-full-game", "explore-screens"] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export const RUN_ID_SOURCE = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9-]+`;
const RUN_ID = new RegExp(`^${RUN_ID_SOURCE}$`);
const SCREENSHOT = /^\d{2}-[a-z0-9-]+\.png$/;
const RUN_LINE = /^Run (\S+): (completed|failed|blocked)(?: - (.*))?$/m;
const TAIL_LINES = 50;
const APPROVED_SCREENSHOT_LIMIT = 12;
const MAX_REPORT_CHARS = 100_000;
const RUN_TIMEOUT_MS = 15 * 60_000;

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "run_playwright_scenario",
    description:
      "Runs a local Playwright QA scenario against the Vercel Preview + Firebase QA backend. Credentials come from the local .env, never from params.",
    parameters: {
      type: "object",
      properties: {
        scenario: { enum: SCENARIOS },
        headless: { type: "boolean", description: "Default true." },
      },
      required: ["scenario"],
      additionalProperties: false,
    },
  },
  {
    name: "read_artifacts",
    description:
      "Returns the redacted summary, last events, console and network failures, findings (if an observer wrote them) and approved screenshot names of a run. runId may be 'latest'.",
    parameters: {
      type: "object",
      properties: { runId: { type: "string" } },
      required: ["runId"],
      additionalProperties: false,
    },
  },
  {
    name: "write_report",
    description: "Saves a Markdown report to artifacts/reports/<agentId>-<timestamp>.md.",
    parameters: {
      type: "object",
      properties: { agentId: { enum: OFFICE_AGENT_IDS }, content: { type: "string" } },
      required: ["agentId", "content"],
      additionalProperties: false,
    },
  },
];

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ToolDeps {
  /** `duel-agent-office/artifacts`. */
  artifactsDir: string;
  /** Known secret values (from the local config) added to every redaction. */
  secrets?: () => readonly string[];
  /** Runs the runner CLI. Injected so tests never launch a browser. */
  spawnRun?: (scenario: ScenarioName, headless: boolean) => Promise<SpawnResult>;
  /** Writes `<run>/findings.json` with the local observer. Called by `read_artifacts` when the file is missing. */
  observe?: (runId: string) => Promise<void>;
  now?: () => Date;
}

export interface RunPlaywrightData {
  runId?: string;
  status: "completed" | "failed" | "blocked";
  reason?: string;
  /** Relative to `artifacts/`. */
  artifactPaths: string[];
}

export interface ArtifactsData {
  runId: string;
  summary: unknown;
  events: unknown[];
  console: unknown[];
  networkFailures: unknown[];
  /** Line counts of the three JSONL files; the arrays above hold at most the last `TAIL_LINES` of each. */
  totals: { events: number; console: number; networkFailures: number };
  /** The observer's `findings.json` (issue #96) for this run, validated; `null` when absent or unusable. */
  findings: FindingsReport | null;
  /** Why `findings` is `null` although a file or an observer run was expected. */
  findingsNote?: "invalid" | "unsupported-version" | "observer-failed";
  /** Screenshots the observer approves: referenced by the run's events or summary, relative to the run directory. */
  screenshots: string[];
}

const err = (error: string): ToolResult<never> => ({ ok: false, error });

/** Run ids are ISO timestamps that look like tokens to `redact`; they are public identifiers, so they are kept. */
export function redactKeepingRunIds(text: string, secrets: readonly string[]): string {
  const ids: string[] = [];
  const masked = text.replace(new RegExp(RUN_ID_SOURCE, "g"), (id) => `@@RUN${ids.push(id) - 1}@@`);
  return redact(masked, secrets).replace(/@@RUN(\d+)@@/g, (_, i: string) => ids[Number(i)] ?? "");
}

/** Defence in depth: every string handed to an agent or written to a report passes through `redact` again. */
function deepRedact(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactKeepingRunIds(value, secrets);
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepRedact(v, secrets)]));
  }
  return value;
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function readJsonlTail(file: string): Promise<{ tail: unknown[]; total: number }> {
  try {
    const all = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    const tail = all.slice(-TAIL_LINES).map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return line;
      }
    });
    return { tail, total: all.length };
  } catch {
    return { tail: [], total: 0 };
  }
}

const exists = (file: string) => stat(file).then(() => true, () => false);

/** Newest run that has a `summary.json`: a run still in progress (or crashed) has none and must not hide the last finished one. */
export async function latestRunId(artifactsDir: string): Promise<string | undefined> {
  try {
    const names = (await readdir(path.join(artifactsDir, "runs"))).filter((n) => RUN_ID.test(n));
    for (const name of names.sort().reverse()) { // ISO timestamp prefix sorts chronologically
      if (await exists(path.join(artifactsDir, "runs", name, "summary.json"))) return name;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function resolveRunId(deps: ToolDeps, runId: unknown): Promise<string | undefined> {
  if (runId === "latest") return latestRunId(deps.artifactsDir);
  return typeof runId === "string" && RUN_ID.test(runId) ? runId : undefined;
}

export async function readArtifacts(deps: ToolDeps, params: { runId?: unknown }): Promise<ToolResult<ArtifactsData>> {
  const runId = await resolveRunId(deps, params.runId);
  if (!runId) return err("No such run (expected a run id or 'latest')");
  const root = path.join(deps.artifactsDir, "runs", runId);
  const summary = await readJson(path.join(root, "summary.json"));
  if (summary === null) return err("Run has no summary.json yet");

  // The observer decides which screenshots are approved (referenced by events or summary, sane name and size).
  const screenshots = (await approvedScreenshots(root, await readRunInputs(root, runId), APPROVED_SCREENSHOT_LIMIT)).map((s) => s.rel);

  // Deterministic local observer, no model: it writes findings.json for this run when none exists yet.
  const findingsFile = path.join(root, "findings.json");
  let findingsNote: ArtifactsData["findingsNote"];
  if (deps.observe && !(await exists(findingsFile))) {
    await deps.observe(runId).catch(() => {
      findingsNote = "observer-failed";
    });
  }
  let findings: FindingsReport | null = null;
  const rawFindings = await readJson(findingsFile);
  if (rawFindings !== null) {
    const parsed = parseFindingsReport(rawFindings);
    if (parsed.ok) findings = parsed.report;
    else findingsNote = parsed.error;
  }

  const secrets = deps.secrets?.() ?? [];
  const [events, consoleLines, network] = await Promise.all(
    ["events.jsonl", "console.jsonl", "network-failures.jsonl"].map((f) => readJsonlTail(path.join(root, f))),
  );
  // Only the files above are ever opened: no trace.zip, no video/, no .env, no raw payloads.
  const data: ArtifactsData = {
    runId,
    summary,
    events: events!.tail,
    console: consoleLines!.tail,
    networkFailures: network!.tail,
    totals: { events: events!.total, console: consoleLines!.total, networkFailures: network!.total },
    findings,
    ...(findingsNote ? { findingsNote } : {}),
    screenshots,
  };
  return { ok: true, data: deepRedact(data, secrets) as ArtifactsData };
}

/** Evenly spread picks, and never the first screenshot (the app's loading splash or the login form). */
export function pickScreenshots(names: readonly string[], max: number): string[] {
  const usable = names.filter((n) => !n.includes("login-screen"));
  if (usable.length <= max) return [...usable];
  if (max <= 1) return usable.slice(0, max);
  return Array.from({ length: max }, (_, i) => usable[Math.round((i * (usable.length - 1)) / (max - 1))]!);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Loads screenshots for a vision model. `names` must be the observer-approved list (referenced by the run's events or
 * summary). Each file is checked again: name pattern, a regular file (no symlink), not empty, within `maxBytes`, and
 * really a PNG. Anything else is skipped, and at most `max` are returned. Nothing here redacts pixels.
 */
export async function readApprovedImages(
  deps: ToolDeps,
  runId: string,
  names: readonly string[],
  limits: { max: number; maxBytes: number },
): Promise<ImagePart[]> {
  if (!RUN_ID.test(runId)) return [];
  const out: ImagePart[] = [];
  for (const name of pickScreenshots(names, limits.max)) {
    const [player, file, extra] = name.split("/");
    if (extra !== undefined || !["alpha", "bravo"].includes(player ?? "") || !SCREENSHOT.test(file ?? "")) continue;
    const full = path.join(deps.artifactsDir, "runs", runId, player!, file!);
    try {
      const info = await lstat(full);
      if (!info.isFile() || info.size === 0 || info.size > limits.maxBytes) continue;
      const bytes = await readFile(full);
      if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) continue;
      out.push({ name, mimeType: "image/png", data: bytes.toString("base64") });
    } catch {
      // unreadable: skipped
    }
  }
  return out;
}

/** Bytes of one approved screenshot for a vision model. Rejects anything outside the approved name pattern. */
export async function readScreenshot(deps: ToolDeps, runId: string, rel: string): Promise<Buffer | undefined> {
  const [player, name, extra] = rel.split("/");
  if (!RUN_ID.test(runId) || extra !== undefined || !["alpha", "bravo"].includes(player ?? "") || !SCREENSHOT.test(name ?? "")) {
    return undefined;
  }
  return readFile(path.join(deps.artifactsDir, "runs", runId, player!, name!)).catch(() => undefined);
}

export async function writeReport(
  deps: ToolDeps,
  params: { agentId?: unknown; content?: unknown },
): Promise<ToolResult<{ reportPath: string }>> {
  const { agentId, content } = params;
  if (typeof agentId !== "string" || !(OFFICE_AGENT_IDS as readonly string[]).includes(agentId)) return err("Unknown agentId");
  if (typeof content !== "string" || !content.trim()) return err("content must be a non-empty string");
  const now = deps.now ?? (() => new Date());
  await mkdir(path.join(deps.artifactsDir, "reports"), { recursive: true });
  const body = redactKeepingRunIds(content.slice(0, MAX_REPORT_CHARS), deps.secrets?.() ?? []);
  // "wx" never overwrites a report; a same-millisecond clash gets a numeric suffix.
  for (let n = 0; n < 100; n += 1) {
    const rel = `reports/${agentId}-${runTimestamp(now())}${n ? `-${n}` : ""}.md`;
    try {
      await writeFile(path.join(deps.artifactsDir, rel), `${body}\n`, { flag: "wx" });
      return { ok: true, data: { reportPath: rel } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  return err("Could not pick a free report name");
}

let runQueue: Promise<unknown> = Promise.resolve();

/** Same two QA accounts for every scenario, so runs never overlap. */
function serialized<T>(job: () => Promise<T>): Promise<T> {
  const next = runQueue.then(job, job);
  runQueue = next.catch(() => undefined);
  return next;
}

/** The runner never needs a provider key, so it is not handed to the subprocess (or to the browser it launches). */
export function withoutProviderSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const rest = { ...env };
  delete rest.GEMINI_API_KEY;
  return rest;
}

export function defaultSpawnRun(rootDir: string) {
  return (scenario: ScenarioName, headless: boolean): Promise<SpawnResult> =>
    new Promise((resolve) => {
      const args = ["--import", "tsx", "src/cli.ts", scenario, headless ? "--headless" : "--headed"];
      const child = spawn(process.execPath, args, { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: withoutProviderSecrets(process.env) });
      let stdout = "";
      let stderr = "";
      const cap = (s: string, chunk: Buffer) => (s + chunk.toString()).slice(-64_000);
      child.stdout.on("data", (c: Buffer) => (stdout = cap(stdout, c)));
      child.stderr.on("data", (c: Buffer) => (stderr = cap(stderr, c)));
      const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: "Runner could not be started" });
      });
    });
}

export async function runPlaywrightScenario(
  deps: ToolDeps,
  params: Record<string, unknown>,
): Promise<ToolResult<RunPlaywrightData>> {
  const extra = Object.keys(params).filter((k) => k !== "scenario" && k !== "headless");
  if (extra.length) {
    return err("Unsupported params: credentials and config are read from the local .env, never from tool params");
  }
  const { scenario } = params;
  if (typeof scenario !== "string" || !(SCENARIOS as readonly string[]).includes(scenario)) {
    return err(`Unknown scenario. Available: ${SCENARIOS.join(", ")}`);
  }
  const headless = params.headless === undefined ? true : params.headless === true;
  if (!deps.spawnRun) return err("No runner configured");
  const spawnRun = deps.spawnRun;
  const secrets = deps.secrets?.() ?? [];

  const result = await serialized(() => spawnRun(scenario as ScenarioName, headless));
  const line = RUN_LINE.exec(result.stdout);
  if (!line) {
    // Exit 64 is a sanitized config error (names and rules, never values).
    const first = result.stderr.split("\n").find((l) => l.trim()) ?? "Runner produced no result";
    return { ok: true, data: { status: "blocked", reason: redact(first, secrets).slice(0, 300), artifactPaths: [] } };
  }
  const [, runId, status, reason] = line;
  const artifactPaths: string[] = [];
  for (const file of ["summary.json", "events.jsonl", "console.jsonl", "network-failures.jsonl", "findings.json"]) {
    const rel = `runs/${runId}/${file}`;
    if (await stat(path.join(deps.artifactsDir, rel)).then(() => true, () => false)) artifactPaths.push(rel);
  }
  return {
    ok: true,
    data: {
      runId,
      status: status as RunPlaywrightData["status"],
      ...(reason ? { reason: redact(reason, secrets).slice(0, 300) } : {}),
      artifactPaths,
    },
  };
}

/** Name-keyed dispatch so an office can call tools by the name the model returns. */
export function callTool(deps: ToolDeps, name: ToolName, params: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case "run_playwright_scenario":
      return runPlaywrightScenario(deps, params);
    case "read_artifacts":
      return readArtifacts(deps, params);
    case "write_report":
      return writeReport(deps, params);
  }
}
