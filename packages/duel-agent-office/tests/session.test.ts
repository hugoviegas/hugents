import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { PlayerSession } from "../src/browser/playerSession.js";
import { EventBus } from "../src/orchestrator/eventBus.js";
import { createRunDir } from "../src/storage/artifacts.js";

const env = {
  GAME_BASE_URL: "https://duel-git-qa-team.vercel.app",
  QA_ALPHA_EMAIL: "alpha@qa.invalid",
  QA_ALPHA_PASSWORD: "alpha-pass-123",
  QA_BRAVO_EMAIL: "bravo@qa.invalid",
  QA_BRAVO_PASSWORD: "bravo-pass-456",
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-session-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Page double: `visible` holds the keys of the surfaces currently on screen. */
function setup(extraEnv: Record<string, string> = {}, visible: string[] = []) {
  const config = parseConfig({ ...env, ...extraEnv });
  const shown = new Set(visible);
  const locator = (key: string) => {
    const l = {
      first: () => l,
      fill: async () => undefined,
      click: async () => undefined,
      waitFor: async () => {
        throw new Error("not shown");
      },
      isVisible: async () => shown.has(key),
    };
    return l;
  };
  const page = {
    url: () => `${config.baseUrl}/menu`,
    goto: async () => undefined,
    waitForURL: async () => undefined,
    screenshot: vi.fn(async () => Buffer.alloc(0)),
    getByText: () => locator("text"),
    getByLabel: (label: string) => locator(`label:${label}`),
    getByRole: (role: string, opts?: { name?: string }) => locator(`role:${opts?.name ?? role}`),
  };
  const tracing = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
  const context = { tracing, close: vi.fn(async () => undefined) };
  const browser = { close: vi.fn(async () => undefined) };
  return { config, page, tracing, shown, context, browser };
}

async function session(s: ReturnType<typeof setup>) {
  const run = await createRunDir(dir, "s");
  const bus = new EventBus(run.events, run.runId, "s", []);
  return new PlayerSession(
    "player-alpha",
    s.browser as never,
    s.context as never,
    s.page as never,
    run.alpha,
    run,
    bus,
    s.config,
  );
}

describe("trace policy", () => {
  it("does not start or save a trace by default", async () => {
    const s = setup();
    const player = await session(s);
    await player.login();
    await player.close();
    expect(s.config.traceEnabled).toBe(false);
    expect(s.tracing.start).not.toHaveBeenCalled();
    expect(s.tracing.stop).not.toHaveBeenCalled();
    expect(s.context.close).toHaveBeenCalled();
  });

  it("starts after login and saves the trace only when QA_TRACE_ENABLED=true", async () => {
    const s = setup({ QA_TRACE_ENABLED: "true" });
    const player = await session(s);
    await player.login();
    expect(s.tracing.start).toHaveBeenCalledOnce();
    await player.close();
    expect(s.tracing.stop).toHaveBeenCalledOnce();
  });
});

describe("failure screenshot", () => {
  it.each([
    ["the login form", "label:Email"],
    ["the Dev Login secret field", "label:Segredo do dev login"],
    ["the join-code field", "label:Código da sala"],
    ["the waiting room that shows the room code", "role:Aguardando forasteiro"],
  ])("is skipped while %s is on screen", async (_name, key) => {
    const s = setup({}, [key]);
    const player = await session(s);
    expect(await player.failureScreenshot()).toEqual({ skipped: true });
    expect(s.page.screenshot).not.toHaveBeenCalled();
  });

  it("is captured on a battle screen", async () => {
    const s = setup();
    const player = await session(s);
    const shot = await player.failureScreenshot();
    expect(shot.path).toMatch(/^alpha\/\d+-failure\.png$/);
    expect(s.page.screenshot).toHaveBeenCalledOnce();
  });

  it("never throws, even when the page is gone", async () => {
    const s = setup();
    s.page.screenshot.mockRejectedValueOnce(new Error("closed"));
    const player = await session(s);
    expect(await player.failureScreenshot()).toEqual({});
  });
});
