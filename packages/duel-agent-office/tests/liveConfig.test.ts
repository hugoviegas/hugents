import { describe, expect, it } from "vitest";
import { parseLiveWorkerConfig } from "../src/live/config.js";

const ok = { QA_LIVE_RELAY_URL: "http://127.0.0.1:3101", QA_LIVE_WORKER_TOKEN: "0123456789abcdef0123" };

describe("live worker config", () => {
  it("is off without a relay URL or token", () => {
    expect(parseLiveWorkerConfig({})).toBeUndefined();
    expect(parseLiveWorkerConfig({ QA_LIVE_RELAY_URL: ok.QA_LIVE_RELAY_URL })).toBeUndefined();
    expect(parseLiveWorkerConfig({ ...ok, QA_LIVE_WORKER_TOKEN: "short" })).toBeUndefined();
  });
  it("accepts only plain http on loopback", () => {
    expect(parseLiveWorkerConfig(ok)?.relayUrl).toBe("http://127.0.0.1:3101");
    expect(parseLiveWorkerConfig({ ...ok, QA_LIVE_RELAY_URL: "http://localhost:3101" })).toBeDefined();
    for (const bad of ["https://127.0.0.1:3101", "http://example.com:3101", "http://0.0.0.0:3101", "http://user:pw@127.0.0.1:3101", "nope"]) {
      expect(parseLiveWorkerConfig({ ...ok, QA_LIVE_RELAY_URL: bad })).toBeUndefined();
    }
  });
  it("clamps caps to the hard limits", () => {
    const c = parseLiveWorkerConfig({ ...ok, QA_LIVE_MAX_FPS: "999", QA_LIVE_MAX_WIDTH: "99999", QA_LIVE_QUALITY: "100" })!;
    expect(c.config.maxFps).toBe(10);
    expect(c.config.maxWidth).toBe(1600);
    expect(c.config.quality).toBe(80);
  });
});
