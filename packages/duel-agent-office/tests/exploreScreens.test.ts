import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { exploreScreens, findRawKeys, SCREENS } from "../src/scenarios/exploreScreens.js";
import type { ScenarioContext } from "../src/scenarios/privateMatchFullGame.js";

const config = parseConfig({
  GAME_BASE_URL: "https://duel-git-qa-team.vercel.app",
  QA_ALPHA_EMAIL: "alpha@qa.invalid",
  QA_ALPHA_PASSWORD: "alpha-pass-123",
  QA_BRAVO_EMAIL: "bravo@qa.invalid",
  QA_BRAVO_PASSWORD: "bravo-pass-456",
});

/** Alpha double: `redirects` maps a path to where the app sends the player instead; `alerts` lists paths showing an alert. */
function setup(redirects: Record<string, string> = {}, alerts: string[] = [], safe = true, texts: Record<string, string> = {}) {
  let current = "/menu";
  const steps: string[] = [];
  const events: string[] = [];
  const alpha = {
    agent: "player-alpha",
    login: async () => undefined,
    assertTarget: () => undefined,
    isSafeToCapture: async () => safe,
    step: async (name: string) => void steps.push(name),
    page: {
      goto: async (url: string) => {
        const p = new URL(url).pathname;
        current = redirects[p] ?? p;
      },
      waitForLoadState: async () => undefined,
      getByText: () => ({ first: () => ({ waitFor: async () => undefined }) }),
      url: () => `${config.baseUrl}${current}`,
      getByRole: () => ({ first: () => ({ isVisible: async () => alerts.includes(current) }) }),
      locator: () => ({ innerText: async () => texts[current] ?? "Texto normal da tela" }),
    },
  };
  const ctx = {
    config,
    alpha,
    bus: { emit: async (_agent: string, _status: string, activity: string) => void events.push(activity) },
  } as unknown as ScenarioContext;
  return { ctx, steps, events };
}

describe("raw translation keys", () => {
  it("flags key-shaped words, including the uppercased ones and namespaced ones", () => {
    expect(findRawKeys("Missões TABS.DAILY TABS.WEEKLY · DIFFICULTY.MEDIUM")).toEqual(["TABS.DAILY", "TABS.WEEKLY", "DIFFICULTY.MEDIUM"]);
    expect(findRawKeys("(missions:tabs.daily) e missões.title.")).toEqual(["missions:tabs.daily", "missões.title"]);
  });

  it("ignores host names, file names, versions, prices, e-mails, urls and ordinary prose", () => {
    const text = "google.com perfil.png v1.2 R$ 1.000 Nível 1. p.ex. user@mail.com https://x.dev/a.b Renova em 1 d · 17 h Último Suspiro I 0/5 4/3";
    expect(findRawKeys(text)).toEqual([]);
  });

  it("caps the list", () => {
    expect(findRawKeys("aa.bb cc.dd ee.ff gg.hh ii.jj kk.ll mm.nn")).toHaveLength(5);
  });
});

describe("explore-screens", () => {
  it("visits every non-battle screen once with a screenshot each", async () => {
    const { ctx, steps } = setup();
    const result = await exploreScreens(ctx);
    expect(result.screens).toHaveLength(SCREENS.length);
    expect(result.screens.every((s) => s.ok)).toBe(true);
    expect(steps).toEqual(SCREENS.map((s) => s.name));
  });

  it("records redirects and alerts as observations without failing the run", async () => {
    const { ctx } = setup({ "/shop": "/" }, ["/missions"]);
    const result = await exploreScreens(ctx);
    expect(result.screens.find((s) => s.screen === "shop")).toEqual({ screen: "shop", ok: false, reason: "redirected" });
    expect(result.screens.find((s) => s.screen === "missions")).toEqual({ screen: "missions", ok: false, reason: "alert-visible" });
    expect(result.screens.filter((s) => s.ok)).toHaveLength(SCREENS.length - 2);
  });

  it("skips the screenshot when a redirect lands on a sensitive screen", async () => {
    const { ctx, steps, events } = setup({ "/profile": "/" }, [], false);
    await exploreScreens(ctx);
    expect(steps).not.toContain("profile");
    expect(events.some((e) => e.includes("screenshot skipped"))).toBe(true);
  });

  it("records raw translation keys as an observation and names them, without keeping the page text", async () => {
    const { ctx, steps, events } = setup({}, [], true, { "/missions": "Missões TABS.DAILY DIFFICULTY.MEDIUM Contra-Ataque Astral" });
    const result = await exploreScreens(ctx);
    expect(result.screens.find((s) => s.screen === "missions")).toEqual({
      screen: "missions",
      ok: false,
      reason: "raw-translation-keys",
      keys: ["TABS.DAILY", "DIFFICULTY.MEDIUM"],
    });
    expect(result.screens.filter((s) => !s.ok)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("Contra-Ataque");
    expect(steps).toContain("missions"); // still captured
    expect(events.some((e) => e.includes("raw translation keys") || e.includes("Explored 9 screens, 1 with"))).toBe(true);
  });

  it("lists no battle, admin or auth routes", () => {
    expect(SCREENS.map((s) => s.path).join(" ")).not.toMatch(/game|admin|auth|dev/);
  });
});
