import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyCleanup,
  CLEANUP_DEFAULTS,
  CleanupConfigError,
  formatCleanupResult,
  parseCleanupConfig,
  planCleanup,
  scanRuns,
  type RunEntry,
} from "../src/storage/cleanup.js";

const MB = 1_000_000;
const name = (day: number) => `2026-10-${String(day).padStart(2, "0")}T10-00-00-000Z-private-match-full-game`;
const run = (day: number, over: Partial<RunEntry> = {}): RunEntry => ({
  name: name(day),
  bytes: 10 * MB,
  heavyBytes: 8 * MB,
  status: "completed",
  active: false,
  ...over,
});
const cfg = (maxMB: number, keepRecent: number, keepFailure: number) => ({
  maxBytes: maxMB * MB,
  keepRecent,
  keepFailure,
});

describe("parseCleanupConfig", () => {
  it("uses conservative defaults", () => {
    expect(parseCleanupConfig({})).toEqual({ maxBytes: 2_147_483_648, keepRecent: 20, keepFailure: 10 });
    expect(CLEANUP_DEFAULTS.maxBytes).toBe(2 * 1024 ** 3);
  });

  it("reads the three variables and rejects bad values without echoing them", () => {
    expect(
      parseCleanupConfig({ QA_ARTIFACT_MAX_BYTES: "1000", QA_ARTIFACT_KEEP_RECENT_RUNS: "3", QA_ARTIFACT_KEEP_FAILURE_RUNS: "2" }),
    ).toEqual({ maxBytes: 1000, keepRecent: 3, keepFailure: 2 });
    expect(() => parseCleanupConfig({ QA_ARTIFACT_MAX_BYTES: "-1", QA_ARTIFACT_KEEP_RECENT_RUNS: "abc" })).toThrow(CleanupConfigError);
    try {
      parseCleanupConfig({ QA_ARTIFACT_KEEP_RECENT_RUNS: "abc" });
    } catch (error) {
      expect((error as Error).message).not.toContain("abc");
    }
  });
});

describe("planCleanup", () => {
  it("does nothing while the artifacts fit the budget", () => {
    const plan = planCleanup([run(1), run(2), run(3)], cfg(100, 1, 1));
    expect(plan).toMatchObject({ stripHeavy: [], deleteRuns: [], totalAfter: 30 * MB, overBudget: false });
  });

  it("removes traces and videos first, oldest first, and stops as soon as it fits", () => {
    // 5 runs x 10 MB = 50 MB, limit 44 MB: stripping one run (8 MB) is enough.
    const plan = planCleanup([1, 2, 3, 4, 5].map((d) => run(d)), cfg(44, 2, 0));
    expect(plan.stripHeavy).toEqual([name(1)]);
    expect(plan.deleteRuns).toEqual([]);
    expect(plan.totalAfter).toBe(42 * MB);
    const tighter = planCleanup([1, 2, 3, 4, 5].map((d) => run(d)), cfg(40, 2, 0));
    expect(tighter.stripHeavy).toEqual([name(1), name(2)]);
  });

  it("never strips or deletes the newest runs", () => {
    const plan = planCleanup([1, 2, 3, 4, 5].map((d) => run(d)), cfg(0, 2, 0));
    const touched = new Set([...plan.stripHeavy, ...plan.deleteRuns]);
    expect(touched.has(name(5))).toBe(false);
    expect(touched.has(name(4))).toBe(false);
    expect(plan.overBudget).toBe(true);
  });

  it("deletes whole directories, oldest successful runs first, only after traces/videos are gone", () => {
    const runs = [1, 2, 3, 4, 5].map((d) => run(d));
    const plan = planCleanup(runs, cfg(26, 2, 0));
    // After stripping runs 1-3 the total is 26 MB (3 x 2 + 2 x 10): fits, nothing deleted.
    expect(plan.deleteRuns).toEqual([]);
    const tight = planCleanup(runs, cfg(24, 2, 0));
    expect(tight.stripHeavy).not.toContain(tight.deleteRuns[0]);
    expect(tight.deleteRuns).toEqual([name(1)]);
    expect(tight.totalAfter).toBe(24 * MB);
  });

  it("preserves the newest failed/blocked run directories but may strip their traces", () => {
    const runs = [
      run(1, { status: "failed" }),
      run(2),
      run(3, { status: "blocked" }),
      run(4),
      run(5),
    ];
    const plan = planCleanup(runs, cfg(0, 1, 2));
    expect(plan.deleteRuns).not.toContain(name(1));
    expect(plan.deleteRuns).not.toContain(name(3));
    expect(plan.deleteRuns).toContain(name(2));
    expect(plan.deleteRuns).toContain(name(4));
    expect(plan.stripHeavy).toContain(name(1));
  });

  it("deletes failures beyond the protected count only after successful runs", () => {
    const runs = [run(1, { status: "failed" }), run(2), run(3, { status: "failed" }), run(4, { status: "failed" })];
    const plan = planCleanup(runs, cfg(0, 0, 1));
    expect(plan.deleteRuns).toEqual([name(2), name(1), name(3)]);
    expect(plan.deleteRuns).not.toContain(name(4));
  });

  it("never touches an active run, even when it is the oldest and largest", () => {
    const runs = [run(1, { active: true, bytes: 900 * MB, heavyBytes: 800 * MB }), run(2), run(3)];
    const plan = planCleanup(runs, cfg(10, 0, 0));
    expect(plan.stripHeavy).not.toContain(name(1));
    expect(plan.deleteRuns).not.toContain(name(1));
    expect(plan.overBudget).toBe(true);
  });
});

describe("scan and apply on disk", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "duel-cleanup-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function makeRun(day: number, opts: { status?: string; heavy?: number; light?: number; old?: boolean }) {
    const root = path.join(dir, "runs", name(day));
    await mkdir(path.join(root, "alpha", "video"), { recursive: true });
    await mkdir(path.join(root, "bravo"), { recursive: true });
    await writeFile(path.join(root, "events.jsonl"), "x".repeat(opts.light ?? 100));
    if (opts.status) await writeFile(path.join(root, "summary.json"), JSON.stringify({ status: opts.status }));
    await writeFile(path.join(root, "alpha", "trace.zip"), Buffer.alloc(opts.heavy ?? 0));
    await writeFile(path.join(root, "alpha", "video", "v.webm"), Buffer.alloc(opts.heavy ?? 0));
    await writeFile(path.join(root, "alpha", "01-login.png"), "png");
    if (opts.old) {
      const past = new Date(Date.now() - 5 * 60 * 60 * 1000);
      for (const p of [root, path.join(root, "events.jsonl")]) await utimes(p, past, past);
    }
    return root;
  }

  it("enforces the byte budget, keeps screenshots and summaries, and prints only counts and bytes", async () => {
    await makeRun(1, { status: "completed", heavy: 5_000, old: true });
    await makeRun(2, { status: "failed", heavy: 5_000, old: true });
    await makeRun(3, { status: "completed", heavy: 5_000, old: true });
    await makeRun(4, { status: "completed", heavy: 5_000, old: true });

    const runs = await scanRuns(dir);
    expect(runs).toHaveLength(4);
    expect(runs.find((r) => r.name === name(2))?.status).toBe("failed");
    const config = { maxBytes: 12_000, keepRecent: 1, keepFailure: 1 };
    const plan = planCleanup(runs, config);
    const result = await applyCleanup(dir, plan, runs.length, config, false);

    // Newest run intact; older traces/videos gone; screenshots and summaries remain.
    expect(existsSync(path.join(dir, "runs", name(4), "alpha", "trace.zip"))).toBe(true);
    expect(existsSync(path.join(dir, "runs", name(1), "alpha", "trace.zip"))).toBe(false);
    expect(existsSync(path.join(dir, "runs", name(2), "alpha", "trace.zip"))).toBe(false);
    expect(existsSync(path.join(dir, "runs", name(2), "alpha", "01-login.png"))).toBe(true);
    expect(existsSync(path.join(dir, "runs", name(2), "summary.json"))).toBe(true);

    const text = formatCleanupResult(result);
    expect(text).toMatch(/Bytes before: \d+/);
    expect(text).not.toMatch(/2026-10|private-match|\.zip|\.webm/);
  });

  it("never deletes a run that is still running (no summary, recent activity)", async () => {
    const live = await makeRun(1, { heavy: 50_000 });
    await makeRun(2, { status: "completed", heavy: 5_000, old: true });
    await makeRun(3, { status: "completed", heavy: 5_000, old: true });

    const runs = await scanRuns(dir);
    expect(runs.find((r) => r.name === name(1))?.active).toBe(true);
    const config = { maxBytes: 1, keepRecent: 0, keepFailure: 0 };
    const result = await applyCleanup(dir, planCleanup(runs, config), runs.length, config, false);

    expect(existsSync(path.join(live, "alpha", "trace.zip"))).toBe(true);
    expect(existsSync(path.join(dir, "runs", name(2)))).toBe(false);
    expect(result.overBudget).toBe(true);
  });

  it("treats a stale run without a summary as a crashed failure, not as active", async () => {
    await makeRun(1, { heavy: 10, old: true });
    const [entry] = await scanRuns(dir);
    expect(entry).toMatchObject({ active: false, status: "unknown" });
  });

  it("dry run changes nothing", async () => {
    await makeRun(1, { status: "completed", heavy: 5_000, old: true });
    await makeRun(2, { status: "completed", heavy: 5_000, old: true });
    const runs = await scanRuns(dir);
    const config = { maxBytes: 1, keepRecent: 1, keepFailure: 0 };
    const result = await applyCleanup(dir, planCleanup(runs, config), runs.length, config, true);
    expect(result.dryRun).toBe(true);
    expect(existsSync(path.join(dir, "runs", name(1), "alpha", "trace.zip"))).toBe(true);
  });

  it("ignores directories that are not run directories", async () => {
    await mkdir(path.join(dir, "runs", "not-a-run"), { recursive: true });
    await writeFile(path.join(dir, "runs", "not-a-run", "x"), "x");
    expect(await scanRuns(dir)).toEqual([]);
    const config = { maxBytes: 0, keepRecent: 0, keepFailure: 0 };
    await applyCleanup(dir, { stripHeavy: ["not-a-run", "../escape"], deleteRuns: ["not-a-run"], totalBefore: 0, totalAfter: 0, overBudget: false }, 0, config, false);
    expect(existsSync(path.join(dir, "runs", "not-a-run", "x"))).toBe(true);
  });
});
