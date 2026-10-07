/**
 * Deterministic turn policy. Input is only what the player can see on their own
 * screen: the hand (card labels, enabled state) and the two ammo indicators of the
 * HUD. No game state, no Firebase data, no network payloads, no hidden values.
 *
 * Rules audited from duelo (reference only, never read at runtime):
 * - `lib/gameEngine.ts` `getAvailableCards`: Tiro needs 1 ammo, Tiro Duplo 2 ammo and a
 *   remaining use, Contra-golpe 1 ammo, Desvio is blocked after 3 in a row, Recarga is
 *   always available. The UI shows the same state as `aria-disabled` on the card.
 * - `lib/botAI.ts` rules: turn 1 reloads; at full ammo do not reload; when the opponent
 *   has 0 ammo, Desvio and Contra-golpe are wasted.
 * Not used because the runner cannot see it: opponent's chosen card, opponent history,
 * class abilities, shield counters, the bot's strategy tables.
 */

/** Stable base order: offense, then reload, then defense. PT-BR card labels. */
export const CARD_PRIORITY = ["Tiro", "Tiro Duplo", "Recarga", "Desvio", "Contra-golpe"] as const;

export interface VisibleCard {
  /** Card label parsed from the accessible name, e.g. "Tiro". */
  name: string;
  enabled: boolean;
  /** `aria-pressed` state: the card is the current selection. */
  selected: boolean;
  /** Index among the visible card buttons. */
  index: number;
}

/** Visible resource indicators; null when the HUD does not show them (e.g. hidden opponent ammo). */
export interface VisibleContext {
  ownAmmo: number | null;
  opponentAmmo: number | null;
  maxAmmo: number | null;
}

/** Splits `Tiro Duplo, 2 BALAS, Sem munição` into the label and flags. */
export function parseVisibleCard(
  ariaLabel: string,
  ariaDisabled: string | null,
  index: number,
  ariaPressed: string | null = null,
): VisibleCard {
  const name = ariaLabel.split(",")[0]?.trim() ?? "";
  return { name, enabled: ariaDisabled !== "true", selected: ariaPressed === "true", index };
}

/** Reads `3 de 3 balas` from the HUD ammo indicator. */
export function parseAmmo(ariaLabel: string | null): { ammo: number; max: number } | null {
  const m = /^(\d+) de (\d+) balas$/.exec((ariaLabel ?? "").trim());
  return m ? { ammo: Number(m[1]), max: Number(m[2]) } : null;
}

const NO_CONTEXT: VisibleContext = { ownAmmo: null, opponentAmmo: null, maxAmmo: null };

/** Returns the card to play, or null when nothing in the hand is playable. */
export function chooseCard(hand: readonly VisibleCard[], ctx: VisibleContext = NO_CONTEXT): VisibleCard | null {
  let playable = hand.filter((c) => c.enabled);
  if (playable.length === 0) return null;

  const fullAmmo = ctx.ownAmmo !== null && ctx.maxAmmo !== null && ctx.ownAmmo >= ctx.maxAmmo;
  // Opponent ammo unknown (hidden) counts as "can attack": defense stays available.
  const opponentCanAttack = ctx.opponentAmmo === null || ctx.opponentAmmo >= 1;

  // Never waste a turn: reload at full ammo, defense against an opponent with no ammo.
  const wasteful = (c: VisibleCard) =>
    (fullAmmo && c.name === "Recarga") ||
    (!opponentCanAttack && (c.name === "Desvio" || c.name === "Contra-golpe"));
  const useful = playable.filter((c) => !wasteful(c));
  if (useful.length > 0) playable = useful;

  // Empty and under threat: dodge before a reload that leaves us exposed.
  const exposed = ctx.ownAmmo === 0 && ctx.opponentAmmo !== null && ctx.opponentAmmo >= 1;
  const order: readonly string[] = exposed
    ? ["Desvio", "Recarga", "Tiro", "Tiro Duplo", "Contra-golpe"]
    : fullAmmo
      ? ["Tiro Duplo", "Tiro", "Contra-golpe", "Desvio", "Recarga"]
      : CARD_PRIORITY;

  for (const name of order) {
    const match = playable.find((c) => c.name === name);
    if (match) return match;
  }
  // Unknown label (new card): first visible playable card keeps the policy total.
  return playable[0] ?? null;
}
