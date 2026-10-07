import { InteractionFailure } from "../../errors.js";
import { chooseCard, type PlayStyle, type VisibleCard, type VisibleContext } from "./playTurn.js";

/**
 * Battle interaction contract. Everything here works on what the player can see:
 * the hand region, card accessible names and states, the HUD ammo labels, the turn
 * timer, the turn-result reveal, dialogs and the game-over title.
 *
 * Why not "Escolha sua carta" alone: that hint only renders when no card is selected
 * AND the info mode is not the default (Hand.tsx). It is not a turn signal.
 * Why verify `aria-pressed`: `aria-disabled` reflects ammo and uses only; a click outside
 * the selecting phase is silently ignored by the game.
 * Why "advanced" is broader than "Confirmar hidden": online, Confirmar stays on screen
 * until both players have chosen, so the reveal, game over or the timer ending also count.
 */

export interface HandSnapshot extends VisibleContext {
  cards: VisibleCard[];
}

export type ConfirmState = "hidden" | "disabled" | "enabled";

/** The visible UI as the runner can observe it. Implemented on Playwright, doubled in tests. */
export interface BattleView {
  gameOver(): Promise<boolean>;
  /** A visible modal dialog other than the game-over dialog. */
  blockingOverlay(): Promise<boolean>;
  /** The turn-result reveal (`role=status`, "Turno N: ...") is on screen. */
  resultVisible(): Promise<boolean>;
  /** The turn timer (`role=timer`) only renders while a card can be chosen. */
  turnTimerVisible(): Promise<boolean>;
  /** null when the hand region is not visible. */
  readHand(): Promise<HandSnapshot | null>;
  /** Normal (non-forced) click. Throws InteractionFailure when the page refuses it. */
  clickCard(name: string): Promise<void>;
  confirmState(): Promise<ConfirmState>;
  /** Normal (non-forced) click. Throws InteractionFailure when the page refuses it. */
  clickConfirm(): Promise<void>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface Limits {
  /** Max wait for the next actionable state (covers the opponent's turn timer and the 5 s reveal). */
  turnWaitMs: number;
  /** A dialog may be transient; this long on screen counts as blocking. */
  overlayGraceMs: number;
  /** Hand ready but no timer yet: wait this long for the timer before trying anyway. */
  timerGraceMs: number;
  /** Every card disabled for this long. */
  noPlayableMs: number;
  /** Time for `aria-pressed` to show after a click, per attempt. */
  selectVerifyMs: number;
  selectAttempts: number;
  confirmVisibleMs: number;
  confirmEnabledMs: number;
  /** After Confirmar: time for any visible sign that the turn moved on. */
  advanceMs: number;
  pollMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  turnWaitMs: 60_000,
  overlayGraceMs: 4_000,
  timerGraceMs: 4_000,
  noPlayableMs: 3_000,
  selectVerifyMs: 2_000,
  selectAttempts: 3,
  confirmVisibleMs: 3_000,
  confirmEnabledMs: 3_000,
  advanceMs: 25_000,
  pollMs: 150,
};

export interface TurnOptions {
  /** Epoch ms (clock.now scale) at which the whole scenario must stop. */
  deadline: number;
  clock?: Clock;
  limits?: Partial<Limits>;
  /** Turn policy of this player; default `aggressive`. */
  style?: PlayStyle;
}

export type TurnOutcome = { kind: "over" } | { kind: "played"; card: string };

/** Polls a visible condition until it holds or `ms` elapse. */
async function pollUntil(clock: Clock, ms: number, pollMs: number, check: () => Promise<boolean>): Promise<boolean> {
  const end = clock.now() + ms;
  for (;;) {
    if (await check()) return true;
    if (clock.now() >= end) return false;
    await clock.sleep(pollMs);
  }
}

/**
 * Waits for an actionable turn (or game over), then selects, verifies, confirms and
 * verifies advancement. Throws InteractionFailure with a sanitized category otherwise.
 */
export async function playOneTurn(view: BattleView, options: TurnOptions): Promise<TurnOutcome> {
  const clock = options.clock ?? realClock;
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const started = clock.now();
  let sawHand = false;
  let overlaySince: number | null = null;
  let noPlayableSince: number | null = null;
  let readySince: number | null = null;

  for (;;) {
    const now = clock.now();
    if (now >= options.deadline || now - started > limits.turnWaitMs) {
      if (overlaySince !== null) throw new InteractionFailure("battle-overlay-blocked");
      throw new InteractionFailure(sawHand ? "turn-state-timeout" : "card-not-visible");
    }

    if (await view.gameOver()) return { kind: "over" };

    if (await view.blockingOverlay()) {
      overlaySince ??= now;
      if (now - overlaySince > limits.overlayGraceMs) throw new InteractionFailure("battle-overlay-blocked");
      await clock.sleep(limits.pollMs);
      continue;
    }
    overlaySince = null;

    const hand = await view.readHand();
    if (!hand || hand.cards.length === 0) {
      readySince = null;
      await clock.sleep(limits.pollMs);
      continue;
    }
    sawHand = true;

    // A reveal in progress, or a card already chosen this turn: not our move.
    if ((await view.resultVisible()) || hand.cards.some((c) => c.selected)) {
      readySince = null;
      noPlayableSince = null;
      await clock.sleep(limits.pollMs);
      continue;
    }

    if (!hand.cards.some((c) => c.enabled)) {
      noPlayableSince ??= now;
      if (now - noPlayableSince > limits.noPlayableMs) throw new InteractionFailure("no-playable-card");
      await clock.sleep(limits.pollMs);
      continue;
    }
    noPlayableSince = null;

    readySince ??= now;
    const timer = await view.turnTimerVisible();
    if (!timer && now - readySince < limits.timerGraceMs) {
      await clock.sleep(limits.pollMs);
      continue;
    }

    return selectAndConfirm(view, hand, timer, clock, limits, options.style);
  }
}

async function selectAndConfirm(
  view: BattleView,
  first: HandSnapshot,
  timerWasVisible: boolean,
  clock: Clock,
  limits: Limits,
  style?: PlayStyle,
): Promise<TurnOutcome> {
  let hand: HandSnapshot | null = first;
  let chosen: string | null = null;

  for (let attempt = 1; attempt <= limits.selectAttempts; attempt++) {
    if (attempt > 1) {
      await clock.sleep(limits.pollMs);
      hand = await view.readHand();
    }
    if (!hand) throw new InteractionFailure("card-not-visible");

    const already = hand.cards.find((c) => c.selected);
    if (already) {
      chosen = already.name;
      break;
    }
    const choice = chooseCard(hand.cards, hand, style);
    if (!choice) throw new InteractionFailure("no-playable-card");
    if (!choice.enabled) throw new InteractionFailure("card-not-enabled");

    await view.clickCard(choice.name);
    const confirmedSelection = await pollUntil(clock, limits.selectVerifyMs, limits.pollMs, async () => {
      const now = await view.readHand();
      return !!now?.cards.some((c) => c.name === choice.name && c.selected);
    });
    if (confirmedSelection) {
      chosen = choice.name;
      break;
    }
  }
  if (!chosen) throw new InteractionFailure("card-selection-not-confirmed");

  // Confirmar must be visible, then enabled, before it is clicked.
  const seen: { state: ConfirmState } = { state: "hidden" };
  const visible = await pollUntil(clock, limits.confirmVisibleMs, limits.pollMs, async () => {
    seen.state = await view.confirmState();
    return seen.state !== "hidden";
  });
  if (!visible) throw new InteractionFailure("confirm-not-visible");
  if (seen.state === "disabled") {
    const enabled = await pollUntil(clock, limits.confirmEnabledMs, limits.pollMs, async () => (await view.confirmState()) === "enabled");
    if (!enabled) throw new InteractionFailure("confirm-not-enabled");
  }

  await view.clickConfirm();

  const advanced = await pollUntil(clock, limits.advanceMs, limits.pollMs, async () => {
    if (await view.gameOver()) return true;
    if (await view.resultVisible()) return true;
    if ((await view.confirmState()) === "hidden") return true;
    return timerWasVisible && !(await view.turnTimerVisible());
  });
  if (!advanced) throw new InteractionFailure("confirm-did-not-advance");

  return { kind: "played", card: chosen };
}
