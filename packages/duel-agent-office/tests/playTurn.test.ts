import { describe, expect, it } from "vitest";
import { chooseCard, parseAmmo, parseVisibleCard, type VisibleCard, type VisibleContext } from "../src/skills/player/playTurn.js";

const hand = (entries: [string, boolean][]): VisibleCard[] =>
  entries.map(([name, enabled], index) => ({ name, enabled, selected: false, index }));
const ctx = (own: number | null, opp: number | null, max: number | null = 3): VisibleContext => ({
  ownAmmo: own,
  opponentAmmo: opp,
  maxAmmo: max,
});
const CLASSIC: [string, boolean][] = [
  ["Recarga", true], ["Tiro", true], ["Desvio", true], ["Contra-golpe", true], ["Tiro Duplo", true],
];
const withDisabled = (disabled: string[]) => hand(CLASSIC.map(([n]) => [n, !disabled.includes(n)] as [string, boolean]));

describe("parseVisibleCard / parseAmmo", () => {
  it("reads label, enabled and selected from the accessible state", () => {
    expect(parseVisibleCard("Tiro Duplo, 2 BALAS", null, 1, "true")).toEqual({
      name: "Tiro Duplo", enabled: true, selected: true, index: 1,
    });
    expect(parseVisibleCard("Tiro, 1 BALA, Sem munição", "true", 0, "false")).toMatchObject({ enabled: false, selected: false });
  });

  it("parses the HUD ammo label and rejects anything else", () => {
    expect(parseAmmo("2 de 3 balas")).toEqual({ ammo: 2, max: 3 });
    expect(parseAmmo("Munição do oponente oculta")).toBeNull();
    expect(parseAmmo(null)).toBeNull();
  });
});

describe("chooseCard", () => {
  it("opens with a reload when no card needing ammo is enabled (turn 1)", () => {
    expect(chooseCard(withDisabled(["Tiro", "Tiro Duplo", "Contra-golpe"]), ctx(0, 0))?.name).toBe("Recarga");
  });

  it("prefers an offensive card when ammo allows it", () => {
    expect(chooseCard(withDisabled(["Tiro Duplo"]), ctx(1, 1))?.name).toBe("Tiro");
  });

  it("never reloads at full ammo and spends the surplus with Tiro Duplo", () => {
    expect(chooseCard(withDisabled([]), ctx(3, 1))?.name).toBe("Tiro Duplo");
    expect(chooseCard(withDisabled(["Tiro Duplo"]), ctx(3, 1))?.name).toBe("Tiro");
  });

  it("does not waste a turn on defense against an opponent with no ammo", () => {
    expect(chooseCard(hand([["Desvio", true], ["Contra-golpe", true], ["Recarga", true]]), ctx(1, 0))?.name).toBe("Recarga");
  });

  it("dodges when empty and the opponent can shoot", () => {
    expect(chooseCard(withDisabled(["Tiro", "Tiro Duplo", "Contra-golpe"]), ctx(0, 2))?.name).toBe("Desvio");
  });

  it("falls back to reload when Desvio is exhausted", () => {
    expect(chooseCard(withDisabled(["Tiro", "Tiro Duplo", "Contra-golpe", "Desvio"]), ctx(0, 2))?.name).toBe("Recarga");
  });

  it("treats hidden opponent ammo as a possible attack (defense stays allowed)", () => {
    expect(chooseCard(hand([["Desvio", true], ["Contra-golpe", true]]), ctx(1, null))?.name).toBe("Desvio");
  });

  it("works without any HUD context and ignores disabled cards", () => {
    expect(chooseCard(hand([["Tiro", false], ["Recarga", true]]))?.name).toBe("Recarga");
  });

  it("is deterministic regardless of hand order and keeps the visible index", () => {
    const a = hand([["Recarga", true], ["Tiro", true]]);
    const b = hand([["Tiro", true], ["Recarga", true]]);
    expect(chooseCard(a, ctx(1, 1))?.name).toBe(chooseCard(b, ctx(1, 1))?.name);
    expect(chooseCard(hand([["Desvio", true], ["Tiro", true]]), ctx(1, 1))?.index).toBe(1);
  });

  it("returns null when nothing is playable and the first playable for unknown labels", () => {
    expect(chooseCard(hand([["Tiro", false]]))).toBeNull();
    expect(chooseCard(hand([["Nova carta", true]]))?.name).toBe("Nova carta");
  });
});

describe("chooseCard style", () => {
  it("defensive reloads first and avoids opening with a shot, unlike aggressive", () => {
    const h = hand([["Tiro", true], ["Recarga", true], ["Desvio", true], ["Contra-golpe", true]]);
    expect(chooseCard(h, ctx(1, 1))?.name).toBe("Tiro");
    expect(chooseCard(h, ctx(1, 1), "defensive")?.name).toBe("Recarga");
  });

  it("defensive uses Contra-golpe at full ammo", () => {
    const h = hand([["Tiro", true], ["Recarga", true], ["Contra-golpe", true]]);
    expect(chooseCard(h, ctx(3, 1), "defensive")?.name).toBe("Contra-golpe");
  });
});
