/**
 * A run that cannot continue safely because something verified is missing
 * (selector, precondition, allowed target). Ends the run as `blocked`, not `failed`.
 */
export class BlockedError extends Error {
  readonly kind: "missing-selector" | "missing-precondition" | "target-guard";
  constructor(kind: BlockedError["kind"], message: string) {
    super(message);
    this.name = "BlockedError";
    this.kind = kind;
  }
}

export class MissingSelectorError extends BlockedError {
  constructor(what: string) {
    super("missing-selector", `No verified selector for: ${what}`);
    this.name = "MissingSelectorError";
  }
}

/** Sanitized battle-interaction failure categories. Never carry card, room or account details. */
export const INTERACTION_CATEGORIES = [
  "card-not-visible",
  "no-playable-card",
  "card-not-enabled",
  "battle-overlay-blocked",
  "card-selection-not-confirmed",
  "confirm-not-visible",
  "confirm-not-enabled",
  "confirm-did-not-advance",
  "turn-state-timeout",
] as const;
export type InteractionCategory = (typeof INTERACTION_CATEGORIES)[number];

/** A battle step that could not be completed through the visible UI. Ends the run as `failed`. */
export class InteractionFailure extends Error {
  readonly category: InteractionCategory;
  /** Set by the scenario once the failing player is known. */
  agent?: "player-alpha" | "player-bravo";
  constructor(category: InteractionCategory) {
    super(`Battle interaction failed: ${category}`);
    this.name = "InteractionFailure";
    this.category = category;
  }
}
