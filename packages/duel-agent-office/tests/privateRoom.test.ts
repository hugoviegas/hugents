import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseConfig, secretValues } from "../src/config.js";
import { BlockedError } from "../src/errors.js";
import { EventBus } from "../src/orchestrator/eventBus.js";
import { runScenario } from "../src/orchestrator/runScenario.js";
import type { PlayerSession } from "../src/browser/playerSession.js";
import {
  cleanupWaitingRoom,
  createPrivateRoom,
  joinPrivateRoom,
  type ScenarioContext,
} from "../src/scenarios/privateMatchFullGame.js";
import { createRunDir } from "../src/storage/artifacts.js";

const config = parseConfig({
  GAME_BASE_URL: "https://duel-git-qa-team.vercel.app",
  QA_ALPHA_EMAIL: "alpha@qa.invalid",
  QA_ALPHA_PASSWORD: "alpha-pass-123",
  QA_BRAVO_EMAIL: "bravo@qa.invalid",
  QA_BRAVO_PASSWORD: "bravo-pass-456",
});

const CODE = "K7Q2ZM";
const CODE_KEY = "text:Código da sala>xpath=following-sibling::span[1]";
const WAITING = "role:Aguardando forasteiro";
const CREATE_ERROR = "#lobby-panel-create>role:alert";
const JOIN_ERROR = "#lobby-panel-join>role:alert";
const HAND = "role:Sua mão";

/** Minimal locator double: records interactions and answers from a scripted world. */
interface World {
  visible: Set<string>;
  attrs: Record<string, string>;
  text: Record<string, string>;
  clicks: string[];
  fills: [string, string][];
  gotos: string[];
}

class FakeLocator {
  constructor(
    readonly key: string,
    private readonly w: World,
  ) {}
  or(other: FakeLocator) {
    return new FakeLocator(`${this.key}|${other.key}`, this.w);
  }
  first() {
    return this;
  }
  filter() {
    return this;
  }
  locator(selector: string) {
    return new FakeLocator(`${this.key}>${selector}`, this.w);
  }
  getByRole(role: string, opts?: { name?: string }) {
    return new FakeLocator(`${this.key}>role:${opts?.name ?? role}`, this.w);
  }
  async waitFor() {}
  async click() {
    this.w.clicks.push(this.key);
  }
  async fill(value: string) {
    this.w.fills.push([this.key, value]);
  }
  async isVisible() {
    return this.w.visible.has(this.key);
  }
  async getAttribute(name: string) {
    return this.w.attrs[`${this.key}@${name}`] ?? null;
  }
  async textContent() {
    return this.w.text[this.key] ?? null;
  }
}

function makeWorld(partial: Partial<World> = {}): World {
  return { visible: new Set(), attrs: {}, text: {}, clicks: [], fills: [], gotos: [], ...partial };
}

function fakePlayer(agent: "player-alpha" | "player-bravo", w: World): PlayerSession {
  const page = {
    goto: async (url: string) => {
      w.gotos.push(url);
    },
    getByRole: (role: string, opts?: { name?: string }) => new FakeLocator(`role:${opts?.name ?? role}`, w),
    getByText: (text: string) => new FakeLocator(`text:${text}`, w),
    getByLabel: (label: string) => new FakeLocator(`label:${label}`, w),
    locator: (selector: string) => new FakeLocator(selector, w),
  };
  return {
    agent,
    page,
    assertTarget: () => undefined,
    step: async () => undefined,
    failureScreenshot: async () => ({}),
    close: async () => undefined,
  } as unknown as PlayerSession;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "duel-room-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makeCtx(alphaWorld: World, bravoWorld: World = makeWorld()): Promise<ScenarioContext> {
  const run = await createRunDir(dir, "s");
  const secrets = secretValues(config);
  return {
    config,
    run,
    bus: new EventBus(run.events, run.runId, "s", secrets),
    alpha: fakePlayer("player-alpha", alphaWorld),
    bravo: fakePlayer("player-bravo", bravoWorld),
    secrets,
    deadline: Date.now() + 60_000,
  };
}

describe("createPrivateRoom (Alpha)", () => {
  const ready = () =>
    makeWorld({
      visible: new Set([WAITING]),
      attrs: { "role:Sala pública@aria-checked": "false" },
      text: { [CODE_KEY]: ` ${CODE} ` },
    });

  it("creates a private room through the lobby UI and reads the displayed code", async () => {
    const w = ready();
    const ctx = await makeCtx(w);
    const code = await createPrivateRoom(ctx);

    expect(code).toBe(CODE);
    expect(w.gotos).toEqual([`${config.baseUrl}/online`]);
    expect(w.clicks).toEqual(["role:Criar", "role:Criar sala"]);
    // The public switch is only read, never toggled.
    expect(w.clicks).not.toContain("role:Sala pública");
  });

  it("registers the code for redaction and keeps it out of every event", async () => {
    const ctx = await makeCtx(ready());
    await createPrivateRoom(ctx);
    expect(ctx.secrets).toContain(CODE);
    await ctx.bus.emit("player-alpha", "working", `debug ${CODE} in text`);
    expect(JSON.stringify(ctx.bus.events)).not.toContain(CODE);
    expect(await readFile(ctx.run.events, "utf8")).not.toContain(CODE);
  });

  it("refuses to create a room when the public switch is not visibly off", async () => {
    const w = ready();
    w.attrs["role:Sala pública@aria-checked"] = "true";
    const error = await createPrivateRoom(await makeCtx(w)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedError);
    expect((error as BlockedError).kind).toBe("target-guard");
    expect(w.clicks).not.toContain("role:Criar sala");
  });

  it("blocks with a precondition when the lobby refuses to create a room", async () => {
    const w = ready();
    w.visible = new Set([CREATE_ERROR]);
    const error = await createPrivateRoom(await makeCtx(w)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedError);
    expect((error as BlockedError).kind).toBe("missing-precondition");
  });

  it("fails when the displayed code is not a 6-character code", async () => {
    const w = ready();
    w.text[CODE_KEY] = "AB12";
    await expect(createPrivateRoom(await makeCtx(w))).rejects.toThrow("6-character");
  });
});

describe("joinPrivateRoom (Bravo)", () => {
  it("types the code into the join form and submits through the visible button", async () => {
    const w = makeWorld({ visible: new Set([HAND]) });
    await joinPrivateRoom(await makeCtx(makeWorld(), w), CODE);
    expect(w.gotos).toEqual([`${config.baseUrl}/online`]);
    expect(w.clicks).toEqual(["role:Entrar", "role:Entrar na sala"]);
    expect(w.fills).toEqual([["label:Código da sala", CODE]]);
  });

  it("fails when the lobby rejects the code", async () => {
    const w = makeWorld({ visible: new Set([JOIN_ERROR]) });
    await expect(joinPrivateRoom(await makeCtx(makeWorld(), w), CODE)).rejects.toThrow("rejected");
  });
});

describe("cleanupWaitingRoom", () => {
  it("cancels only when Alpha is still on the waiting overlay", async () => {
    const waiting = makeWorld({ visible: new Set([WAITING]) });
    await cleanupWaitingRoom(await makeCtx(waiting));
    expect(waiting.clicks).toEqual(["role:Cancelar e voltar ao menu"]);

    const idle = makeWorld();
    await cleanupWaitingRoom(await makeCtx(idle));
    expect(idle.clicks).toEqual([]);
  });
});

describe("room code never reaches artifacts", () => {
  it("is redacted from events, summary, console and network files even inside an error message", async () => {
    let cleaned = false;
    const summary = await runScenario({
      config,
      scenarioName: "s",
      flow: "private-room-code",
      artifactsDir: dir,
      openPlayers: async () => ({ alpha: fakePlayer("player-alpha", makeWorld()), bravo: fakePlayer("player-bravo", makeWorld()) }),
      scenario: async (ctx) => {
        ctx.secrets.push(CODE); // what createPrivateRoom does once the code is read
        await ctx.bus.emit("player-alpha", "waiting", `room ${CODE} created`);
        throw new Error(`join failed for room ${CODE}`);
      },
      cleanup: async () => {
        cleaned = true;
      },
    });

    expect(summary.status).toBe("failed");
    expect(cleaned).toBe(true);
    const root = path.join(dir, "runs", summary.runId);
    for (const f of ["summary.json", "events.jsonl", "console.jsonl", "network-failures.jsonl"]) {
      expect(await readFile(path.join(root, f), "utf8")).not.toContain(CODE);
    }
  });
});
