import { describe, expect, it, vi } from "vitest";
import { PlayerSession } from "../src/browser/playerSession.js";
import { parseConfig } from "../src/config.js";
import { startLiveView, type LivePlayer } from "../src/live/liveView.js";

const config = parseConfig({
  GAME_BASE_URL: "https://duel-git-qa-team.vercel.app",
  QA_ALPHA_EMAIL: "alpha@qa.invalid",
  QA_ALPHA_PASSWORD: "alpha-pass-123",
  QA_BRAVO_EMAIL: "bravo@qa.invalid",
  QA_BRAVO_PASSWORD: "bravo-pass-456",
});

describe("player private step", () => {
  it("starts private, and a failed login keeps it private", async () => {
    const page = { goto: vi.fn(async () => undefined), url: () => "about:blank", getByLabel: () => { throw new Error("boom"); } };
    const bus = { emit: vi.fn(async () => undefined) };
    const s = new PlayerSession("player-alpha", {} as never, {} as never, page as never, "/tmp", {} as never, bus as never, config);
    expect(s.inPrivateStep).toBe(true);
    const seen: boolean[] = [];
    s.onPrivateStep = (a) => seen.push(a);
    await expect(s.login()).rejects.toThrow();
    expect(s.inPrivateStep).toBe(true);
    expect(seen).toEqual([true]);
  });
});

describe("startLiveView", () => {
  const settings = { relayUrl: "http://127.0.0.1:1", workerToken: "0123456789abcdef0123", agentId: "player-alpha", config: { maxFps: 2, maxWidth: 640, maxHeight: 360, quality: 40, maxFrameBytes: 200_000 }, overrides: {}, pollMs: 50 };
  const player = { label: "alpha", page: {} as never, inPrivateStep: true, isSafeToCapture: async () => false } as LivePlayer;

  it("stays off, without throwing, when the relay is unreachable", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    expect(await startLiveView({ settings, runId: "r1", players: [player], fetch: fetchFn as never })).toBeUndefined();
  });

  it("stays off when the relay refuses the worker token", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    expect(await startLiveView({ settings, runId: "r1", players: [player], fetch: fetchFn as never })).toBeUndefined();
  });

  it("does not start capture while nobody watches, and ends the run on stop", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
      return new Response(JSON.stringify({ wanted: false }), { status: 200 });
    });
    const start = vi.fn();
    const p = { ...player, page: { viewportSize: () => ({ width: 100, height: 100 }), screencast: { start, stop: vi.fn() } } } as unknown as LivePlayer;
    const live = await startLiveView({ settings, runId: "r1", players: [p], fetch: fetchFn as never });
    await new Promise((r) => setTimeout(r, 200));
    expect(start).not.toHaveBeenCalled();
    await live!.stop("completed");
    expect(calls[0]).toBe("POST /worker/run");
    expect(calls).toContain("GET /worker/wanted");
    expect(calls[calls.length - 1]).toBe("POST /worker/run");
  });
});
