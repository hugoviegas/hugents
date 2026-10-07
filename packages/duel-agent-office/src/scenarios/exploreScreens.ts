import type { ScenarioContext } from "./privateMatchFullGame.js";

export const EXPLORE_SCENARIO_NAME = "explore-screens";
/** Entry flow recorded in the summary: one logged-in player walks the non-battle screens. */
export const EXPLORE_FLOW = "screen-tour";

/**
 * Routes read from `duelo/src/App.tsx`. Battle is not listed: it needs an opponent and is covered by
 * `private-match-full-game`. Admin, auth and dev routes are not player screens.
 */
export const SCREENS = [
  { name: "menu", path: "/menu" },
  { name: "missions", path: "/missions" },
  { name: "shop", path: "/shop" },
  { name: "profile", path: "/profile" },
  { name: "leaderboard", path: "/leaderboard" },
  { name: "characters", path: "/characters" },
  { name: "friends", path: "/friends" },
  { name: "match-history", path: "/match-history" },
  { name: "achievements", path: "/achievements" },
] as const;

const SPLASH = /carregando/i; // "Carregando arsenal…" loading splash, shown while the app boots
const SPLASH_TIMEOUT_MS = 8_000;
const IDLE_TIMEOUT_MS = 1_500;

/**
 * The app keeps Firestore long-poll requests open, so the network never goes idle: waiting for that costs the full
 * timeout on every screen. Wait for the loading splash to disappear instead (immediate when none is shown) and give
 * the network only a short chance to settle.
 */
async function settle(page: ScenarioContext["alpha"]["page"]): Promise<void> {
  await page.getByText(SPLASH).first().waitFor({ state: "hidden", timeout: SPLASH_TIMEOUT_MS }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: IDLE_TIMEOUT_MS }).catch(() => undefined);
}

export interface ExploreResult {
  screens: { screen: string; ok: boolean; reason?: "redirected" | "alert-visible" | "raw-translation-keys"; keys?: string[] }[];
}

// "tabs.daily", "missions:tabs.daily", "missões.title": dot-separated identifiers (>= 2 letters per part), optionally with an
// i18next namespace prefix. The UI uppercases some of them ("TABS.DAILY"), so the match is case-insensitive.
const KEY = /^(?:\p{L}[\p{L}\d_-]+:)?\p{L}[\p{L}\d_-]+(?:\.\p{L}[\p{L}\d_-]+)+$/u;
// Not keys: host names and file names.
const NOT_KEY = /\.(?:com|net|org|dev|app|io|br|co|gg|tv|me|ai|js|ts|json|png|jpg|jpeg|webp|svg|css|html|md|txt|pdf)$/i;
const MAX_KEYS = 5;

/**
 * Visible words that look like an untranslated i18n key instead of text. A plain `[a-z]+\.[a-z]+` would also flag every
 * host name, version number and "etc.Etc" typo, so a token must be a whole whitespace-delimited word shaped like a key.
 */
export function findRawKeys(text: string): string[] {
  const found = new Set<string>();
  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/^[("'[]+|[)"'\].,;:!?]+$/g, "");
    if (token.length < 5 || token.length > 60 || token.includes("@") || /^https?:/i.test(token)) continue;
    if (KEY.test(token) && !NOT_KEY.test(token)) found.add(token);
    if (found.size >= MAX_KEYS) break;
  }
  return [...found];
}

/**
 * Alpha logs in and opens each screen by URL, waits for it to settle and takes one screenshot
 * (e-mail text is masked by `PlayerSession.screenshot`). A screen that redirects elsewhere or shows an
 * alert is recorded as `ok: false`: an observation, not a failure of the run. Bravo is not used.
 */
export async function exploreScreens(ctx: ScenarioContext): Promise<ExploreResult> {
  const { alpha, bus } = ctx;
  await bus.emit("runner", "planning", `Planning ${EXPLORE_SCENARIO_NAME} over ${SCREENS.length} screens`);
  await alpha.login();

  const screens: ExploreResult["screens"] = [];
  for (const { name, path } of SCREENS) {
    const { page } = alpha;
    await page.goto(`${ctx.config.baseUrl}${path}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    alpha.assertTarget();

    const redirected = new URL(page.url()).pathname !== path;
    const alert = !redirected && (await page.getByRole("alert").first().isVisible().catch(() => false));
    // Visible text through Playwright's own API (no injected script). Only key-shaped words are kept, never the page text.
    const keys = redirected || alert ? [] : findRawKeys(await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""));
    const reason = redirected ? "redirected" : alert ? "alert-visible" : keys.length ? "raw-translation-keys" : undefined;
    screens.push({ screen: name, ok: !reason, ...(reason ? { reason } : {}), ...(keys.length ? { keys } : {}) });

    if (reason === "redirected" && !(await alpha.isSafeToCapture())) {
      await bus.emit(alpha.agent, "working", `${name}: redirected (screenshot skipped: sensitive screen)`);
    } else {
      await alpha.step(name, `${name}: ${reason ?? "ok"}${keys.length ? ` (${keys.join(", ")})` : ""}`);
    }
  }
  const bad = screens.filter((s) => !s.ok).length;
  await bus.emit(alpha.agent, "completed", `Explored ${screens.length} screens, ${bad} with observations`);
  return { screens };
}
