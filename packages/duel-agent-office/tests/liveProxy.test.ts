import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRelay, resolveConfig, type Relay } from "@hugents/live";
import { startDashboard } from "../src/observer/dashboard.js";
import { config } from "./observerFixtures.js";

const VT = "viewer-token-0123456789";
let dir: string;
let server: Server | undefined;
let relay: Relay | undefined;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-live-proxy-"));
});
afterEach(async () => {
  await relay?.stop();
  relay = undefined;
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

const getJson = async (port: number, p: string) => {
  const res = await fetch(`http://127.0.0.1:${port}${p}`);
  return { status: res.status, text: await res.text() };
};

describe("dashboard /api/live proxy", () => {
  it("reports the live view as off when it is not configured", async () => {
    const s = await startDashboard(config(dir));
    server = s.server;
    expect(JSON.parse((await getJson(s.port, "/api/live/status")).text)).toEqual({ enabled: false });
    expect((await getJson(s.port, "/api/live/stream")).status).toBe(404);
  });

  it("reports relay offline when the relay does not answer", async () => {
    const s = await startDashboard(config(dir), undefined, undefined, { live: { relayUrl: "http://127.0.0.1:1", viewerToken: VT } });
    server = s.server;
    expect(JSON.parse((await getJson(s.port, "/api/live/status")).text)).toEqual({ enabled: true, relay: "offline" });
  });

  it("proxies status with the viewer token kept server side, rejects bad params and cross-site streams", async () => {
    relay = createRelay({ viewerToken: VT, workerToken: "worker-token-0123456789", config: resolveConfig("high") });
    const rp = await relay.start();
    relay.beginRun({ runId: "r1", agentId: "player-alpha", status: "working", phase: "match", startedAt: "2026-01-01T00:00:00.000Z" });
    const s = await startDashboard(config(dir), undefined, undefined, { live: { relayUrl: `http://127.0.0.1:${rp}`, viewerToken: VT } });
    server = s.server;
    const status = await getJson(s.port, "/api/live/status");
    expect(JSON.parse(status.text)).toMatchObject({ enabled: true, relay: "up", run: { runId: "r1" } });
    for (const p of ["/", "/app.js", "/app.css", "/api/state", "/api/live/status"]) expect((await getJson(s.port, p)).text).not.toContain(VT);
    expect((await getJson(s.port, "/api/live/stream?player=../x")).status).toBe(400);
    expect((await getJson(s.port, "/api/live/stream?quality=ultra")).status).toBe(400);
    const cross = await fetch(`http://127.0.0.1:${s.port}/api/live/stream`, { headers: { "sec-fetch-site": "cross-site" } });
    expect(cross.status).toBe(400);
    const post = await fetch(`http://127.0.0.1:${s.port}/api/live/stream`, { method: "POST" });
    expect(post.status).toBeGreaterThanOrEqual(400);
  });
});
