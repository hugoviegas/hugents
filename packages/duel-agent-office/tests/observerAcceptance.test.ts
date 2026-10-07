import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_CSS, APP_JS, INDEX_HTML } from "../src/observer/dashboardAssets.js";
import { buildDashboardState, startDashboard } from "../src/observer/dashboard.js";
import { parseFindingsReport } from "../src/observer/schema.js";
import { observe, scanArtifactRoot } from "../src/observer/scan.js";
import { config, event, makeRun, NOW, PNG, summary } from "./observerFixtures.js";

/** Acceptance audit for #96 / PR #97: one synthetic artifact root with every case, checked end to end. */
let dir: string;
let server: Server | undefined;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-acceptance-"));
});
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

// Values that must never appear in findings.json, the dashboard state or any dashboard response.
const FORBIDDEN = [
  "qa.player@example.com", // e-mail
  "Zk3pQ9vL2mX8nR4tY7wB1cD5eF6g", // UID-like
  "xk29qa", // room code
  "eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop12345", // token
  "qa-private-preview.vercel.app", // private URL host
  "gsessionid=SECRETSESSION", // query secret
  "CANARY-TRACE-VIDEO-ENV", // content of forbidden files
];
const SENSITIVE_PATTERNS = [/https?:\/\//, /@[a-z0-9.-]+\.[a-z]{2,}/i, /\?[a-z_]+=/i, /bearer\s+(?!\[redacted\])\S/i,/\bey[A-Za-z0-9_-]{10,}/];

const noisy = {
  console: [
    { at: "2026-10-01T10:01:00.000Z", agent: "player-alpha", kind: "console-error", text: "Login for qa.player@example.com uid Zk3pQ9vL2mX8nR4tY7wB1cD5eF6g failed" },
    { at: "2026-10-01T10:02:00.000Z", agent: "player-bravo", kind: "page-error", text: "Código da sala: xk29qa Bearer eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop12345" },
  ],
  network: [
    { at: "2026-10-01T10:03:00.000Z", agent: "player-alpha", kind: "http-error", method: "GET", url: "https://qa-private-preview.vercel.app/api/rooms/xk29qa?gsessionid=SECRETSESSION", status: 404 },
    { at: "2026-10-01T10:04:00.000Z", agent: "player-bravo", kind: "http-error", method: "POST", url: "https://qa-private-preview.vercel.app/api/x", status: 502 },
    { at: "2026-10-01T10:05:00.000Z", agent: "player-alpha", kind: "request-failed", method: "GET", url: "https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?gsessionid=SECRETSESSION", failure: "net::ERR_CONNECTION_RESET" },
    { at: "2026-10-01T10:05:01.000Z", agent: "player-alpha", kind: "request-failed", method: "GET", url: "https://qa-private-preview.vercel.app/a", failure: "net::ERR_ABORTED" },
    { at: "2026-10-01T10:05:02.000Z", agent: "player-alpha", kind: "request-failed", method: "HEAD", url: "https://qa-private-preview.vercel.app/b", failure: "net::ERR_ABORTED" },
  ],
};

async function seedAll() {
  const sensitiveFiles = {
    "alpha/trace.zip": "CANARY-TRACE-VIDEO-ENV",
    "bravo/video/session.webm": "CANARY-TRACE-VIDEO-ENV",
    ".env": "QA_ALPHA_PASSWORD=CANARY-TRACE-VIDEO-ENV",
    "network-raw-payload.json": "CANARY-TRACE-VIDEO-ENV",
    "alpha/99-unredacted.png": PNG,
  };
  // 1: clean completed run with outcome, ignored aborted requests, an approved screenshot
  await makeRun(dir, "2026-10-01T10-00-00-001Z-private-match-full-game", {
    summary: summary({ result: { outcome: { alpha: "win", bravo: "loss" }, turns: { alpha: 10, bravo: 10 } } }),
    events: [
      event({ agent: "player-alpha", status: "working", activity: "Login screen visible", artifactPath: "alpha/01-login-screen.png" }),
      event({ agent: "player-alpha", status: "completed", activity: "Finished: win after 10 turns" }),
      event({ agent: "player-bravo", status: "completed", activity: "Finished: loss after 10 turns" }),
    ],
    network: noisy.network.slice(3),
    files: { ...sensitiveFiles, "alpha/01-login-screen.png": PNG },
  });
  // 2: completed with console error + page error + 4xx + 5xx + relevant network failure (sensitive text everywhere)
  await makeRun(dir, "2026-10-02T10-00-00-002Z-private-match-full-game", { summary: summary(), ...noisy, files: sensitiveFiles });
  // 3: timeout   4: blocked   5: failed
  await makeRun(dir, "2026-10-03T10-00-00-003Z-private-match-full-game", { summary: summary({ status: "failed", reason: "Scenario timeout reached" }) });
  await makeRun(dir, "2026-10-04T10-00-00-004Z-private-match-full-game", { summary: summary({ status: "blocked", blockedOn: "missing-precondition", reason: "Lobby refused to create a room" }) });
  await makeRun(dir, "2026-10-05T10-00-00-005Z-private-match-full-game", { summary: summary({ status: "failed", reason: "No verified selector for: Criar sala" }) });
  // 6,7: the observed error, twice (repeated), plus one run where the same words are NOT in approved input
  const he = { agent: "player-alpha", kind: "page-error", text: "TypeError: he is not a function" };
  await makeRun(dir, "2026-10-06T10-00-00-006Z-private-match-full-game", { summary: summary(), console: [{ ...he, at: "2026-10-06T10:01:00.000Z" }] });
  await makeRun(dir, "2026-10-07T10-00-00-007Z-private-match-full-game", { summary: summary(), console: [{ ...he, at: "2026-10-07T10:01:00.000Z" }] });
  await makeRun(dir, "2026-10-08T10-00-00-008Z-private-match-full-game", { summary: summary({ reason: "he is not a function" }), events: [event({ activity: "he is not a function" })] });
  // 9: malformed JSON in every input
  await makeRun(dir, "2026-10-09T10-00-00-009Z-private-match-full-game", { summary: "{oops", events: "garbage\n", console: "{broken", network: "not json\n[1]\n", files: sensitiveFiles });
}

const ruleSet = (report: { runs: { runId: string; findings: { ruleId: string }[] }[] }, n: number) =>
  report.runs.find((r) => r.runId.startsWith(`2026-10-0${n}T`))?.findings.map((f) => f.ruleId) ?? [];

function get(port: number, pathname: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: pathname, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("acceptance: synthetic artifact root", () => {
  it("produces the expected finding in every category, versioned and schema-valid", async () => {
    await seedAll();
    const { report } = await observe(config(dir), { now: NOW, dryRun: true });
    expect(report.schemaVersion).toBe(1);
    expect(parseFindingsReport(JSON.parse(JSON.stringify(report))).ok).toBe(true);

    expect(ruleSet(report, 1)).toEqual([]); // clean run; two ERR_ABORTED ignored
    expect(report.runs[0]?.ignored.networkFailures).toBe(2);
    expect(ruleSet(report, 2)).toEqual(
      expect.arrayContaining(["console-error", "page-error", "http-4xx", "http-5xx", "network-failure", "completed-with-error-signals"]),
    );
    expect(report.runs[1]?.ignored.networkFailures).toBe(2); // ERR_ABORTED counted, not emitted
    expect(ruleSet(report, 2).filter((r) => r === "network-failure")).toHaveLength(1);
    expect(ruleSet(report, 3)).toEqual(["run-timeout"]);
    expect(ruleSet(report, 4)).toEqual(["run-blocked"]);
    expect(ruleSet(report, 5)).toEqual(["run-failed"]);
    expect(ruleSet(report, 6)).toEqual(["known-he-not-a-function", "completed-with-error-signals"]);
    expect(ruleSet(report, 8)).toEqual([]); // words only in summary/events: not reported
    expect(ruleSet(report, 9)).toEqual(["run-incomplete", "input-unreadable"]);

    const heRepeat = report.repeated.find((r) => r.ruleId === "known-he-not-a-function");
    expect(heRepeat).toMatchObject({ runs: 2, occurrences: 2 });
    expect(report.totals.byStatus).toMatchObject({ completed: 5, blocked: 1, failed: 3 });
  });

  it("represents status and outcome safely, and ignores an invalid or injected result", async () => {
    await seedAll();
    await makeRun(dir, "2026-10-10T10-00-00-010Z-private-match-full-game", {
      summary: summary({ result: { outcome: { alpha: "qa.player@example.com", bravo: "win" }, turns: { alpha: 3, bravo: 3 } } }),
    });
    await makeRun(dir, "2026-10-11T10-00-00-011Z-private-match-full-game", {
      summary: summary({ result: { outcome: { alpha: "draw", bravo: "draw" }, turns: { alpha: -1, bravo: 2.5 } } }),
    });
    const { report } = await observe(config(dir), { now: NOW, dryRun: true });
    expect(report.runs[0]).toMatchObject({ status: "completed", result: { outcome: { alpha: "win", bravo: "loss" }, turns: { alpha: 10, bravo: 10 } } });
    expect(report.runs.find((r) => r.runId.startsWith("2026-10-10"))?.result).toBeUndefined();
    expect(report.runs.find((r) => r.runId.startsWith("2026-10-11"))?.result).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain("qa.player@example.com");
  });

  it("keeps findings.json, dashboard state and live dashboard responses free of sensitive values", async () => {
    await seedAll();
    const written = await observe(config(dir), { now: NOW });
    const fileText = await readFile(written.target, "utf8");
    const scanned = await scanArtifactRoot(config(dir), NOW);
    const stateText = JSON.stringify(buildDashboardState(scanned, config(dir), NOW));

    const started = await startDashboard(config(dir));
    server = started.server;
    const live = [await get(started.port, "/"), await get(started.port, "/app.js"), await get(started.port, "/app.css"), await get(started.port, "/api/state")].map((b) => b.toString());

    for (const [label, text] of [["findings.json", fileText], ["dashboard state", stateText], ...live.map((t, i) => [`live response ${i}`, t] as const)] as const) {
      for (const value of FORBIDDEN) expect(text, `${label}: ${value}`).not.toContain(value);
      for (const pattern of SENSITIVE_PATTERNS) expect(text, `${label}: ${pattern}`).not.toMatch(pattern);
    }
    // the approved screenshot is served, the unreferenced / forbidden files are not reachable
    const state = JSON.parse(live[3] as string) as { runs: { screenshots: { url: string }[] }[] };
    const shotUrl = state.runs.flatMap((r) => r.screenshots).map((s) => s.url);
    expect(shotUrl).toHaveLength(1);
    expect((await get(started.port, shotUrl[0] as string)).equals(PNG)).toBe(true);
    for (const bad of ["/alpha/trace.zip", "/.env", "/network-raw-payload.json", "/alpha/99-unredacted.png"]) {
      expect((await get(started.port, bad)).toString()).not.toContain("CANARY");
    }
  });
});

describe("acceptance: dashboard has no hardcoded run data", () => {
  it("static assets contain no run ids, players, outcomes or game data", () => {
    // Design token names (`--agent-alpha`, the design system's identity colors) are styling, not run data.
    const assets = `${INDEX_HTML}\n${APP_JS}\n${APP_CSS}`.replace(/--[\w-]+/g, "--token");
    expect(assets).not.toMatch(/\d{4}-\d{2}-\d{2}T|private-match|player-(alpha|bravo)|\b(alpha|bravo)\b|\bwin\b|\bloss\b|\bdraw\b|Tiro|Desvio|Recarga|\bturns?\b/i);
  });

  it("renders only what the artifact root contains: empty root, then a differently named run", async () => {
    expect(buildDashboardState(await scanArtifactRoot(config(dir), NOW), config(dir), NOW).runs).toEqual([]);
    await makeRun(dir, "2031-05-17T08-30-00-123Z-other-scenario", {
      summary: summary({ scenario: "other-scenario", status: "blocked", blockedOn: "target-guard", reason: "x" }),
      events: [event({ agent: "player-bravo", status: "blocked", activity: "Totally different activity" })],
    });
    const state = buildDashboardState(await scanArtifactRoot(config(dir), NOW), config(dir), NOW);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({
      runId: "2031-05-17T08-30-00-123Z-other-scenario",
      status: "blocked",
      players: [{ player: "bravo", status: "blocked", activity: "Totally different activity" }],
    });
  });
});
