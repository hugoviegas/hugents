import { EXPLORE_SCREEN_NAMES } from "./agentConfig.js";
import type { OfficeAgentId } from "./contract.js";
import type { ScenarioName } from "./tools.js";

/**
 * The step before a playbook: read the task text and decide whether this agent can do it. Deterministic (no model, no
 * network), so a task that does not fit is declined with a reason and a suggested agent instead of running a fixed playbook
 * and reporting "pass". It also picks what the task points at: the run, the explorer's screens, the critic's screenshots.
 */

export interface Triage {
  decision: "run" | "decline";
  /** One plain sentence, shown in the event feed and in the declined report. */
  reason: string;
  /** Agent that can do the task, when declined. */
  redirect?: OfficeAgentId;
  /** A run id written in the task. */
  runId?: string;
  /** Scenario of the run the task is about (analyst and critic read a finished run). */
  scenario?: ScenarioName;
  /** Explorer: screens named in the task. */
  screens?: string[];
}

const PLAN = /\b(how (to|do i|can i|should i)|set ?up|create a (test|run)|test environment|precondition|como (criar|fazer|configurar|montar)|configurar|ambiente de teste)\b/i;
/** The same words `isInvestigation` looks for. */
export const QUESTION = /\b(why|understand|investigate|explain|cause|how come|por que|porque|entender|investig\w*|explic\w*|causa)\b/i;
const ACTION = /\b(play|host|join|run|start|tour|explore|open|jogar|iniciar|rodar|explorar)\b/i;
const SOLO = /\b(solo|single[- ]?player|sozinho|offline|vs\.? ?(the )?(bot|ai|ia)|against (the )?(bot|ai))\b/i;
const MATCH = /\b(match|battle|turns?|won|win|wins|winner|lost|loss|lose|draw|game ?over|partida|batalha|venceu|ganhou|perdeu|empate|players?)\b/i;
export const RUN_ID_IN_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9-]+/;

/** What each agent can do, as words in a task. A task that matches none of them is not declined: its default is run. */
const FITS: Record<OfficeAgentId, RegExp> = {
  "player-alpha": /\b(play|played|host|join|match|private|room|turns?|alpha|jogar|partida)\b/i,
  "player-bravo": /\b(play|played|host|join|match|private|room|turns?|bravo|jogar|partida)\b/i,
  explorer: /\b(screens?|tour|explore|menu|missions?|shop|profile|leaderboard|characters?|friends?|history|achievements?|telas?|explorar|loja|perfil)\b/i,
  "qa-analyst": new RegExp(`${QUESTION.source}|\\b(judge|analy[sz]\\w*|analis\\w*|verdict|report|result|run|findings?|severity|won|win|lost|loss|draw|latest|observer|console|network|errors?)\\b`, "i"),
  "design-critic": /\b(image|images|imagem|screenshots?|layout|design|visual|contrast|touch|clipp\w*|cropp\w*|cut ?off|out of (range|view|frame)|theme|readab\w*|accessib\w*|critique|review|ui|ux|print)\b/i,
  "test-planner": /./,
};
/** Who to suggest first when a task does not fit. */
const ASK: OfficeAgentId[] = ["qa-analyst", "design-critic", "player-alpha", "explorer"];

const SCREEN_WORDS: Record<(typeof EXPLORE_SCREEN_NAMES)[number], RegExp> = {
  menu: /\bmenu\b/i,
  missions: /\bmissions?\b/i,
  shop: /\b(shop|store|loja)\b/i,
  profile: /\b(profile|perfil)\b/i,
  leaderboard: /\b(leaderboard|ranking)\b/i,
  characters: /\bcharacters?\b/i,
  friends: /\bfriends?\b/i,
  "match-history": /\b(match[- ]history|history|historico)\b/i,
  achievements: /\bachievements?\b/i,
};

const NAME: Record<OfficeAgentId, string> = {
  "player-alpha": "Alpha",
  "player-bravo": "Bravo",
  explorer: "Explorer",
  "qa-analyst": "Analyst",
  "design-critic": "Critic",
  "test-planner": "Planner",
};
const JOB: Record<OfficeAgentId, string> = {
  "player-alpha": "plays the private two-player match",
  "player-bravo": "plays the private two-player match",
  explorer: "tours the non-battle screens",
  "qa-analyst": "reads a finished run and answers a question about it",
  "design-critic": "reviews screenshots of a finished run",
  "test-planner": "reads the game's code and writes how to set up a test",
};

const isPlayer = (a: OfficeAgentId) => a === "player-alpha" || a === "player-bravo";

export function screensIn(title: string): string[] {
  return EXPLORE_SCREEN_NAMES.filter((n) => SCREEN_WORDS[n].test(title));
}

/** The run a finished-run agent should read: the scenario the task talks about, else the latest. */
export function scenarioIn(title: string): ScenarioName | undefined {
  if (screensIn(title).length || /\b(screens?|telas?)\b/i.test(title)) return "explore-screens";
  return MATCH.test(title) ? "private-match-full-game" : undefined;
}

export function triage(agentId: OfficeAgentId, title: string): Triage {
  const t = title.replace(/\s+/g, " ").trim();
  const runId = RUN_ID_IN_TEXT.exec(t)?.[0];
  const decline = (redirect: OfficeAgentId, why: string): Triage => ({
    decision: "decline",
    redirect,
    reason: `${NAME[agentId]} ${JOB[agentId]}; ${why} Ask ${NAME[redirect]} (${JOB[redirect]}).`,
  });

  if (agentId !== "test-planner") {
    if (PLAN.test(t)) return decline("test-planner", "this task asks how to set something up.");
    if ((isPlayer(agentId) || agentId === "explorer") && QUESTION.test(t) && !ACTION.test(t)) {
      return decline("qa-analyst", "this task asks a question about a result, not for a new run.");
    }
    if (isPlayer(agentId) && SOLO.test(t)) {
      return decline("test-planner", "solo play is not a scenario: the only match flow needs two players in one private room.");
    }
    if (!FITS[agentId].test(t)) {
      const other = ASK.find((a) => a !== agentId && FITS[a].test(t));
      if (other) return decline(other, "this task is not about that.");
    }
  }

  const scenario = scenarioIn(t);
  const screens = agentId === "explorer" ? screensIn(t) : [];
  const bits = [
    runId && "uses the run named in the task",
    scenario && !runId && agentId !== "explorer" && !isPlayer(agentId) && `reads the latest ${scenario === "private-match-full-game" ? "match" : "screen tour"} run`,
    screens.length && `tours only: ${screens.join(", ")}`,
  ].filter(Boolean);
  return {
    decision: "run",
    reason: `Task fits ${NAME[agentId]}${bits.length ? `: ${bits.join("; ")}` : ""}.`,
    ...(runId ? { runId } : {}),
    ...(scenario ? { scenario } : {}),
    ...(screens.length ? { screens } : {}),
  };
}

// ---- screenshots the task points at ------------------------------------------------------------------------------

/** Words in a task for a screenshot slug (`game-over`, `first-turn`...). Order matters: specific before the generic "battle". */
const SHOT_WORDS: [slug: RegExp, words: RegExp][] = [
  [/game-over/, /\b(game[- ]?over|over|ended|end of (the )?(game|match)|fim)\b/i],
  [/first-turn/, /\bfirst[- ]turn|primeiro turno\b/i],
  [/battle-start/, /\bbattle[- ]start|start of (the )?(battle|match)\b/i],
  [/lobby/, /\blobby\b/i],
  [/logged-in/, /\b(logged[- ]in|after login)\b/i],
  [/login/, /\blogin\b/i],
  [/menu/, /\bmenu\b/i],
  [/missions?/, /\bmissions?\b/i],
  [/shop/, /\b(shop|loja)\b/i],
  [/profile/, /\b(profile|perfil)\b/i],
  [/leaderboard/, /\bleaderboard\b/i],
  [/characters/, /\bcharacters?\b/i],
  [/friends/, /\bfriends?\b/i],
  [/match-history/, /\bhistory\b/i],
  [/achievements/, /\bachievements?\b/i],
];
const BATTLE_SLUG = /battle-start|first-turn|game-over/;
const BATTLE_WORD = /\b(battle|batalha|board|tabuleiro|match)\b/i;

/**
 * Screenshots (`alpha/06-game-over.png`) the task names, e.g. "alpha game over or bravo first turn" gives those two.
 * A side word scopes the slug words after it, up to the next side word. Empty when the task names none.
 */
export function pickTargetShots(names: readonly string[], title: string, max: number): string[] {
  const t = title.toLowerCase();
  const sides = [...t.matchAll(/\b(alpha|bravo)\b/g)];
  const slugOf = (n: string) => n.split("/")[1]?.replace(/^\d+-|\.png$/g, "") ?? "";
  const sideOf = (n: string) => n.split("/")[0];
  const hits = (text: string): RegExp[] => {
    const specific = SHOT_WORDS.filter(([, w]) => w.test(text)).map(([s]) => s);
    return specific.length ? specific : BATTLE_WORD.test(text) ? [BATTLE_SLUG] : [];
  };
  // One group per side word: [side, the slug patterns in the text after it]. Without a side word, one group for everyone.
  const groups: [string | undefined, RegExp[]][] = sides.length
    ? sides.map((m, i) => [m[1], hits(t.slice(m.index! + m[0].length, sides[i + 1]?.index ?? t.length))])
    : [[undefined, hits(t)]];
  const shared = hits(t);
  const out: string[] = [];
  for (const [side, patterns] of groups) {
    for (const pattern of patterns.length ? patterns : shared) {
      for (const n of names) {
        if ((side === undefined || sideOf(n) === side) && pattern.test(slugOf(n)) && !out.includes(n)) out.push(n);
      }
    }
  }
  return out.slice(0, max);
}
