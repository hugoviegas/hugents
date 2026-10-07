import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RunPaths {
  runId: string;
  root: string;
  alpha: string;
  bravo: string;
  events: string;
  summary: string;
  console: string;
  networkFailures: string;
}

/** Windows-safe ISO timestamp (":" and "." are not valid in directory names). */
export function runTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

export async function createRunDir(baseDir: string, scenario: string, now: Date = new Date()): Promise<RunPaths> {
  const runId = `${runTimestamp(now)}-${scenario}`;
  const root = path.join(baseDir, "runs", runId);
  const alpha = path.join(root, "alpha");
  const bravo = path.join(root, "bravo");
  await mkdir(alpha, { recursive: true });
  await mkdir(bravo, { recursive: true });
  const paths: RunPaths = {
    runId,
    root,
    alpha,
    bravo,
    events: path.join(root, "events.jsonl"),
    summary: path.join(root, "summary.json"),
    console: path.join(root, "console.jsonl"),
    networkFailures: path.join(root, "network-failures.jsonl"),
  };
  for (const file of [paths.events, paths.console, paths.networkFailures]) await writeFile(file, "");
  return paths;
}

export async function appendJsonl(file: string, record: unknown): Promise<void> {
  await appendFile(file, `${JSON.stringify(record)}\n`);
}

/** Relative POSIX-style path for events (never an absolute local path). */
export function relativeArtifactPath(run: RunPaths, absolute: string): string {
  return path.relative(run.root, absolute).split(path.sep).join("/");
}
