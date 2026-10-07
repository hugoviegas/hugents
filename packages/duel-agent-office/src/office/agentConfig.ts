import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { OFFICE_AGENT_IDS, type OfficeAgentId } from "./contract.js";

/**
 * Per-agent settings the Hugo edits in the office: objective, skill, daily quota and scope. They only steer what a
 * task does inside the closed set of tools and scenarios; there is no field for credentials, URLs, tools or commands.
 * One JSON file (`artifacts/office/agent-config.json`), read by the page and by the bridge on every task.
 */

/** Screens the explorer may tour (same names as `SCREENS` in the explore scenario). */
export const EXPLORE_SCREEN_NAMES = ["menu", "missions", "shop", "profile", "leaderboard", "characters", "friends", "match-history", "achievements"] as const;

/** What an agent can be told to do. `run` plays or explores, `analyze-latest` reads the newest run, `plan` writes a test plan. */
export const AGENT_COMMANDS: Record<OfficeAgentId, readonly { id: string; label: string; hint: string }[]> = {
  "player-alpha": [{ id: "run", label: "Play the match", hint: "Runs private-match-full-game and reports Alpha's side" }],
  "player-bravo": [{ id: "run", label: "Play the match", hint: "Runs private-match-full-game and reports Bravo's side" }],
  explorer: [{ id: "run", label: "Tour the screens", hint: "Runs explore-screens within the configured scope" }],
  "qa-analyst": [{ id: "analyze-latest", label: "Analyse the latest run", hint: "Reads the newest finished run and writes the verdict" }],
  "design-critic": [{ id: "analyze-latest", label: "Review the latest run", hint: "Reviews the approved screenshots of the newest run" }],
  "test-planner": [{ id: "plan", label: "Plan the tests", hint: "Reads the game code and writes how to set up the test environment" }],
};

export interface AgentConfig {
  /** What the agent is trying to find out. Shown on reports and used as the task title when a command has no custom text. */
  objective: string;
  /** The agent's own skill: extra instructions for the text of its report. Never changes tools or scenarios. */
  skill: string;
  /** Daily limits, counted per local day. 0 means no limit. */
  quota: { maxTasksPerDay: number; maxTokensPerDay: number };
  /** Explorer: the screens to tour (empty means all). Everyone: free-text focus, e.g. "only the Missions tab". */
  scope: { screens: string[]; focus: string };
}

export type AgentConfigs = Record<OfficeAgentId, AgentConfig>;

const LIMITS = { objective: 300, skill: 2000, focus: 300, tasks: 500, tokens: 5_000_000 } as const;

export const DEFAULT_CONFIGS: AgentConfigs = {
  "player-alpha": {
    objective: "Host a private match and play it to the end, reporting Alpha's turns and any failure.",
    skill: "Report the outcome, the turn count and the first problem Alpha hit, if any.",
    quota: { maxTasksPerDay: 10, maxTokensPerDay: 20_000 },
    scope: { screens: [], focus: "" },
  },
  "player-bravo": {
    objective: "Join the private match with the room code and play it to the end, reporting Bravo's turns and any failure.",
    skill: "Report the outcome, the turn count and the first problem Bravo hit, if any.",
    quota: { maxTasksPerDay: 10, maxTokensPerDay: 20_000 },
    scope: { screens: [], focus: "" },
  },
  explorer: {
    objective: "Open every player screen once and note redirects, alerts and untranslated text.",
    skill: "List which screens were fine and which were not, naming raw translation keys as found.",
    quota: { maxTasksPerDay: 10, maxTokensPerDay: 20_000 },
    scope: { screens: [], focus: "" },
  },
  "qa-analyst": {
    objective: "Judge the latest run: verdict, severity and suspected area for every finding.",
    skill: "Use one severity scale: high for blocked flows and page errors, medium for broken text or failed requests, low for cosmetic issues.",
    quota: { maxTasksPerDay: 20, maxTokensPerDay: 30_000 },
    scope: { screens: [], focus: "" },
  },
  "design-critic": {
    objective: "Review the approved screenshots for layout, readability, touch targets and theme consistency.",
    skill: "Name the screenshot each remark comes from. Say plainly when no screenshot could be analysed.",
    quota: { maxTasksPerDay: 5, maxTokensPerDay: 40_000 },
    scope: { screens: [], focus: "" },
  },
  "test-planner": {
    objective: "Read the game code and write how to set up the test environment for the task.",
    skill: "List the routes, accounts, environment variables and preconditions the runner needs, citing the file each came from.",
    quota: { maxTasksPerDay: 10, maxTokensPerDay: 0 },
    scope: { screens: [], focus: "" },
  },
};

const clone = <T>(v: T): T => structuredClone(v);
const text = (v: unknown, max: number): string | undefined => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : undefined);
const count = (v: unknown, max: number): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined;

/** Checks a patch for one agent. Returns the merged config or the first problem in plain words. */
export function validateAgentConfig(current: AgentConfig, input: unknown): { ok: true; config: AgentConfig } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Not an agent configuration" };
  const raw = input as Record<string, unknown>;
  const next = clone(current);
  if (raw.objective !== undefined) {
    const v = text(raw.objective, LIMITS.objective);
    if (!v) return { ok: false, error: `The objective needs 1 to ${LIMITS.objective} characters` };
    next.objective = v;
  }
  if (raw.skill !== undefined) {
    const v = text(raw.skill, LIMITS.skill);
    if (v === undefined) return { ok: false, error: "The skill must be text" };
    next.skill = v;
  }
  if (raw.quota !== undefined) {
    const q = (raw.quota && typeof raw.quota === "object" ? raw.quota : {}) as Record<string, unknown>;
    const tasks = count(q.maxTasksPerDay, LIMITS.tasks);
    const tokens = count(q.maxTokensPerDay, LIMITS.tokens);
    if (tasks === undefined || tokens === undefined) return { ok: false, error: `Quota: tasks per day 0 to ${LIMITS.tasks}, tokens per day 0 to ${LIMITS.tokens} (0 means no limit)` };
    next.quota = { maxTasksPerDay: tasks, maxTokensPerDay: tokens };
  }
  if (raw.scope !== undefined) {
    const s = (raw.scope && typeof raw.scope === "object" ? raw.scope : {}) as Record<string, unknown>;
    const screens = Array.isArray(s.screens) ? s.screens : [];
    if (!screens.every((x) => (EXPLORE_SCREEN_NAMES as readonly unknown[]).includes(x))) return { ok: false, error: "Scope: unknown screen" };
    const focus = text(s.focus ?? "", LIMITS.focus);
    if (focus === undefined) return { ok: false, error: "Scope: the focus must be text" };
    next.scope = { screens: [...new Set(screens as string[])], focus };
  }
  return { ok: true, config: next };
}

export interface AgentConfigStore {
  all(): Promise<AgentConfigs>;
  get(agentId: OfficeAgentId): Promise<AgentConfig>;
  save(agentId: unknown, input: unknown): Promise<{ status: number; body: { config?: AgentConfig; error?: string } }>;
}

/** Settings kept in a JSON file. A missing or unreadable file means the defaults; each field falls back on its own. */
export function fileAgentConfigStore(options: { file: string; readonly: boolean }): AgentConfigStore {
  async function load(): Promise<AgentConfigs> {
    const out = clone(DEFAULT_CONFIGS);
    try {
      const saved = JSON.parse(await readFile(options.file, "utf8")) as Record<string, unknown>;
      for (const id of OFFICE_AGENT_IDS) {
        if (saved[id] === undefined) continue;
        const checked = validateAgentConfig(out[id], saved[id]);
        if (checked.ok) out[id] = checked.config;
      }
    } catch {
      // first run or unreadable file: defaults
    }
    return out;
  }
  let writing: Promise<unknown> = Promise.resolve();
  return {
    all: load,
    async get(agentId) {
      return (await load())[agentId];
    },
    async save(agentId, input) {
      if (options.readonly) return { status: 403, body: { error: "The office is read-only" } };
      if (typeof agentId !== "string" || !(OFFICE_AGENT_IDS as readonly string[]).includes(agentId)) return { status: 400, body: { error: "Unknown agent" } };
      const job = writing.then(async () => {
        const all = await load();
        const checked = validateAgentConfig(all[agentId as OfficeAgentId], input);
        if (!checked.ok) return { status: 400, body: { error: checked.error } };
        all[agentId as OfficeAgentId] = checked.config;
        await mkdir(path.dirname(options.file), { recursive: true });
        await writeFile(`${options.file}.tmp`, JSON.stringify(all, null, 2));
        await rename(`${options.file}.tmp`, options.file);
        return { status: 200, body: { config: checked.config } };
      });
      writing = job.catch(() => undefined);
      return job;
    },
  };
}
