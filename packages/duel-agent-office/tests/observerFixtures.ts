import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObserverConfig } from "../src/observer/config.js";

export const NOW = new Date("2026-10-06T12:00:00.000Z");
export const runName = (n: number, scenario = "private-match-full-game") =>
  `2026-10-0${n}T10-00-00-000Z-${scenario}`;

export interface FixtureRun {
  summary?: Record<string, unknown> | string;
  events?: Record<string, unknown>[] | string;
  console?: Record<string, unknown>[] | string;
  network?: Record<string, unknown>[] | string;
  /** Extra files relative to the run dir (contents are canaries or PNG bytes). */
  files?: Record<string, string | Buffer>;
}

const jsonl = (v: Record<string, unknown>[] | string | undefined) =>
  v === undefined ? "" : typeof v === "string" ? v : v.map((r) => JSON.stringify(r)).join("\n") + "\n";

/** Writes a run directory shaped like the runner's output and returns its absolute path. */
export async function makeRun(artifactsDir: string, name: string, run: FixtureRun): Promise<string> {
  const root = path.join(artifactsDir, "runs", name);
  await mkdir(path.join(root, "alpha"), { recursive: true });
  await mkdir(path.join(root, "bravo"), { recursive: true });
  if (run.summary !== undefined) {
    await writeFile(path.join(root, "summary.json"), typeof run.summary === "string" ? run.summary : JSON.stringify(run.summary));
  }
  await writeFile(path.join(root, "events.jsonl"), jsonl(run.events));
  await writeFile(path.join(root, "console.jsonl"), jsonl(run.console));
  await writeFile(path.join(root, "network-failures.jsonl"), jsonl(run.network));
  for (const [rel, content] of Object.entries(run.files ?? {})) {
    const file = path.join(root, ...rel.split("/"));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

export const summary = (over: Record<string, unknown> = {}) => ({
  runId: "x",
  scenario: "private-match-full-game",
  flow: "private-room-code",
  status: "completed",
  startedAt: "2026-10-01T10:00:00.000Z",
  finishedAt: "2026-10-01T10:05:00.000Z",
  durationMs: 300000,
  loginMode: "dev-login",
  players: ["player-alpha", "player-bravo"],
  evidence: { events: "events.jsonl", console: "console.jsonl", networkFailures: "network-failures.jsonl", failureScreenshots: [] },
  ...over,
});

export const event = (over: Record<string, unknown> = {}) => ({
  at: "2026-10-01T10:00:01.000Z",
  runId: "x",
  agent: "runner",
  status: "planning",
  activity: "Starting run",
  scenario: "private-match-full-game",
  ...over,
});

export const config = (artifactsDir: string, over: Partial<ObserverConfig> = {}): ObserverConfig => ({
  artifactsDir,
  ignoreNetworkFailures: ["net::ERR_ABORTED"],
  reportAborted: false,
  screenshotLimit: 12,
  host: "127.0.0.1",
  port: 0,
  activeWindowMs: 60 * 60 * 1000,
  ...over,
});

/** 1x1 PNG. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);
