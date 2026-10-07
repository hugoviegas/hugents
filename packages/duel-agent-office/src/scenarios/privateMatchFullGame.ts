import type { Config } from "../config.js";
import { BlockedError, InteractionFailure } from "../errors.js";
import type { PlayerSession } from "../browser/playerSession.js";
import type { EventBus } from "../orchestrator/eventBus.js";
import type { RunPaths } from "../storage/artifacts.js";
import { playOneTurn } from "../skills/player/battleInteraction.js";
import { playwrightBattleView } from "../skills/player/playwrightBattleView.js";
import { VERIFIED } from "../skills/player/selectors.js";

export const SCENARIO_NAME = "private-match-full-game";
/** Entry flow: Alpha creates a private room, Bravo joins with the displayed code. */
export const FLOW = "private-room-code";

export type Outcome = "win" | "loss" | "draw" | "unknown";

export interface ScenarioContext {
  config: Config;
  run: RunPaths;
  bus: EventBus;
  alpha: PlayerSession;
  bravo: PlayerSession;
  /** Redaction list shared with events and collectors; the room code is added at runtime. */
  secrets: string[];
  /** Epoch ms after which waiting stops (scenario-level timeout). */
  deadline: number;
}

export interface ScenarioResult {
  outcome: { alpha: Outcome; bravo: Outcome };
  turns: { alpha: number; bravo: number };
}

const ROOM_CODE = /^[A-Z0-9]{6}$/;
const remaining = (ctx: ScenarioContext) => Math.max(1_000, ctx.deadline - Date.now());

/**
 * Alpha creates a private room through the lobby UI and reads the code the UI shows.
 * The code is sensitive runtime data: it is returned in memory only, added to the
 * redaction list, and never emitted, logged or written to the summary.
 */
export async function createPrivateRoom(ctx: ScenarioContext): Promise<string> {
  const { alpha } = ctx;
  const { page } = alpha;
  const l = VERIFIED.lobby;
  const w = VERIFIED.waitingRoom;

  await ctx.bus.emit(alpha.agent, "working", "Opening the online lobby to create a private room");
  await page.goto(`${ctx.config.baseUrl}${VERIFIED.routes.lobby}`, { waitUntil: "domcontentloaded" });
  alpha.assertTarget();
  await page.getByRole(l.createTab.role, { name: l.createTab.name, exact: true }).click();

  // Never create a public room: the switch must be visibly off, and is never toggled.
  const publicSwitch = page.getByRole(l.publicSwitch.role, { name: l.publicSwitch.name, exact: true });
  await publicSwitch.waitFor({ state: "visible", timeout: remaining(ctx) });
  if ((await publicSwitch.getAttribute("aria-checked")) !== "false") {
    throw new BlockedError("target-guard", "The public-room switch is on by default; refusing to create a public room");
  }
  await alpha.step("lobby-create", "Lobby create tab visible with the room set to private");

  await page.getByRole(l.createButton.role, { name: l.createButton.name, exact: true }).click();

  const waiting = page.getByRole(w.heading.role, { name: w.heading.name });
  const lobbyError = page.locator(l.createPanel).getByRole(l.error.role);
  await waiting.or(lobbyError.first()).first().waitFor({ state: "visible", timeout: remaining(ctx) });
  if (await lobbyError.first().isVisible()) {
    throw new BlockedError(
      "missing-precondition",
      "The lobby refused to create a room (Alpha may still have an active room from an earlier run)",
    );
  }

  // No screenshot here: the waiting room shows the room code.
  const code = page.getByText(w.codeLabel, { exact: true }).locator("xpath=following-sibling::span[1]");
  await code.filter({ hasText: ROOM_CODE }).waitFor({ state: "visible", timeout: 15_000 });
  const value = ((await code.textContent()) ?? "").trim();
  if (!ROOM_CODE.test(value)) throw new Error("The displayed room code is not a 6-character code");
  ctx.secrets.push(value);
  await ctx.bus.emit(alpha.agent, "waiting", "Private room created, waiting for the opponent to join");
  return value;
}

/** Bravo types the displayed code into the join form through the lobby UI. */
export async function joinPrivateRoom(ctx: ScenarioContext, code: string): Promise<void> {
  const { bravo } = ctx;
  const { page } = bravo;
  const l = VERIFIED.lobby;

  await ctx.bus.emit(bravo.agent, "working", "Opening the online lobby to join with the room code");
  await page.goto(`${ctx.config.baseUrl}${VERIFIED.routes.lobby}`, { waitUntil: "domcontentloaded" });
  bravo.assertTarget();
  await page.getByRole(l.joinTab.role, { name: l.joinTab.name, exact: true }).click();

  // No screenshot while the code is typed.
  await page.getByLabel(l.joinCodeInput.label, { exact: true }).fill(code);
  await page.getByRole(l.joinButton.role, { name: l.joinButton.name, exact: true }).click();

  const hand = page.getByRole(VERIFIED.battle.hand.role, { name: VERIFIED.battle.hand.name });
  const joinError = page.locator(l.joinPanel).getByRole(l.error.role);
  await hand.or(joinError.first()).first().waitFor({ state: "visible", timeout: remaining(ctx) });
  if (await joinError.first().isVisible()) throw new Error("The lobby rejected the room code");
  bravo.assertTarget();
}

/** Both players must see the battle: the hand is visible and the waiting overlay is gone. */
export async function awaitSameBattle(ctx: ScenarioContext): Promise<void> {
  const w = VERIFIED.waitingRoom;
  const b = VERIFIED.battle;
  await Promise.all(
    [ctx.alpha, ctx.bravo].map(async (player) => {
      await player.page
        .getByRole(b.hand.role, { name: b.hand.name })
        .waitFor({ state: "visible", timeout: remaining(ctx) });
      await player.page
        .getByRole(w.heading.role, { name: w.heading.name })
        .waitFor({ state: "hidden", timeout: remaining(ctx) });
      player.assertTarget();
    }),
  );
  await Promise.all([ctx.alpha.step("battle-start", "Battle screen visible"), ctx.bravo.step("battle-start", "Battle screen visible")]);
}

/** Best effort after a failed run: cancel Alpha's waiting room through the visible button. */
export async function cleanupWaitingRoom(ctx: ScenarioContext): Promise<void> {
  const w = VERIFIED.waitingRoom;
  const { page } = ctx.alpha;
  if (await page.getByRole(w.heading.role, { name: w.heading.name }).isVisible()) {
    await page.getByRole(w.cancel.role, { name: w.cancel.name }).click({ timeout: 5_000 });
  }
}

async function readOutcome(player: PlayerSession): Promise<Outcome> {
  const text = ((await player.page.locator(VERIFIED.battle.gameOverTitle).textContent()) ?? "").trim();
  return (VERIFIED.battle.outcomes as Record<string, Outcome>)[text] ?? "unknown";
}

/**
 * Plays turns through the visible UI until the game-over dialog appears. Each turn waits for
 * a visible, enabled hand, verifies the selection and the confirmation (see battleInteraction).
 * A failure carries a sanitized category and the failing agent.
 */
export async function playBattle(
  player: PlayerSession,
  ctx: ScenarioContext,
): Promise<{ outcome: Outcome; turns: number }> {
  const view = playwrightBattleView(player.page);
  let turns = 0;

  await ctx.bus.emit(player.agent, "waiting", "Waiting for the first turn");
  try {
    for (;;) {
      const turn = await playOneTurn(view, { deadline: ctx.deadline });
      player.assertTarget();
      if (turn.kind === "over") break;
      turns += 1;
      await ctx.bus.emit(player.agent, "working", `Turn ${turns}: played ${turn.card}`);
      if (turns === 1) await player.step("first-turn", "First turn confirmed");
      await ctx.bus.emit(player.agent, "waiting", `Turn ${turns}: waiting for the result`);
    }
  } catch (error) {
    if (error instanceof InteractionFailure) error.agent ??= player.agent;
    throw error;
  }

  const outcome = await readOutcome(player);
  await player.step("game-over", `Game over: ${outcome}`);
  return { outcome, turns };
}

export async function privateMatchFullGame(ctx: ScenarioContext): Promise<ScenarioResult> {
  const { alpha, bravo, bus } = ctx;
  await bus.emit("runner", "planning", "Planning private-match-full-game via the private room code flow");

  await Promise.all([alpha.login(), bravo.login()]);
  const code = await createPrivateRoom(ctx);
  await joinPrivateRoom(ctx, code);
  await awaitSameBattle(ctx);

  const [a, b] = await Promise.all([playBattle(alpha, ctx), playBattle(bravo, ctx)]);
  await bus.emit("player-alpha", "completed", `Finished: ${a.outcome} after ${a.turns} turns`);
  await bus.emit("player-bravo", "completed", `Finished: ${b.outcome} after ${b.turns} turns`);
  return {
    outcome: { alpha: a.outcome, bravo: b.outcome },
    turns: { alpha: a.turns, bravo: b.turns },
  };
}
