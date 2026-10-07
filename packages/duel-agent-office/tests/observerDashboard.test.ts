import { readdir, readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDashboardState, createDashboardServer, startDashboard } from "../src/observer/dashboard.js";
import { scanArtifactRoot } from "../src/observer/scan.js";
import { config, event, makeRun, NOW, PNG, runName, summary } from "./observerFixtures.js";

let dir: string;
let server: Server | undefined;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-observer-"));
});
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

const SENSITIVE = [
  "owner@example.com",
  "xk29qa",
  "qa-secret-preview.vercel.app",
  "eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop12345",
  "token=abc",
  "trace.zip",
  "CANARY-RAW",
];

async function seedSensitive() {
  await makeRun(dir, runName(1), {
    summary: summary({ status: "failed", reason: "Failed at https://qa-secret-preview.vercel.app/online?room=xk29qa for owner@example.com" }),
    events: [
      event({ agent: "player-alpha", status: "working", activity: "Opened https://qa-secret-preview.vercel.app/online?token=abc", artifactPath: "alpha/01-login-screen.png" }),
    ],
    console: [{ agent: "player-alpha", kind: "console-error", text: "Bearer eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop12345 owner@example.com" }],
    network: [{ agent: "player-bravo", kind: "http-error", method: "GET", url: "https://qa-secret-preview.vercel.app/api/rooms/xk29qa?token=abc", status: 500 }],
    files: { "alpha/01-login-screen.png": PNG, "alpha/trace.zip": "CANARY-RAW", "raw.json": "CANARY-RAW" },
  });
}

function get(port: number, pathname: string, host = `127.0.0.1:${port}`, method = "GET") {
  return new Promise<{ status: number; body: Buffer; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: pathname, method, headers: { host } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("dashboard data", () => {
  it("contains no secrets, room codes, e-mails, tokens, full URLs or forbidden artifact names", async () => {
    await seedSensitive();
    const state = buildDashboardState(await scanArtifactRoot(config(dir), NOW), config(dir), NOW);
    const text = JSON.stringify(state);
    for (const value of SENSITIVE) expect(text, value).not.toContain(value);
    expect(text).not.toMatch(/https?:\/\//);
    expect(state.runs[0]?.screenshots).toEqual([{ url: `/shot/${runName(1)}/0`, player: "alpha", label: "login screen" }]);
    expect(state.runs[0]?.players.map((p) => p.player)).toEqual(["alpha"]);
    expect(state.runs[0]?.findings.map((f) => f.evidence[0]?.file)).toEqual(expect.arrayContaining(["network-failures.jsonl", "console.jsonl", "summary.json"]));
  });

  it("shows status, latest activity and finding counts per run, newest first", async () => {
    await makeRun(dir, runName(1), { summary: summary() });
    await makeRun(dir, runName(2), { summary: summary({ status: "blocked", blockedOn: "target-guard", reason: "x" }), events: [event({ agent: "player-bravo", status: "blocked", activity: "Public switch is on" })] });
    const state = buildDashboardState(await scanArtifactRoot(config(dir), NOW), config(dir), NOW);
    expect(state.runs.map((r) => r.status)).toEqual(["blocked", "completed"]);
    expect(state.runs[0]?.players).toEqual([{ player: "bravo", status: "blocked", activity: "Public switch is on", at: "2026-10-01T10:00:01.000Z" }]);
    expect(state.totals.byStatus).toEqual({ blocked: 1, completed: 1 });
  });

  it("passes an event time only when it is a plain ISO timestamp", async () => {
    await makeRun(dir, runName(1), { summary: summary(), events: [event({ agent: "player-alpha", at: "owner@example.com" }), event({ agent: "player-bravo" })] });
    const state = buildDashboardState(await scanArtifactRoot(config(dir), NOW), config(dir), NOW);
    const players = state.runs[0]?.players ?? [];
    expect(players.find((p) => p.player === "alpha")).not.toHaveProperty("at");
    expect(players.find((p) => p.player === "bravo")?.at).toBe("2026-10-01T10:00:01.000Z");
    expect(JSON.stringify(state)).not.toContain("owner@example.com");
  });
});

describe("dashboard page (Agent Office design)", () => {
  it("ships the design tokens, the bullpen world and no inline styles or external resources", async () => {
    const started = await startDashboard(config(dir));
    server = started.server;
    const page = (await get(started.port, "/")).body.toString();
    const css = (await get(started.port, "/app.css")).body.toString();
    expect(page).toContain("<title>Agent Office</title>");
    // The room shell plus the layers the page fills from the layout, and one sprite per prop type and character.
    for (const id of ["world-svg", "props", "grid", "ghost", "sprites"]) expect(page).toContain(`id="${id}"`);
    for (const sprite of ["desk", "plant", "cabinet", "bookshelf", "rug", "char-1", "char-2", "char-3", "char-4"]) expect(page).toContain(`data-sprite="${sprite}"`);
    // CSP is style-src 'self': inline style attributes would be dropped by the browser.
    expect(page).not.toMatch(/\sstyle=/);
    expect(css).toContain('[data-theme="night"]');
    expect(css).toMatch(/--accent-primary: #4DBFB2;/);
    expect(css).not.toMatch(/url\(|@import|https?:/);
  });
});

describe("dashboard server", () => {
  it("binds to loopback only, serves state and the approved screenshot, and nothing else", async () => {
    await seedSensitive();
    const started = await startDashboard(config(dir));
    server = started.server;
    const address = started.server.address() as AddressInfo;
    expect(address.address).toBe("127.0.0.1");
    const { port } = started;

    const page = await get(port, "/");
    expect(page.status).toBe(200);
    expect(String(page.headers["content-security-policy"])).toContain("default-src 'none'");
    expect(page.body.toString()).not.toMatch(/innerHTML|https?:\/\//);
    expect((await get(port, "/app.js")).body.toString()).not.toContain("innerHTML");

    const state = await get(port, "/api/state");
    expect(state.status).toBe(200);
    for (const value of SENSITIVE) expect(state.body.toString(), value).not.toContain(value);

    const shot = await get(port, `/shot/${runName(1)}/0`);
    expect(shot.status).toBe(200);
    expect(shot.headers["content-type"]).toBe("image/png");
    expect(shot.body.equals(PNG)).toBe(true);

    for (const bad of [`/shot/${runName(1)}/1`, "/shot/..%2F..%2F.env/0", `/shot/${runName(1)}/..%2Falpha%2Ftrace.zip`, "/summary.json", "/alpha/trace.zip", "/.env", "/artifacts/runs"]) {
      const r = await get(port, bad);
      expect(r.status, bad).toBe(404);
      expect(r.body.toString()).not.toContain("CANARY-RAW");
    }
  });

  it("rejects non-GET methods and foreign Host headers (DNS rebinding)", async () => {
    const started = await startDashboard(config(dir));
    server = started.server;
    expect((await get(started.port, "/api/state", "evil.example.com")).status).toBe(403);
    expect((await get(started.port, "/api/state", `evil.example.com:${started.port}`)).status).toBe(403);
    expect((await get(started.port, "/api/state", `localhost:${started.port}`)).status).toBe(200);
    expect((await get(started.port, "/api/state", undefined, "POST")).status).toBe(405);
  });

  it("is only created, never listening, until startDashboard is called", () => {
    const idle = createDashboardServer(config(dir));
    expect(idle.listening).toBe(false);
  });
});

describe("dashboard is separate from the runner", () => {
  it("is not imported or started by any runner module, and has its own explicit npm script", async () => {
    const runnerFiles: string[] = [];
    const walk = async (rel: string) => {
      for (const entry of await readdir(path.join(process.cwd(), rel), { withFileTypes: true })) {
        const next = `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          // src/office (issue #98) is the agent layer on top of the runner: it reads the observer and serves a loopback bridge.
          if (entry.name !== "observer" && entry.name !== "office") await walk(next);
        } else if (entry.name.endsWith(".ts") && !/^(observerCli|dashboardCli|officeCli)\.ts$/.test(entry.name)) runnerFiles.push(next);
      }
    };
    await walk("src");
    expect(runnerFiles.length).toBeGreaterThan(10);
    for (const file of runnerFiles) {
      const code = await readFile(path.join(process.cwd(), file), "utf8");
      expect(code, file).not.toMatch(/observer|dashboard/i);
      expect(code, file).not.toMatch(/createServer|\.listen\(/);
      // The dependency only points one way: the agent layer uses the runner, never the other way round.
      expect(code, file).not.toMatch(/from\s+["'][^"']*\/office\//);
    }
    const pkg = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["agent:dashboard"]).toBe("tsx src/dashboardCli.ts");
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      if (name.startsWith("agent:private-match")) expect(cmd).not.toMatch(/dashboard|observ/);
    }
  });
});
