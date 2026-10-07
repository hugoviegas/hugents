import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { networkInterfaces } from "node:os";
import { BIND_HOST, createRelay, type Relay } from "../src/relay.js";
import { resolveConfig, type LiveFrame } from "../src/frame.js";
import { fakeJpeg } from "./helpers.js";

const config = resolveConfig("low");
const VT = "viewer-secret";
const WT = "worker-secret";
let relay: Relay | undefined;
afterEach(async () => {
  await relay?.stop();
  relay = undefined;
});

const frame = (seq: number, over: Partial<LiveFrame> = {}): LiveFrame => ({
  runId: "run1",
  agentId: "player-alpha",
  player: "alpha",
  seq,
  at: "2026-01-01T00:00:00.000Z",
  width: 320,
  height: 180,
  jpeg: fakeJpeg(320, 180, `f${seq}`).toString("base64"),
  gate: { state: "visible" },
  ...over,
});

function req(port: number, o: { method?: string; path: string; headers?: Record<string, string>; body?: string; hostHeader?: string }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const r = http.request(
      { host: "127.0.0.1", port, method: o.method ?? "GET", path: o.path, headers: { host: o.hostHeader ?? `127.0.0.1:${port}`, ...o.headers } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    r.on("error", reject);
    r.end(o.body);
  });
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function start(extra = {}) {
  relay = createRelay({ viewerToken: VT, workerToken: WT, config, ...extra });
  const port = await relay.start();
  relay.beginRun({ runId: "run1", agentId: "player-alpha", status: "working", phase: "play", startedAt: "2026-01-01T00:00:00.000Z" });
  return port;
}

function openStream(port: number, player = "alpha", quality = "") {
  const chunks: string[] = [];
  const r = http.request({ host: "127.0.0.1", port, path: `/viewer/stream?player=${player}${quality ? `&quality=${quality}` : ""}`, headers: auth(VT) }, (res) => {
    res.on("data", (c) => chunks.push(String(c)));
  });
  r.end();
  return { chunks, close: () => r.destroy() };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("relay", () => {
  it("binds to loopback only", async () => {
    const port = await start();
    expect(BIND_HOST).toBe("127.0.0.1");
    const external = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
    if (external) {
      const err = await new Promise<NodeJS.ErrnoException>((res) => http.get({ host: external.address, port, path: "/", timeout: 1000 }).on("error", res));
      expect(err.code).toBe("ECONNREFUSED");
    }
  });

  it("rejects an unexpected Host and unexpected Origin", async () => {
    const port = await start();
    expect((await req(port, { path: "/viewer/status", headers: auth(VT), hostHeader: "evil.example" })).status).toBe(403);
    expect((await req(port, { path: "/viewer/status", headers: { ...auth(VT), origin: "http://evil.example" } })).status).toBe(403);
  });

  it("requires the viewer login and rejects any input", async () => {
    const port = await start();
    expect((await req(port, { path: "/viewer/status" })).status).toBe(401);
    expect((await req(port, { path: "/viewer/status", headers: auth("wrong") })).status).toBe(401);
    for (const method of ["POST", "PUT", "DELETE"]) {
      expect((await req(port, { method, path: "/viewer/input", headers: auth(VT), body: '{"type":"click","x":1,"y":1}' })).status).toBe(403);
    }
  });

  it("accepts worker frames only with the worker token and validates them", async () => {
    const port = await start();
    const body = JSON.stringify(frame(0));
    expect((await req(port, { method: "POST", path: "/worker/frame", body })).status).toBe(401);
    expect((await req(port, { method: "POST", path: "/worker/frame", headers: auth(VT), body })).status).toBe(401);
    expect((await req(port, { method: "POST", path: "/worker/frame", headers: auth(WT), body: "{}" })).status).toBe(400);
    const ok = await req(port, { method: "POST", path: "/worker/frame", headers: auth(WT), body });
    expect(JSON.parse(ok.body)).toEqual({ wanted: false, accepted: false }); // nobody watching: not wanted
    const huge = JSON.stringify(frame(1, { jpeg: "A".repeat(2_000_000) }));
    expect((await req(port, { method: "POST", path: "/worker/frame", headers: auth(WT), body: huge })).status).toBe(413);
  });

  it("streams frames to a viewer, with a bounded latest-frame buffer", async () => {
    const port = await start();
    const s = openStream(port);
    await wait(50);
    expect(relay!.hasViewer()).toBe(true);
    for (let i = 0; i < 50; i++) relay!.publish(frame(i));
    await wait(50);
    expect(s.chunks.join("")).toContain("event: frame");
    s.close();
    await wait(50);
    expect(relay!.hasViewer()).toBe(false);
    // a late viewer gets only the latest frame, not a backlog
    const late = openStream(port);
    await wait(50);
    const frames = late.chunks.join("").split("event: frame").length - 1;
    expect(frames).toBe(1);
    expect(late.chunks.join("")).toContain('"seq":49');
    late.close();
  });

  it("keeps one frame per player while a viewer stalls", async () => {
    const port = await start();
    // A viewer that never reads: its socket fills and writableNeedDrain flips.
    const sock = http.request({ host: "127.0.0.1", port, path: "/viewer/stream", headers: auth(VT) });
    sock.on("response", (res) => res.pause());
    sock.end();
    await wait(50);
    const big = frame(0, { jpeg: fakeJpeg(320, 180, "x".repeat(150_000)).toString("base64") });
    let accepted = 0;
    for (let i = 0; i < 200; i++) if (relay!.publish({ ...big, seq: i })) accepted++;
    expect(accepted).toBe(200); // every publish returns at once; the buffer still holds one frame per player
    sock.destroy();
  });

  it("clears frames when the run ends and refuses frames for other runs", async () => {
    const port = await start();
    expect(relay!.publish(frame(0, { runId: "other" }))).toBe(false);
    relay!.publish(frame(0));
    relay!.endRun("run1", "completed");
    expect(relay!.publish(frame(1))).toBe(false);
    const st = JSON.parse((await req(port, { path: "/viewer/status", headers: auth(VT) })).body);
    expect(st.run).toBeNull();
    expect(st.players).toEqual([]);
    expect(st.lastRun.status).toBe("completed");
  });

  it("lets the worker announce the run over HTTP and ask whether anyone watches", async () => {
    relay = createRelay({ viewerToken: VT, workerToken: WT, config });
    const port = await relay.start();
    const post = (body: unknown, token = WT) => req(port, { method: "POST", path: "/worker/run", headers: auth(token), body: JSON.stringify(body) });
    expect((await post({ action: "begin", runId: "r9", agentId: "player-alpha" }, VT)).status).toBe(401);
    expect((await post({ action: "begin", runId: "bad id!", agentId: "player-alpha" })).status).toBe(400);
    expect((await post({ action: "begin", runId: "r9", agentId: "player-alpha" })).status).toBe(200);
    expect(JSON.parse((await req(port, { path: "/worker/wanted", headers: auth(WT) })).body)).toEqual({ wanted: false });
    const s = openStream(port);
    await wait(50);
    expect(JSON.parse((await req(port, { path: "/worker/wanted", headers: auth(WT) })).body)).toEqual({ wanted: true, preset: "medium" });
    s.close();
    expect((await post({ action: "end", runId: "r9", status: "failed" })).status).toBe(200);
    const st = JSON.parse((await req(port, { path: "/viewer/status", headers: auth(VT) })).body);
    expect(st).toMatchObject({ run: null, lastRun: { status: "failed" } });
  });

  it("tells the worker the lowest quality any viewer asked for", async () => {
    const port = await start();
    const preset = async () => JSON.parse((await req(port, { path: "/worker/wanted", headers: auth(WT) })).body).preset;
    expect(await preset()).toBeUndefined();
    const a = openStream(port, "alpha", "high");
    await wait(50);
    expect(await preset()).toBe("high");
    const b = openStream(port, "bravo", "low");
    await wait(50);
    expect(await preset()).toBe("low");
    b.close();
    await wait(50);
    expect(await preset()).toBe("high");
    a.close();
  });
});
