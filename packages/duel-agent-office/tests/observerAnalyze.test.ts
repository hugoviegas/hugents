import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanRunDir } from "../src/observer/scan.js";
import { config, event, makeRun, NOW, runName, summary, type FixtureRun } from "./observerFixtures.js";
import type { ObserverConfig } from "../src/observer/config.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-observer-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function analyze(run: FixtureRun, cfg: ObserverConfig = config(dir), n = 1) {
  const root = await makeRun(dir, runName(n), run);
  return (await scanRunDir(root, cfg, NOW)).report;
}
const rules = (r: { findings: { ruleId: string }[] }) => r.findings.map((f) => f.ruleId);

describe("observer rules", () => {
  it("reports console errors and uncaught page errors with sources and counts", async () => {
    const r = await analyze({
      summary: summary(),
      console: [
        { at: "2026-10-01T10:01:00.000Z", agent: "player-alpha", kind: "console-error", text: "Failed to load thing 12" },
        { at: "2026-10-01T10:02:00.000Z", agent: "player-alpha", kind: "console-error", text: "Failed to load thing 99" },
        { at: "2026-10-01T10:03:00.000Z", agent: "player-bravo", kind: "page-error", text: "Uncaught: boom" },
      ],
    });
    const consoleFinding = r.findings.find((f) => f.ruleId === "console-error");
    expect(consoleFinding).toMatchObject({ category: "console-error", severity: "medium", player: "alpha", count: 2 });
    expect(consoleFinding?.firstAt).toBe("2026-10-01T10:01:00.000Z");
    expect(consoleFinding?.lastAt).toBe("2026-10-01T10:02:00.000Z");
    expect(consoleFinding?.evidence).toEqual([
      { file: "console.jsonl", line: 1 },
      { file: "console.jsonl", line: 2 },
    ]);
    expect(r.findings.find((f) => f.ruleId === "page-error")).toMatchObject({ category: "page-error", severity: "high", player: "bravo" });
  });

  it("reports 4xx and 5xx, keeping authentication and authorization failures high", async () => {
    const r = await analyze({
      summary: summary(),
      network: [
        { agent: "player-alpha", kind: "http-error", method: "GET", url: "https://api.example.com/v1/items", status: 404 },
        { agent: "player-alpha", kind: "http-error", method: "POST", url: "https://api.example.com/v1/login", status: 401 },
        { agent: "player-bravo", kind: "http-error", method: "GET", url: "https://api.example.com/v1/items", status: 503 },
      ],
    });
    expect(r.findings.find((f) => f.message.startsWith("404"))).toMatchObject({ ruleId: "http-4xx", severity: "medium" });
    expect(r.findings.find((f) => f.message.startsWith("401"))).toMatchObject({ ruleId: "http-auth", category: "http-4xx", severity: "high" });
    expect(r.findings.find((f) => f.message.startsWith("503"))).toMatchObject({ ruleId: "http-5xx", category: "http-5xx", severity: "high" });
  });

  it("reports relevant network failures but counts and ignores net::ERR_ABORTED by default", async () => {
    const network = [
      { agent: "player-alpha", kind: "request-failed", method: "GET", url: "https://x.example.com/a", failure: "net::ERR_ABORTED" },
      { agent: "player-alpha", kind: "request-failed", method: "HEAD", url: "https://x.example.com/b", failure: "net::ERR_ABORTED" },
      { agent: "player-alpha", kind: "request-failed", method: "GET", url: "https://x.example.com/c", failure: "net::ERR_CONNECTION_RESET" },
    ];
    const r = await analyze({ summary: summary(), network });
    expect(r.ignored.networkFailures).toBe(2);
    expect(r.findings.filter((f) => f.category === "network-failure")).toHaveLength(1);
    expect(r.findings.find((f) => f.category === "network-failure")?.message).toContain("ERR_CONNECTION_RESET");
  });

  it("reports net::ERR_ABORTED only with the explicit local opt-in", async () => {
    const network = [{ agent: "player-alpha", kind: "request-failed", method: "GET", url: "https://x.example.com/a", failure: "net::ERR_ABORTED" }];
    const r = await analyze({ summary: summary(), network }, config(dir, { ignoreNetworkFailures: [], reportAborted: true }));
    expect(r.ignored.networkFailures).toBe(0);
    expect(r.findings.some((f) => f.ruleId === "network-failure" && f.message.includes("ERR_ABORTED"))).toBe(true);
  });

  it("never hides 4xx, 5xx, console or page errors through the network ignore list", async () => {
    const r = await analyze(
      {
        summary: summary(),
        console: [{ agent: "player-alpha", kind: "console-error", text: "net::ERR_ABORTED seen in console" }],
        network: [{ agent: "player-alpha", kind: "http-error", method: "GET", url: "https://x.example.com/a", status: 500 }],
      },
      config(dir, { ignoreNetworkFailures: ["net::ERR_ABORTED", "500"] }),
    );
    expect(rules(r)).toEqual(expect.arrayContaining(["console-error", "http-5xx"]));
  });

  it("reports blocked, failed, timed-out and crashed runs", async () => {
    const blocked = await analyze({ summary: summary({ status: "blocked", blockedOn: "missing-precondition", reason: "Lobby refused a room" }) }, config(dir), 1);
    expect(blocked.status).toBe("blocked");
    expect(blocked.findings[0]).toMatchObject({ ruleId: "run-blocked", category: "run-blocked", severity: "medium" });
    expect(blocked.findings[0]?.message).toContain("missing-precondition");

    const failed = await analyze({ summary: summary({ status: "failed", reason: "Selector not found" }) }, config(dir), 2);
    expect(failed.findings[0]).toMatchObject({ ruleId: "run-failed", category: "run-failed", severity: "high" });

    const timeout = await analyze({ summary: summary({ status: "failed", reason: "Scenario timeout reached" }) }, config(dir), 3);
    expect(rules(timeout)).toEqual(["run-timeout"]); // the specific rule replaces the generic failed finding
    expect(timeout.findings[0]?.category).toBe("timeout");

    const crashed = await analyze({ events: [event({ at: "2026-10-01T10:00:01.000Z" })] }, config(dir), 4);
    expect(crashed.status).toBe("failed");
    expect(rules(crashed)).toEqual(["run-incomplete"]);
  });

  it("treats a run without summary and with recent activity as active, and a terminal runner event as final", async () => {
    const active = await analyze({ events: [event({ at: "2026-10-06T11:55:00.000Z" })] }, config(dir), 1);
    expect(active.status).toBe("active");
    expect(active.findings).toEqual([]);
    const done = await analyze({ events: [event({ agent: "runner", status: "completed", at: "2026-10-01T10:00:01.000Z" })] }, config(dir), 2);
    expect(done.status).toBe("completed");
  });

  it("reports every known interaction failure category, using the timeout category for turn-state-timeout", async () => {
    const categories = [
      "card-not-visible",
      "no-playable-card",
      "card-not-enabled",
      "battle-overlay-blocked",
      "card-selection-not-confirmed",
      "confirm-not-visible",
      "confirm-not-enabled",
      "confirm-did-not-advance",
      "turn-state-timeout",
    ];
    for (const [i, category] of categories.entries()) {
      const root = await makeRun(dir, `2026-10-0${(i % 9) + 1}T10-00-00-00${i}Z-private-match-full-game`, {
        summary: summary({ status: "failed", reason: `Battle interaction failed: ${category}`, failure: { category, agent: "player-bravo" } }),
      });
      const r = (await scanRunDir(root, config(dir), NOW)).report;
      expect(rules(r)).toEqual([`interaction-${category}`]);
      expect(r.findings[0]).toMatchObject({ player: "bravo", severity: "high", category: category === "turn-state-timeout" ? "timeout" : "interaction" });
    }
  });

  it("ignores an interaction category outside the runner contract", async () => {
    const r = await analyze({ summary: summary({ status: "failed", reason: "x", failure: { category: "made-up" } }) });
    expect(rules(r)).toEqual(["run-failed"]);
  });

  it("flags a completed run that recorded error signals", async () => {
    const r = await analyze({
      summary: summary(),
      console: [{ agent: "player-alpha", kind: "console-error", text: "oops" }],
      network: [{ agent: "player-alpha", kind: "http-error", method: "GET", url: "https://x.example.com/a", status: 500 }],
    });
    const finding = r.findings.find((f) => f.ruleId === "completed-with-error-signals");
    expect(finding).toMatchObject({ category: "completed-with-errors", severity: "medium" });
    expect(finding?.message).toContain("error signals (2)");
  });

  it("does not flag a clean completed run, nor one whose only noise was ignored", async () => {
    const r = await analyze({
      summary: summary(),
      network: [{ agent: "player-alpha", kind: "request-failed", method: "GET", url: "https://x.example.com/a", failure: "net::ERR_ABORTED" }],
    });
    expect(r.findings).toEqual([]);
    expect(r.status).toBe("completed");
  });
});

describe("observed error: he is not a function", () => {
  it("is reported only when present in approved redacted page-error input", async () => {
    const r = await analyze({
      summary: summary(),
      console: [
        { at: "2026-10-01T10:01:00.000Z", agent: "player-alpha", kind: "page-error", text: "TypeError: he is not a function" },
        { at: "2026-10-01T10:02:00.000Z", agent: "player-alpha", kind: "page-error", text: "TypeError: he is not a function" },
      ],
    });
    const known = r.findings.filter((f) => f.ruleId === "known-he-not-a-function");
    expect(known).toHaveLength(1);
    expect(known[0]).toMatchObject({ category: "page-error", severity: "high", count: 2, evidence: [{ file: "console.jsonl", line: 1 }, { file: "console.jsonl", line: 2 }] });
  });

  it("is never inferred from other errors, summaries, events or network records", async () => {
    const r = await analyze({
      summary: summary({ status: "failed", reason: "he is not a function" }),
      events: [event({ activity: "he is not a function" })],
      console: [{ agent: "player-alpha", kind: "page-error", text: "TypeError: x is not a function" }],
      network: [{ agent: "player-alpha", kind: "request-failed", method: "GET", url: "https://x.example.com/he", failure: "he is not a function" }],
    });
    expect(rules(r)).not.toContain("known-he-not-a-function");
    expect(rules(r)).toContain("page-error");
  });

  it("is reported from console-error input too, keeping the console category", async () => {
    const r = await analyze({ summary: summary(), console: [{ agent: "player-bravo", kind: "console-error", text: "Uncaught TypeError: he is not a function" }] });
    expect(r.findings.find((f) => f.ruleId === "known-he-not-a-function")).toMatchObject({ category: "console-error", player: "bravo" });
  });
});

describe("repeated findings", () => {
  it("aggregates equivalent findings across runs and ignores differing digits", async () => {
    const page = (n: number) => ({ agent: "player-alpha", kind: "page-error", text: `TypeError: he is not a function (line ${n})` });
    const a = (await scanRunDir(await makeRun(dir, runName(1), { summary: summary(), console: [page(10), page(10)] }), config(dir), NOW)).report;
    const b = (await scanRunDir(await makeRun(dir, runName(2), { summary: summary(), console: [page(77)] }), config(dir), NOW)).report;
    const c = (await scanRunDir(await makeRun(dir, runName(3), { summary: summary() }), config(dir), NOW)).report;
    const { findRepeated } = await import("../src/observer/analyze.js");
    const repeated = findRepeated([a, b, c]);
    const he = repeated.find((r) => r.ruleId === "known-he-not-a-function");
    expect(he).toMatchObject({ runs: 2, occurrences: 3 });
    expect(he?.runIds).toEqual([runName(1), runName(2)]);
    // "completed-with-error-signals" repeats too (count digits are normalized)
    expect(repeated.some((r) => r.ruleId === "completed-with-error-signals")).toBe(true);
  });

  it("does not report a finding seen in one run only", async () => {
    const { findRepeated } = await import("../src/observer/analyze.js");
    const a = (await scanRunDir(await makeRun(dir, runName(1), { summary: summary({ status: "failed", reason: "x" }) }), config(dir), NOW)).report;
    expect(findRepeated([a])).toEqual([]);
  });
});
