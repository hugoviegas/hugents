import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvedScreenshots, isForbiddenArtifact, readRunInputs } from "../src/observer/inputs.js";
import { sanitizeText, safeUrlLabel } from "../src/observer/sanitize.js";
import { observe, scanRunDir } from "../src/observer/scan.js";
import { config, event, makeRun, NOW, PNG, runName, summary } from "./observerFixtures.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-observer-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("malformed inputs", () => {
  it("treats a malformed summary as missing, reports it, and falls back to events", async () => {
    const root = await makeRun(dir, runName(1), {
      summary: "{ not json",
      events: [event({ agent: "runner", status: "failed", at: "2026-10-01T10:00:01.000Z" })],
    });
    const inputs = await readRunInputs(root, runName(1));
    expect(inputs.summary).toBeUndefined();
    expect(inputs.issues.malformedSummary).toBe(true);
    const run = (await scanRunDir(root, config(dir), NOW)).report;
    expect(run.status).toBe("failed");
    expect(run.findings.some((f) => f.ruleId === "input-unreadable" && f.category === "input")).toBe(true);
  });

  it("rejects a summary with an unknown status or a non-object body", async () => {
    for (const body of ['{"status":"weird"}', "[]", "null", '"completed"']) {
      const root = await makeRun(dir, runName(2), { summary: body });
      expect((await readRunInputs(root, runName(2))).issues.malformedSummary).toBe(true);
    }
  });

  it("skips malformed JSONL lines and invalid records but keeps the valid ones", async () => {
    const root = await makeRun(dir, runName(1), {
      summary: summary(),
      events: `${JSON.stringify(event())}\nnot json\n${JSON.stringify({ agent: "intruder", status: "working", at: "x", activity: "y" })}\n`,
      console: `{"kind":"console-error","text":"ok","agent":"player-alpha"}\n{"kind":"mystery","text":"x"}\n[1,2]\n{broken`,
      network: `{"kind":"http-error","status":200,"url":"https://x.example.com"}\n{"kind":"http-error","status":404,"method":"GET","url":"https://x.example.com/a","agent":"player-bravo"}\n`,
    });
    const inputs = await readRunInputs(root, runName(1));
    expect(inputs.events).toHaveLength(1);
    expect(inputs.console).toHaveLength(1);
    expect(inputs.network).toHaveLength(1);
    expect(inputs.issues.malformedLines).toBe(2); // "not json" and "{broken"
    expect(inputs.issues.invalidRecords).toBe(4); // intruder agent, mystery kind, [1,2], http 200
  });

  it("handles missing files and empty runs without throwing", async () => {
    const root = await makeRun(dir, runName(1), {});
    const run = (await scanRunDir(root, config(dir), NOW)).report;
    expect(run.status).toBe("failed"); // no summary, no events, no recent activity
    expect(run.findings.map((f) => f.ruleId)).toEqual(["run-incomplete"]);
  });
});

describe("forbidden artifacts", () => {
  const CANARY = "CANARY-SECRET-VALUE-9f3a";

  it("recognizes env files, traces, videos, HAR and keys as forbidden", () => {
    for (const rel of [".env", ".env.local", "alpha/trace.zip", "bravo/video/a.webm", "alpha/session.har", "x/private.pem", "alpha/traces/t.json"]) {
      expect(isForbiddenArtifact(rel), rel).toBe(true);
    }
    expect(isForbiddenArtifact("alpha/01-login-screen.png")).toBe(false);
  });

  it("never opens or reflects traces, videos, env files, raw payloads or unreferenced screenshots", async () => {
    const root = await makeRun(dir, runName(1), {
      summary: summary(),
      events: [event({ agent: "player-alpha", status: "working", activity: "Login screen visible", artifactPath: "alpha/01-login-screen.png" })],
      files: {
        "alpha/01-login-screen.png": PNG,
        "alpha/02-unreferenced.png": PNG,
        "alpha/trace.zip": CANARY,
        "bravo/video/x.webm": CANARY,
        ".env": `TOKEN=${CANARY}`,
        "raw-payload.json": CANARY,
        "network-raw.jsonl": CANARY,
      },
    });
    const scanned = await scanRunDir(root, config(dir), NOW);
    expect(scanned.screenshots.map((s) => s.rel)).toEqual(["alpha/01-login-screen.png"]);
    const result = await observe(config(dir), { runDir: root, now: NOW });
    expect(JSON.stringify(result.report)).not.toContain(CANARY);
    expect(await readFile(result.target, "utf8")).not.toContain(CANARY);
  });

  it("rejects screenshot references to forbidden, traversing, absolute, non-png or symlinked files", async () => {
    const root = await makeRun(dir, runName(1), {
      summary: summary({ evidence: { failureScreenshots: ["../../.env", "alpha/trace.zip", "/etc/passwd", "alpha/03-x.jpg", "alpha/04-link.png", "C:/x/05-a.png"] } }),
      events: [event({ artifactPath: "../.env" }), event({ artifactPath: "bravo/video/06-x.png" })],
      files: { "alpha/trace.zip": "z", "bravo/video/06-x.png": PNG },
    });
    await symlink(path.join(root, "alpha", "trace.zip"), path.join(root, "alpha", "04-link.png")).catch(() => undefined);
    const inputs = await readRunInputs(root, runName(1));
    expect(await approvedScreenshots(root, inputs, 12)).toEqual([]);
  });

  it("applies the screenshot display limit", async () => {
    const files = Object.fromEntries([1, 2, 3, 4].map((n) => [`alpha/0${n}-step.png`, PNG]));
    const root = await makeRun(dir, runName(1), {
      summary: summary(),
      events: [1, 2, 3, 4].map((n) => event({ artifactPath: `alpha/0${n}-step.png` })),
      files,
    });
    const inputs = await readRunInputs(root, runName(1));
    expect(await approvedScreenshots(root, inputs, 2)).toHaveLength(2);
    expect(await approvedScreenshots(root, inputs, 0)).toHaveLength(0);
  });

  it("refuses run directories whose name is not a runner run id", async () => {
    await expect(scanRunDir(path.join(dir, "runs", ".env"), config(dir), NOW)).rejects.toThrow();
    await expect(scanRunDir(path.join(dir, "runs", "nope"), config(dir), NOW)).rejects.toThrow();
  });
});

describe("sanitizing", () => {
  it("strips URLs to a label, e-mails, ids, tokens and room-code-looking text", () => {
    const text = sanitizeText(
      "Fetch https://qa-abc.vercel.app/api/rooms/ab12cd34ef56gh78ij90?token=SECRET failed for owner@example.com uid 0123456789abcdefghij0123 Código da sala: xk29qa end",
    );
    expect(text).not.toMatch(/https?:|vercel|SECRET|owner@|0123456789abcdefghij|xk29qa|\?/);
    expect(text).toContain("end");
  });

  it("reduces URLs to host and a shape without ids or query", () => {
    expect(safeUrlLabel("https://qa-abc.vercel.app/online?room=abc123")).toBe("preview/online");
    expect(safeUrlLabel("https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?gsessionid=zz")).toBe(
      "firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel",
    );
    expect(safeUrlLabel("https://x.example.com/users/1234567/items")).toBe("x.example.com/users/:id/items");
    expect(safeUrlLabel("https://qa-abc.vercel.app/api/rooms/xk29qa/join")).toBe("preview/api/rooms/:id/join");
    expect(safeUrlLabel("not a url")).toBe("[redacted]");
  });
});
