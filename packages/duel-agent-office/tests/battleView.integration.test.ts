import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { InteractionFailure } from "../src/errors.js";
import { playOneTurn } from "../src/skills/player/battleInteraction.js";
import { playwrightBattleView } from "../src/skills/player/playwrightBattleView.js";

/**
 * Exercises the real Playwright view against a local markup replica of the battle UI.
 * The roles, names and aria states mirror duelo/src/features/battle (Hand, BattleCard,
 * BattleHud, TurnResultOverlay, GameOverScreen). It uses setContent only: no network,
 * no Preview, no Firebase. Skipped when no local Chromium is installed.
 */
const hasChromium = existsSync(chromium.executablePath());

const FIXTURE = `
<header class="battle-hud">
  <span role="img" aria-label="0 de 3 balas" id="own"></span>
  <span role="img" aria-label="0 de 3 balas" id="opp"></span>
  <div role="timer" aria-label="10 segundos para escolher" id="timer">10s</div>
</header>
<div id="arena"></div>
<section aria-label="Sua mão">
  <p id="hint" aria-live="polite">Toque numa carta. Toque duas vezes ou arraste para jogar.</p>
  <div id="confirm-slot"></div>
  <div role="group" aria-label="Cartas" id="cards"></div>
</section>
<div id="over"></div>
<script>
  const CARDS = [["Recarga","+1 BALA",0],["Tiro","1 BALA",1],["Desvio","GRÁTIS",0],["Contra-golpe","1 BALA",1],["Tiro Duplo","2 BALAS",2]];
  const s = { phase: "selecting", selected: null, ammo: 0, turn: 1, maxTurns: window.__maxTurns ?? 2, lost: false };
  function render() {
    document.getElementById("own").setAttribute("aria-label", s.ammo + " de 3 balas");
    document.getElementById("timer").style.display = s.phase === "selecting" ? "" : "none";
    const cards = document.getElementById("cards");
    cards.innerHTML = "";
    for (const [name, cost, need] of CARDS) {
      const b = document.createElement("button");
      b.type = "button";
      const reason = name === "Tiro Duplo" && s.ammo < 2 ? "Falta bala" : (name === "Tiro" || name === "Contra-golpe") && s.ammo < 1 ? "Sem munição" : null;
      b.setAttribute("aria-label", name + ", " + cost + (reason ? ", " + reason : ""));
      b.setAttribute("aria-pressed", String(s.selected === name));
      if (reason) b.setAttribute("aria-disabled", "true");
      b.textContent = name;
      b.onclick = reason || s.phase !== "selecting" ? undefined : () => { s.selected = name; render(); };
      cards.appendChild(b);
    }
    const slot = document.getElementById("confirm-slot");
    slot.innerHTML = "";
    if (s.phase === "selecting" && s.selected) {
      const c = document.createElement("button");
      c.type = "button";
      c.textContent = "Confirmar";
      c.onclick = () => {
        if (window.__stuck) return;
        s.phase = "animating";
        if (s.selected === "Recarga") s.ammo = Math.min(3, s.ammo + 1);
        else if (s.selected === "Tiro") s.ammo = Math.max(0, s.ammo - 1);
        document.getElementById("arena").innerHTML = '<div role="status" aria-label="Turno ' + s.turn + ': resultado">resultado</div>';
        render();
        setTimeout(() => {
          document.getElementById("arena").innerHTML = "";
          s.turn += 1; s.selected = null;
          if (s.turn > s.maxTurns) {
            s.phase = "game_over";
            document.getElementById("over").innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="game-over-title"><h1 id="game-over-title">Vitória!</h1></div>';
          } else s.phase = "selecting";
          render();
        }, 300);
      };
      slot.appendChild(c);
    }
  }
  render();
</script>`;

describe.skipIf(!hasChromium)("playwrightBattleView on a markup replica of the battle UI", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function open(init = "") {
    page = await browser.newPage({ locale: "pt-BR" });
    await page.setContent(`<script>${init}</script>${FIXTURE}`);
    return playwrightBattleView(page);
  }

  it("reads the hand, ammo, selection and timer from accessible state only", async () => {
    const view = await open();
    const hand = await view.readHand();
    expect(hand?.cards.map((c) => c.name)).toEqual(["Recarga", "Tiro", "Desvio", "Contra-golpe", "Tiro Duplo"]);
    expect(hand?.cards.find((c) => c.name === "Tiro")).toMatchObject({ enabled: false, selected: false });
    expect(hand?.cards.find((c) => c.name === "Recarga")).toMatchObject({ enabled: true });
    expect(hand).toMatchObject({ ownAmmo: 0, opponentAmmo: 0, maxAmmo: 3 });
    expect(await view.turnTimerVisible()).toBe(true);
    expect(await view.confirmState()).toBe("hidden");
    expect(await view.resultVisible()).toBe(false);
    expect(await view.gameOver()).toBe(false);
    await page.close();
  });

  it("selects the exact card ('Tiro' never hits 'Tiro Duplo'), verifies it and confirms", async () => {
    const view = await open();
    // Turn 1: empty hand of ammo, so the policy must reload.
    const first = await playOneTurn(view, { deadline: Date.now() + 20_000 });
    expect(first).toEqual({ kind: "played", card: "Recarga" });
    await page.close();
  });

  it("plays a whole scripted game to the game-over dialog", async () => {
    const view = await open("window.__maxTurns = 3;");
    const played: string[] = [];
    for (;;) {
      const turn = await playOneTurn(view, { deadline: Date.now() + 30_000 });
      if (turn.kind === "over") break;
      played.push(turn.card);
    }
    // Turn 1 reloads (ammo 0); later turns follow the policy on the visible ammo.
    expect(played).toHaveLength(3);
    expect(played[0]).toBe("Recarga");
    expect(await view.gameOver()).toBe(true);
    await page.close();
  }, 30_000);

  it("classifies a modal dialog as battle-overlay-blocked without clicking", async () => {
    const view = await open();
    await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", '<div role="dialog" aria-modal="true"><p>Sair do duelo?</p></div>');
    });
    expect(await view.blockingOverlay()).toBe(true);
    const error = await playOneTurn(view, { deadline: Date.now() + 20_000, limits: { overlayGraceMs: 400 } }).catch((e: unknown) => e);
    expect((error as InteractionFailure).category).toBe("battle-overlay-blocked");
    expect(await page.getByRole("button", { name: "Confirmar" }).count()).toBe(0);
    await page.close();
  });

  it("does not treat the game-over dialog as a blocking overlay", async () => {
    const view = await open("window.__maxTurns = 0;");
    await page.evaluate(() => {
      document.getElementById("over")!.innerHTML =
        '<div role="dialog" aria-modal="true"><h1 id="game-over-title">Derrota!</h1></div>';
    });
    expect(await view.gameOver()).toBe(true);
    expect(await view.blockingOverlay()).toBe(false);
    await page.close();
  });

  it("reports battle-overlay-blocked when a non-dialog layer intercepts the click (no force)", async () => {
    const view = await open();
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div style="position:fixed;inset:0;background:transparent;z-index:99"></div>',
      );
    });
    const error = await playOneTurn(view, { deadline: Date.now() + 20_000 }).catch((e: unknown) => e);
    expect((error as InteractionFailure).category).toBe("battle-overlay-blocked");
    await page.close();
  }, 20_000);

  it("reports confirm-did-not-advance when Confirmar does nothing", async () => {
    const view = await open("window.__stuck = true;");
    const error = await playOneTurn(view, { deadline: Date.now() + 20_000, limits: { advanceMs: 800 } }).catch((e: unknown) => e);
    expect((error as InteractionFailure).category).toBe("confirm-did-not-advance");
    await page.close();
  }, 20_000);
});
