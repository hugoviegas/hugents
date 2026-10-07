import { describe, expect, it } from "vitest";
import { InteractionFailure, INTERACTION_CATEGORIES, type InteractionCategory } from "../src/errors.js";
import {
  playOneTurn,
  type BattleView,
  type Clock,
  type ConfirmState,
  type HandSnapshot,
} from "../src/skills/player/battleInteraction.js";

const CARDS = ["Recarga", "Tiro", "Desvio", "Contra-golpe", "Tiro Duplo"];

function freshHand(enabledNames = CARDS): HandSnapshot {
  return {
    cards: CARDS.map((name, index) => ({ name, enabled: enabledNames.includes(name), selected: false, index })),
    ownAmmo: 1,
    opponentAmmo: 1,
    maxAmmo: 3,
  };
}

/** Scripted visible UI. Time only moves when the code under test sleeps. */
class FakeUi implements BattleView {
  t = 0;
  isOver = false;
  overlay = false;
  result = false;
  timer = true;
  hand: HandSnapshot | null = freshHand();
  confirm: ConfirmState = "hidden";
  calls: string[] = [];
  /** Called after every sleep so a test can change the screen over time. */
  onTick: ((t: number) => void) | null = null;
  /** Behavior of the clicks. Defaults model a healthy game. */
  selectOnClick = true;
  advanceOnConfirm: "result" | "hide" | "timer" | "none" = "result";

  clock: Clock = {
    now: () => this.t,
    sleep: async (ms) => {
      this.t += ms;
      this.onTick?.(this.t);
    },
  };

  async gameOver() { return this.isOver; }
  async blockingOverlay() { return this.overlay; }
  async resultVisible() { return this.result; }
  async turnTimerVisible() { return this.timer; }
  async readHand() { return this.hand; }
  async confirmState() { return this.confirm; }
  async clickCard(name: string) {
    this.calls.push(`card:${name}`);
    if (this.selectOnClick && this.hand) {
      this.hand = { ...this.hand, cards: this.hand.cards.map((c) => ({ ...c, selected: c.name === name })) };
      if (this.confirm === "hidden") this.confirm = "enabled";
    }
  }
  async clickConfirm() {
    this.calls.push("confirm");
    if (this.advanceOnConfirm === "result") this.result = true;
    if (this.advanceOnConfirm === "hide") this.confirm = "hidden";
    if (this.advanceOnConfirm === "timer") this.timer = false;
  }
}

const run = (ui: FakeUi, limits = {}) => playOneTurn(ui, { deadline: 10 ** 9, clock: ui.clock, limits });

async function categoryOf(promise: Promise<unknown>): Promise<InteractionCategory> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(InteractionFailure);
  return (error as InteractionFailure).category;
}

describe("playOneTurn: readiness", () => {
  it("selects, verifies the selection, confirms, and sees the turn advance", async () => {
    const ui = new FakeUi();
    const outcome = await run(ui);
    expect(outcome).toEqual({ kind: "played", card: "Tiro" });
    expect(ui.calls).toEqual(["card:Tiro", "confirm"]);
  });

  it("does not act while the result reveal is on screen", async () => {
    const ui = new FakeUi();
    ui.result = true;
    ui.onTick = (t) => { if (t >= 1_000) ui.result = false; };
    await run(ui);
    expect(ui.t).toBeGreaterThanOrEqual(1_000);
    expect(ui.calls[0]).toBe("card:Tiro");
  });

  it("does not act while a card from the previous turn is still selected", async () => {
    const ui = new FakeUi();
    ui.hand = { ...freshHand(), cards: freshHand().cards.map((c) => ({ ...c, selected: c.name === "Recarga" })) };
    ui.onTick = (t) => { if (t >= 600) ui.hand = freshHand(); };
    await run(ui);
    expect(ui.t).toBeGreaterThanOrEqual(600);
    expect(ui.calls).toContain("confirm");
  });

  it("waits for the turn timer, then tries anyway after the grace period", async () => {
    const withTimer = new FakeUi();
    withTimer.timer = false;
    withTimer.onTick = (t) => { if (t >= 1_000) withTimer.timer = true; };
    await run(withTimer);
    expect(withTimer.t).toBeGreaterThanOrEqual(1_000);
    expect(withTimer.t).toBeLessThan(4_000);

    const never = new FakeUi();
    never.timer = false;
    never.advanceOnConfirm = "result";
    await run(never);
    expect(never.t).toBeGreaterThanOrEqual(4_000);
  });

  it("returns game over without clicking anything", async () => {
    const ui = new FakeUi();
    ui.isOver = true;
    expect(await run(ui)).toEqual({ kind: "over" });
    expect(ui.calls).toEqual([]);
  });

  it("uses the visible ammo to choose (reload when empty and the opponent has none)", async () => {
    const ui = new FakeUi();
    ui.hand = { ...freshHand(["Recarga", "Desvio"]), ownAmmo: 0, opponentAmmo: 0 };
    expect(await run(ui)).toEqual({ kind: "played", card: "Recarga" });
  });
});

describe("playOneTurn: blocked overlay", () => {
  it("classifies a persistent dialog as battle-overlay-blocked and never clicks", async () => {
    const ui = new FakeUi();
    ui.overlay = true;
    expect(await categoryOf(run(ui))).toBe("battle-overlay-blocked");
    expect(ui.calls).toEqual([]);
  });

  it("tolerates a transient dialog", async () => {
    const ui = new FakeUi();
    ui.overlay = true;
    ui.onTick = (t) => { if (t >= 1_000) ui.overlay = false; };
    expect(await run(ui)).toMatchObject({ kind: "played" });
  });
});

describe("playOneTurn: sanitized failure categories", () => {
  it("card-not-visible: the hand never appears", async () => {
    const ui = new FakeUi();
    ui.hand = null;
    expect(await categoryOf(run(ui, { turnWaitMs: 3_000 }))).toBe("card-not-visible");
  });

  it("no-playable-card: every card stays disabled", async () => {
    const ui = new FakeUi();
    ui.hand = freshHand([]);
    expect(await categoryOf(run(ui))).toBe("no-playable-card");
  });

  it("turn-state-timeout: the hand is there but the turn never becomes actionable", async () => {
    const ui = new FakeUi();
    ui.result = true;
    expect(await categoryOf(run(ui, { turnWaitMs: 5_000 }))).toBe("turn-state-timeout");
  });

  it("turn-state-timeout when the scenario deadline passes", async () => {
    const ui = new FakeUi();
    ui.result = true;
    const error = await playOneTurn(ui, { deadline: 500, clock: ui.clock }).catch((e: unknown) => e);
    expect((error as InteractionFailure).category).toBe("turn-state-timeout");
  });

  it("card-selection-not-confirmed: the click never produces a selected state (3 attempts)", async () => {
    const ui = new FakeUi();
    ui.selectOnClick = false;
    expect(await categoryOf(run(ui))).toBe("card-selection-not-confirmed");
    expect(ui.calls.filter((c) => c.startsWith("card:"))).toHaveLength(3);
    expect(ui.calls).not.toContain("confirm");
  });

  it("recovers when the selection shows up on a later attempt", async () => {
    const ui = new FakeUi();
    ui.selectOnClick = false;
    let clicks = 0;
    const original = ui.clickCard.bind(ui);
    ui.clickCard = async (name) => {
      clicks += 1;
      ui.selectOnClick = clicks >= 2;
      await original(name);
    };
    expect(await run(ui)).toMatchObject({ kind: "played" });
    expect(clicks).toBe(2);
  });

  it("confirm-not-visible: Confirmar never shows after the card is selected", async () => {
    const ui = new FakeUi();
    const original = ui.clickCard.bind(ui);
    ui.clickCard = async (name) => {
      await original(name);
      ui.confirm = "hidden";
    };
    expect(await categoryOf(run(ui))).toBe("confirm-not-visible");
    expect(ui.calls).not.toContain("confirm");
  });

  it("confirm-not-enabled: Confirmar stays disabled and is never clicked", async () => {
    const ui = new FakeUi();
    const original = ui.clickCard.bind(ui);
    ui.clickCard = async (name) => {
      await original(name);
      ui.confirm = "disabled";
    };
    expect(await categoryOf(run(ui))).toBe("confirm-not-enabled");
    expect(ui.calls).not.toContain("confirm");
  });

  it("waits for a disabled Confirmar to become enabled before clicking", async () => {
    const ui = new FakeUi();
    const original = ui.clickCard.bind(ui);
    ui.clickCard = async (name) => {
      await original(name);
      ui.confirm = "disabled";
    };
    ui.onTick = (t) => { if (t >= 500 && ui.confirm === "disabled") ui.confirm = "enabled"; };
    expect(await run(ui)).toMatchObject({ kind: "played" });
    expect(ui.calls.at(-1)).toBe("confirm");
  });

  it("confirm-did-not-advance: nothing on screen changes after Confirmar", async () => {
    const ui = new FakeUi();
    ui.advanceOnConfirm = "none";
    expect(await categoryOf(run(ui))).toBe("confirm-did-not-advance");
    expect(ui.calls.filter((c) => c === "confirm")).toHaveLength(1);
  });

  it("accepts each visible sign of advancement", async () => {
    for (const how of ["result", "hide", "timer"] as const) {
      const ui = new FakeUi();
      ui.advanceOnConfirm = how;
      expect(await run(ui)).toMatchObject({ kind: "played" });
    }
    const over = new FakeUi();
    over.advanceOnConfirm = "none";
    over.onTick = () => { over.isOver = true; };
    expect(await run(over)).toMatchObject({ kind: "played" });
  });

  it("lists exactly the nine documented categories and keeps messages free of details", () => {
    expect([...INTERACTION_CATEGORIES]).toEqual([
      "card-not-visible",
      "no-playable-card",
      "card-not-enabled",
      "battle-overlay-blocked",
      "card-selection-not-confirmed",
      "confirm-not-visible",
      "confirm-not-enabled",
      "confirm-did-not-advance",
      "turn-state-timeout",
    ]);
    for (const category of INTERACTION_CATEGORIES) {
      expect(new InteractionFailure(category).message).toBe(`Battle interaction failed: ${category}`);
    }
  });
});
