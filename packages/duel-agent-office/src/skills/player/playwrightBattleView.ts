import type { Page } from "playwright";
import { InteractionFailure } from "../../errors.js";
import { parseAmmo, parseVisibleCard } from "./playTurn.js";
import type { BattleView, ConfirmState, HandSnapshot } from "./battleInteraction.js";
import { VERIFIED } from "./selectors.js";

const CLICK_TIMEOUT_MS = 3_000;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Playwright implementation of BattleView. Reads accessible roles, names and aria
 * states only. No page.evaluate, no force clicks, no network or storage access.
 */
export function playwrightBattleView(page: Page): BattleView {
  const b = VERIFIED.battle;
  const hand = page.getByRole(b.hand.role, { name: b.hand.name });
  const confirm = () => page.getByRole(b.confirm.role, { name: b.confirm.name }).first();
  const visible = (loc: { first(): { isVisible(): Promise<boolean> } }) => loc.first().isVisible().catch(() => false);

  /** Maps a refused normal click to a sanitized category (no Playwright text is kept). */
  const refused = async (error: unknown): Promise<InteractionFailure> => {
    const message = error instanceof Error ? error.message : "";
    if (await view.blockingOverlay()) return new InteractionFailure("battle-overlay-blocked");
    if (/intercepts pointer events/i.test(message)) return new InteractionFailure("battle-overlay-blocked");
    if (/not visible|outside of the viewport|detached/i.test(message)) return new InteractionFailure("card-not-visible");
    return new InteractionFailure("card-not-enabled");
  };

  const view: BattleView = {
    gameOver: () => visible(page.locator(b.gameOverTitle)),

    blockingOverlay: () =>
      visible(page.locator(b.dialog).filter({ hasNot: page.locator(b.gameOverTitle) })),

    resultVisible: () => visible(page.getByRole(b.resultReveal.role, { name: b.resultReveal.name })),

    turnTimerVisible: () => visible(page.getByRole(b.turnTimer.role)),

    async readHand(): Promise<HandSnapshot | null> {
      if (!(await visible(hand))) return null;
      const buttons = hand.locator(b.cardButtons);
      const count = await buttons.count();
      const cards = await Promise.all(
        Array.from({ length: count }, async (_, i) => {
          const button = buttons.nth(i);
          const [label, disabled, pressed] = await Promise.all([
            button.getAttribute("aria-label"),
            button.getAttribute("aria-disabled"),
            button.getAttribute("aria-pressed"),
          ]);
          return parseVisibleCard(label ?? "", disabled, i, pressed);
        }),
      );

      const ammo = page.getByRole(b.ammo.role, { name: b.ammo.name });
      const ammoCount = await ammo.count();
      const own = ammoCount >= 1 ? parseAmmo(await ammo.nth(0).getAttribute("aria-label")) : null;
      const opponent = ammoCount >= 2 ? parseAmmo(await ammo.nth(1).getAttribute("aria-label")) : null;
      return {
        cards: cards.filter((c) => c.name !== ""),
        ownAmmo: own?.ammo ?? null,
        opponentAmmo: opponent?.ammo ?? null,
        maxAmmo: own?.max ?? null,
      };
    },

    async clickCard(name) {
      // "^Tiro," does not match "Tiro Duplo, ...": the accessible name is "<label>, <cost>[, <reason>]".
      const card = hand.getByRole("button", { name: new RegExp(`^${escapeRegExp(name)},`) });
      try {
        await card.click({ timeout: CLICK_TIMEOUT_MS });
      } catch (error) {
        throw await refused(error);
      }
    },

    async confirmState(): Promise<ConfirmState> {
      const button = confirm();
      if (!(await button.isVisible().catch(() => false))) return "hidden";
      return (await button.isEnabled().catch(() => false)) ? "enabled" : "disabled";
    },

    async clickConfirm() {
      try {
        await confirm().click({ timeout: CLICK_TIMEOUT_MS });
      } catch (error) {
        const failure = await refused(error);
        // A refused Confirmar that is not an overlay is reported as the confirm control itself.
        throw failure.category === "card-not-enabled" ? new InteractionFailure("confirm-not-enabled") : failure;
      }
    },
  };
  return view;
}
