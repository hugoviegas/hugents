import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadObserverConfig, ObserverConfigError } from "../src/observer/config.js";
import { FINDINGS_SCHEMA_VERSION, parseFindingsReport } from "../src/observer/schema.js";
import { formatSummary, observe } from "../src/observer/scan.js";
import { config, event, makeRun, NOW, runName, summary } from "./observerFixtures.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-observer-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seed() {
  await makeRun(dir, runName(1), {
    summary: summary(),
    events: [event({ agent: "runner", status: "completed" })],
    console: [{ at: "2026-10-01T10:01:00.000Z", agent: "player-alpha", kind: "page-error", text: "TypeError: he is not a function" }],
    network: [{ at: "2026-10-01T10:01:00.000Z", agent: "player-alpha", kind: "request-failed", method: "GET", url: "https://x.example.com/a?token=abc", failure: "net::ERR_ABORTED" }],
  });
  await makeRun(dir, runName(2), {
    summary: summary({ status: "failed", reason: "Battle interaction failed: confirm-did-not-advance", failure: { category: "confirm-did-not-advance", agent: "player-alpha" } }),
    console: [{ at: "2026-10-02T10:01:00.000Z", agent: "player-bravo", kind: "page-error", text: "TypeError: he is not a function" }],
  });
  await makeRun(dir, runName(3), { summary: summary({ status: "blocked", blockedOn: "missing-precondition", reason: "no room" }) });
}

describe("findings.json", () => {
  it("is deterministic and schema-valid for a fixture artifact root", async () => {
    await seed();
    const a = await observe(config(dir), { now: NOW, dryRun: true });
    const b = await observe(config(dir), { now: NOW, dryRun: true });
    expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report));
    const parsed = parseFindingsReport(JSON.parse(JSON.stringify(a.report)));
    expect(parsed.ok).toBe(true);
    expect(a.report).toMatchObject({
      schemaVersion: FINDINGS_SCHEMA_VERSION,
      scope: "root",
      totals: { runs: 3, byStatus: { blocked: 1, completed: 1, failed: 1 }, ignoredNetworkFailures: 1 },
    });
    expect(a.report.runs.map((r) => r.runId)).toEqual([runName(1), runName(2), runName(3)]);
    expect(a.report.repeated.map((r) => r.ruleId)).toContain("known-he-not-a-function");
  });

  it("matches the committed shape snapshot (ids and ordering are stable)", async () => {
    await seed();
    const { report } = await observe(config(dir), { now: NOW, dryRun: true });
    expect(
      report.runs.map((r) => ({ id: r.runId.slice(0, 13), status: r.status, rules: r.findings.map((f) => `${f.ruleId}:${f.severity}:${f.player}:${f.count}`) })),
    ).toEqual([
      { id: "2026-10-01T10", status: "completed", rules: ["known-he-not-a-function:high:alpha:1", "completed-with-error-signals:medium:runner:1"] },
      { id: "2026-10-02T10", status: "failed", rules: ["interaction-confirm-did-not-advance:high:alpha:1", "known-he-not-a-function:high:bravo:1"] },
      { id: "2026-10-03T10", status: "blocked", rules: ["run-blocked:medium:runner:1"] },
    ]);
  });

  it("writes per-run and root files, and a dry run writes nothing", async () => {
    await seed();
    const dry = await observe(config(dir), { now: NOW, dryRun: true });
    expect(dry.written).toBe(false);
    await expect(stat(path.join(dir, "findings.json"))).rejects.toThrow();

    const root = await observe(config(dir), { now: NOW });
    expect(root.target).toBe(path.join(dir, "findings.json"));
    expect(parseFindingsReport(JSON.parse(await readFile(root.target, "utf8"))).ok).toBe(true);

    const one = await observe(config(dir), { now: NOW, runDir: runName(2) }); // bare run name
    expect(one.target).toBe(path.join(dir, "runs", runName(2), "findings.json"));
    expect(one.report.scope).toBe("run");
    expect(one.report.totals.runs).toBe(1);
    // updating an existing findings file is allowed
    await observe(config(dir), { now: NOW });
  });

  it("prints aggregate counts only", async () => {
    await seed();
    const text = formatSummary(await observe(config(dir), { now: NOW, dryRun: true }));
    expect(text).toContain("runs: 3");
    expect(text).toContain("dry run");
    expect(text).not.toMatch(/2026-10|private-match|he is not a function|\.json:/);
  });

  it("refuses to overwrite foreign files or runner inputs", async () => {
    await seed();
    const foreign = path.join(dir, "notes.json");
    await writeFile(foreign, '{"hello":"world"}');
    await expect(observe(config(dir, { findingsFile: foreign }), { now: NOW })).rejects.toThrow(/not an observer findings file/);
    await expect(observe(config(dir, { findingsFile: path.join(dir, "summary.json") }), { now: NOW })).rejects.toThrow();
    await expect(observe(config(dir, { findingsFile: path.join(dir, ".env.json") }), { now: NOW })).rejects.toThrow();
    expect(await readFile(foreign, "utf8")).toBe('{"hello":"world"}');
  });

  it("reports an explicit error for a run directory that does not exist", async () => {
    await expect(observe(config(dir), { runDir: runName(5), now: NOW })).rejects.toThrow(/not found/i);
  });

  it("reports an empty artifact root as zero runs", async () => {
    const { report } = await observe(config(dir), { now: NOW, dryRun: true });
    expect(report.totals.runs).toBe(0);
    expect(report.runs).toEqual([]);
  });
});

describe("schema and versioning", () => {
  it("accepts the current version and rejects newer, unknown and malformed files", async () => {
    await seed();
    const { report } = await observe(config(dir), { now: NOW, dryRun: true });
    expect(parseFindingsReport(report)).toEqual({ ok: true, report });
    expect(parseFindingsReport({ ...report, schemaVersion: FINDINGS_SCHEMA_VERSION + 1 })).toEqual({ ok: false, error: "unsupported-version" });
    expect(parseFindingsReport({ ...report, schemaVersion: 0 })).toEqual({ ok: false, error: "invalid" });
    expect(parseFindingsReport({ ...report, kind: "other" })).toEqual({ ok: false, error: "invalid" });
    expect(parseFindingsReport({ ...report, runs: [{ runId: "x" }] })).toEqual({ ok: false, error: "invalid" });
    expect(parseFindingsReport(null)).toEqual({ ok: false, error: "invalid" });
    const bad = structuredClone(report);
    (bad.runs[0]?.findings[0] as { severity: string }).severity = "catastrophic";
    expect(parseFindingsReport(bad)).toEqual({ ok: false, error: "invalid" });
  });

  it("includes only the documented per-finding fields (no raw artifact content)", async () => {
    await seed();
    const { report } = await observe(config(dir), { now: NOW, dryRun: true });
    const keys = Object.keys(report.runs[0]?.findings[0] ?? {}).sort();
    expect(keys).toEqual(["category", "count", "evidence", "fingerprint", "firstAt", "id", "lastAt", "message", "player", "ruleId", "runId", "severity"]);
  });
});

describe("observer config", () => {
  const load = (env: Record<string, string>, overrides?: { reportAborted?: boolean }) => loadObserverConfig(env, dir, overrides);

  it("has localhost defaults and ignores ERR_ABORTED by default", () => {
    expect(load({})).toMatchObject({ artifactsDir: dir, host: "127.0.0.1", port: 4873, ignoreNetworkFailures: ["net::ERR_ABORTED"], reportAborted: false, screenshotLimit: 12 });
  });

  it("supports the explicit ERR_ABORTED opt-in (env and flag) and extra ignore patterns", () => {
    expect(load({ QA_OBSERVER_REPORT_ABORTED: "true" }).ignoreNetworkFailures).toEqual([]);
    expect(load({}, { reportAborted: true }).ignoreNetworkFailures).toEqual([]);
    expect(load({ QA_OBSERVER_IGNORE_NETWORK: "net::ERR_BLOCKED_BY_CLIENT, net::ERR_ABORTED" }).ignoreNetworkFailures).toEqual([
      "net::ERR_ABORTED",
      "net::ERR_BLOCKED_BY_CLIENT",
    ]);
  });

  it("rejects non-loopback hosts and bad values without echoing them", () => {
    const bad: Record<string, string>[] = [{ QA_OBSERVER_HOST: "0.0.0.0" }, { QA_OBSERVER_HOST: "192.168.1.5" }, { QA_OBSERVER_PORT: "99999" }, { QA_OBSERVER_SCREENSHOT_LIMIT: "-1" }, { QA_OBSERVER_FINDINGS_FILE: "x.txt" }, { QA_OBSERVER_REPORT_ABORTED: "maybe" }];
    for (const env of bad) {
      expect(() => load(env)).toThrow(ObserverConfigError);
      try {
        load(env);
      } catch (e) {
        expect(String(e)).not.toMatch(/0\.0\.0\.0|192\.168|99999|maybe/);
      }
    }
  });
});
