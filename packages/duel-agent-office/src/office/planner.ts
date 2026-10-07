import { SCREENS } from "../scenarios/exploreScreens.js";
import { SCENARIOS } from "./tools.js";
import type { RepoReader } from "./repoSource.js";

/**
 * Test planning from the game's code, no model involved: it lists the routes, the elements a script can target, the
 * environment names the code reads and the runner's own preconditions, each with the file it came from. The result is a
 * Markdown report that says how to set up the environment for a task. Only names and short labels are copied out of the
 * code, never file bodies, values or secrets.
 */

export interface PlanInput {
  /** What the Hugo asked, free text. */
  task: string;
  objective: string;
  focus: string;
}

const CODE = /\.(?:tsx?|jsx?|vue|svelte)$/;
const ROUTE_FILE = /(?:^|\/)(?:App|routes?|router)\.(?:tsx?|jsx?)$/i;
const MAX_READ = 8;
const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "test", "tests", "agent", "page", "tela", "para", "como", "uma", "dos", "das", "que", "com", "teste", "testes"]);

const unique = <T>(list: T[]) => [...new Set(list)];
const clip = (v: string, n: number) => v.replace(/\s+/g, " ").trim().slice(0, n);

export function keywordsOf(...texts: string[]): string[] {
  return unique(
    texts
      .join(" ")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  ).slice(0, 12);
}

/** Paths in `<Route path="/x">`, `{ path: "/x" }` and `navigate("/x")` style code. */
export function extractRoutes(source: string): string[] {
  const found = [...source.matchAll(/\bpath\s*[=:]\s*[{]?\s*["'`](\/[A-Za-z0-9_\-/:]*)["'`]/g)].map((m) => m[1] as string);
  return unique(found).slice(0, 60);
}

/** `data-testid`, `aria-label` and `placeholder` values written as plain strings. */
export function extractTargets(source: string): { testIds: string[]; labels: string[] } {
  const grab = (re: RegExp) => unique([...source.matchAll(re)].map((m) => clip(m[1] as string, 60)).filter((s) => s && !s.includes("{"))).slice(0, 25);
  return {
    testIds: grab(/data-testid\s*=\s*["']([^"']+)["']/g),
    labels: grab(/(?:aria-label|placeholder)\s*=\s*["']([^"']+)["']/g),
  };
}

/** Environment variable names the code reads (names only). */
export function extractEnvNames(source: string): string[] {
  return unique([...source.matchAll(/(?:import\.meta\.env|process\.env)\.([A-Z][A-Z0-9_]{2,})/g)].map((m) => m[1] as string)).slice(0, 40);
}

/** Names on the left of `NAME=value` lines. The values are never read into the report. */
export function envNamesFromExample(text: string): string[] {
  return unique(text.split("\n").map((l) => /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=/.exec(l)?.[1]).filter((n): n is string => Boolean(n))).slice(0, 60);
}

function score(file: string, words: string[]): number {
  const low = file.toLowerCase();
  return words.reduce((n, w) => n + (low.includes(w) ? 1 : 0), 0);
}

export async function planTests(reader: RepoReader, input: PlanInput): Promise<{ markdown: string; filesRead: number }> {
  const files = (await reader.listFiles()).filter((f) => !/(?:^|\/)(?:dist|build|coverage)\//.test(f));
  const words = keywordsOf(input.task, input.objective, input.focus);
  const sources: string[] = [];
  let filesRead = 0;
  const read = async (rel: string) => {
    const text = await reader.readFile(rel);
    if (text !== undefined) {
      filesRead += 1;
      sources.push(rel);
    }
    return text;
  };

  // 1. Routes, from the router files.
  const routeFiles = files.filter((f) => ROUTE_FILE.test(f)).slice(0, 4);
  const routes: { path: string; file: string }[] = [];
  for (const f of routeFiles) {
    const text = await read(f);
    if (text) routes.push(...extractRoutes(text).map((path) => ({ path, file: f })));
  }

  // 2. Files that match the task's words, ranked: path or route name.
  const ranked = files
    .filter((f) => CODE.test(f) && !/\.(?:test|spec)\./.test(f))
    .map((f) => ({ f, s: score(f, words) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.f.length - b.f.length)
    .slice(0, MAX_READ);
  const targets: { file: string; testIds: string[]; labels: string[] }[] = [];
  const env = new Map<string, string>();
  for (const { f } of ranked) {
    const text = await read(f);
    if (!text) continue;
    const t = extractTargets(text);
    if (t.testIds.length || t.labels.length) targets.push({ file: f, ...t });
    for (const n of extractEnvNames(text)) if (!env.has(n)) env.set(n, f);
  }
  for (const f of routeFiles) for (const n of extractEnvNames((await reader.readFile(f)) ?? "")) if (!env.has(n)) env.set(n, f);

  // 3. Environment names declared by the project itself.
  const example = files.find((f) => /(?:^|\/)\.env\.example$/.test(f));
  const declared = example ? envNamesFromExample((await read(example)) ?? "") : [];

  const matched = routes.filter((r) => words.some((w) => r.path.toLowerCase().includes(w)));
  const known = new Set<string>(SCREENS.map((s) => s.path));
  const lines: string[] = [
    "# Test plan",
    "",
    `- Objective: ${clip(input.objective, 300)}`,
    `- Task: ${clip(input.task, 200) || "(none given)"}`,
    ...(input.focus ? [`- Focus: ${clip(input.focus, 300)}`] : []),
    `- Written from the code only (no model). Files listed: ${files.length}, files read: ${filesRead}.`,
    `- Search words: ${words.join(", ") || "(none, the task has no usable words)"}`,
    "",
    "## Routes in the code",
  ];
  if (!routes.length) lines.push("- No router file found (looked for App, routes or router). The runner's own list below still applies.");
  for (const r of routes.slice(0, 40)) {
    lines.push(`- ${r.path}${matched.includes(r) ? " (matches the task)" : ""}${known.has(r.path) ? ", covered by explore-screens" : ""} (${r.file})`);
  }
  lines.push("", "## Files that match the task");
  if (!ranked.length) lines.push("- None. The task words do not appear in any file name: describe the screen by its route or component name.");
  for (const { f, s } of ranked) lines.push(`- ${f} (${s} match${s > 1 ? "es" : ""})`);
  lines.push("", "## Elements a script can target");
  if (!targets.length) lines.push("- No data-testid, aria-label or placeholder found in the matching files. Scripts must use visible text and roles.");
  for (const t of targets) {
    lines.push(`- ${t.file}`);
    if (t.testIds.length) lines.push(`  - data-testid: ${t.testIds.join(", ")}`);
    if (t.labels.length) lines.push(`  - labels: ${t.labels.join(", ")}`);
  }
  lines.push("", "## Environment the game code reads (names only)");
  if (!env.size && !declared.length) lines.push("- No environment variable names found in the files read.");
  for (const [n, f] of env) lines.push(`- ${n} (${f})`);
  if (declared.length) lines.push(`- Declared in ${example}: ${declared.join(", ")}`);
  lines.push(
    "",
    "## What the runner needs before it can execute",
    "- GAME_BASE_URL pointing at a Vercel Preview (*.vercel.app) backed by the Firebase QA project, never production.",
    "- Two QA accounts (Alpha and Bravo) in the local .env, or Dev Login enabled on the Preview (VITE_ENABLE_DEV_LOGIN=true) with its secret.",
    "- Playwright Chromium installed (npx playwright install chromium) and no other runner in progress.",
    "- Alpha without an open room left over from an earlier run (the lobby refuses to create a second one).",
    "",
    "## Which scenario fits",
  );
  const wantsMatch = words.some((w) => /(match|battle|duel|room|sala|lobby|partida|turn|turno)/.test(w));
  const wantsScreens = matched.length > 0 || words.some((w) => /(screen|tela|missao|missoes|shop|loja|profile|perfil|rank|friends|amigos)/.test(w));
  if (wantsMatch) lines.push(`- ${SCENARIOS[0]} covers the private room code flow and a full match.`);
  if (wantsScreens) lines.push(`- ${SCENARIOS[1]} opens the non-battle screens by URL${matched.length ? `; limit it to: ${unique(matched.map((r) => r.path.slice(1))).join(", ")}` : ""}.`);
  if (!wantsMatch && !wantsScreens) lines.push("- No existing scenario clearly matches. A new script is needed: describe the steps and the expected result, then ask the test builder to write it.");
  const uncovered = matched.filter((r) => !known.has(r.path));
  if (uncovered.length) lines.push("", "## Gaps", ...uncovered.map((r) => `- ${r.path} is not covered by any existing scenario (${r.file})`));
  lines.push("", "## Sources read", ...(sources.length ? sources.map((s) => `- ${s}`) : ["- None"]));
  return { markdown: lines.join("\n"), filesRead };
}
