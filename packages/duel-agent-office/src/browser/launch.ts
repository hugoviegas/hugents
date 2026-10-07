import path from "node:path";
import { chromium, type Browser } from "playwright";
import type { Config } from "../config.js";
import type { EventBus } from "../orchestrator/eventBus.js";
import type { RunPaths } from "../storage/artifacts.js";
import { attachCollectors } from "./collectors.js";
import { PlayerSession, type PlayerAgent } from "./playerSession.js";

const VIEWPORT = { width: 620, height: 780 };

async function openPlayer(
  agent: PlayerAgent,
  slot: number,
  config: Config,
  run: RunPaths,
  bus: EventBus,
  secrets: readonly string[],
): Promise<PlayerSession> {
  const dir = agent === "player-alpha" ? run.alpha : run.bravo;
  // Separate browser instances so the two windows sit side by side in headed mode.
  const browser: Browser = await chromium.launch({
    headless: config.headless,
    args: config.headless
      ? []
      : [`--window-position=${slot * (VIEWPORT.width + 20)},0`, `--window-size=${VIEWPORT.width + 16},${VIEWPORT.height + 90}`],
  });
  const context = await browser.newContext({
    locale: "pt-BR",
    viewport: VIEWPORT,
    serviceWorkers: "block",
    ...(config.videoEnabled ? { recordVideo: { dir: path.join(dir, "video"), size: VIEWPORT } } : {}),
  });
  const page = await context.newPage();
  attachCollectors(page, agent, run, secrets);
  return new PlayerSession(agent, browser, context, page, dir, run, bus, config);
}

export async function launchPlayers(
  config: Config,
  run: RunPaths,
  bus: EventBus,
  secrets: readonly string[],
): Promise<{ alpha: PlayerSession; bravo: PlayerSession }> {
  const alpha = await openPlayer("player-alpha", 0, config, run, bus, secrets);
  try {
    const bravo = await openPlayer("player-bravo", 1, config, run, bus, secrets);
    return { alpha, bravo };
  } catch (error) {
    await alpha.close();
    throw error;
  }
}
