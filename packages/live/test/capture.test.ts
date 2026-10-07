import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { InMemoryStore, createSanitizer } from "@hugents/core";
import { createCapture, jpegSize } from "../src/capture.js";
import { createLiveEmitter, type LiveStage } from "../src/events.js";
import { resolveConfig, type LiveFrame } from "../src/frame.js";
import { createFrameGate } from "../src/gate.js";
import { fakeJpeg, fakePage, manifest } from "./helpers.js";

function setup(screen: () => string | undefined, opts: { viewer?: () => boolean; fps?: number } = {}) {
  const fp = fakePage();
  const frames: LiveFrame[] = [];
  const stages: LiveStage[] = [];
  let clock = 0;
  const gate = createFrameGate(manifest, async () => screen());
  const capture = createCapture({
    page: fp.page,
    gate,
    config: resolveConfig("low", { maxFps: opts.fps ?? 2 }),
    runId: "run1",
    agentId: "player-alpha",
    player: "alpha",
    publish: (f) => frames.push(f),
    hasViewer: opts.viewer ?? (() => true),
    onEvent: (s) => stages.push(s),
    now: () => new Date(Date.UTC(2026, 0, 1) + clock),
  });
  return { ...fp, frames, stages, gate, capture, tick: (ms: number) => (clock += ms) };
}

describe("capture", () => {
  it("reads jpeg dimensions", () => {
    expect(jpegSize(fakeJpeg(320, 200))).toEqual({ width: 320, height: 200 });
    expect(jpegSize(Buffer.from("nope"))).toBeUndefined();
  });

  it("does not capture when nobody watches, and stops when the viewer leaves", async () => {
    const s = setup(() => "home", { viewer: () => false });
    expect(await s.capture.start()).toBe(false);
    expect(s.calls.start).toBe(0);
    let watching = true;
    const t = setup(() => "home", { viewer: () => watching });
    await t.capture.start();
    watching = false;
    await t.push(fakeJpeg(320, 180));
    expect(t.calls.stop).toBe(1);
    expect(t.capture.active).toBe(false);
  });

  it("passes size and quality caps to the screencast and enforces the fps cap", async () => {
    const s = setup(() => "home", { fps: 2 });
    await s.capture.start();
    expect(s.calls.options).toMatchObject({ size: { width: 640, height: 360 }, quality: 40 });
    await s.push(fakeJpeg(320, 180));
    s.tick(100);
    await s.push(fakeJpeg(320, 180)); // too soon for 2 fps
    s.tick(600);
    await s.push(fakeJpeg(320, 180));
    expect(s.frames.map((f) => f.seq)).toEqual([0, 1]);
  });

  it("drops frames above the size cap", async () => {
    const s = setup(() => "home");
    await s.capture.start();
    await s.push(fakeJpeg(1280, 720));
    expect(s.frames).toHaveLength(0);
  });

  it("sends a pixel-free placeholder on a hidden screen and never leaks seeded text", async () => {
    let screen: string | undefined = "login";
    const s = setup(() => screen);
    await s.capture.start();
    const secret = "tester@example.invalid ROOMCODE-1234 https://example.invalid/t?token=abc";
    await s.push(fakeJpeg(320, 180, secret));
    s.tick(1000);
    screen = "home";
    await s.push(fakeJpeg(320, 180, "synthetic-visible"));
    expect(s.frames[0]).toMatchObject({ jpeg: "", width: 0, gate: { state: "hidden", reason: "hidden-screen" } });
    expect(s.frames[1]!.gate.state).toBe("visible");
    const wire = JSON.stringify(s.frames.slice(0, 1));
    expect(wire).not.toContain(Buffer.from(secret).toString("base64"));
    expect(Buffer.from(s.frames[0]!.jpeg, "base64").toString()).not.toContain("ROOMCODE");
    expect(s.stages).toEqual(["stream-start", "gate-blocked", "gate-released"]);
  });

  it("writes nothing to disk, logs or events", async () => {
    const dir = mkdtempSync(`${tmpdir()}/live-`);
    const cwd = process.cwd();
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    process.chdir(dir);
    try {
      const store = new InMemoryStore();
      const emitter = createLiveEmitter(store, createSanitizer(), "s1", () => "2026-01-01T00:00:00.000Z");
      const s = setup(() => "home");
      s.stages.length = 0;
      await s.capture.start();
      await s.push(fakeJpeg(320, 180, "PIXELS"));
      await s.capture.stop();
      for (const st of s.stages) await emitter.emit(st, { runId: "run1" });
      expect(readdirSync(dir)).toEqual([]);
      const events = JSON.stringify(await store.listEvents("s1"));
      expect(events).not.toContain(s.frames[0]!.jpeg);
      expect(events).not.toContain("jpeg");
      expect(log).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
    } finally {
      process.chdir(cwd);
      log.mockRestore();
      err.mockRestore();
    }
  });

  it("emits lifecycle events in order", async () => {
    const store = new InMemoryStore();
    const emitter = createLiveEmitter(store, createSanitizer(), "s1", () => "2026-01-01T00:00:00.000Z");
    for (const st of ["stream-start", "viewer-connected", "gate-blocked", "gate-released", "viewer-disconnected", "stream-end"] as const) {
      await emitter.emit(st, { runId: "run1" });
    }
    const events = await store.listEvents("s1");
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(events.map((e) => e.label)).toEqual([
      "live view: stream-start",
      "live view: viewer-connected",
      "live view: gate-blocked",
      "live view: gate-released",
      "live view: viewer-disconnected",
      "live view: stream-end",
    ]);
  });
});
