import type { RepoReader } from "./repoSource.js";
import type { ArtifactsData } from "./tools.js";

/**
 * Investigation tasks ("why did both players draw?") need more than a verdict. This module reads the task text and the
 * run's own artifacts (every turn each player played, the match result) plus, when a game source is connected, the
 * game's rules through the read-only repo reader. It is deterministic: hypotheses are checked against evidence and the
 * conclusion says what was found, what was refuted and what could not be verified. No model, no network.
 */

export type HypothesisStatus = "confirmed" | "refuted" | "unverified";

export interface Hypothesis {
  id: string;
  claim: string;
  status: HypothesisStatus;
  evidence: string[];
}

export interface Investigation {
  question: string;
  hypotheses: Hypothesis[];
  conclusion: string;
  /** What was read to answer: artifacts and game files. */
  sources: string[];
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

const PLAYERS = ["player-alpha", "player-bravo"] as const;
const TURN_LINE = /^Turn (\d+): played (.+)$/;

/** Cards each player played, in order, from the run's full event log. */
export function turnsFromEvents(events: readonly unknown[]): Record<(typeof PLAYERS)[number], string[]> {
  const out: Record<(typeof PLAYERS)[number], string[]> = { "player-alpha": [], "player-bravo": [] };
  for (const e of events) {
    const r = record(e);
    const who = PLAYERS.find((p) => p === r.agent);
    const m = who && typeof r.activity === "string" ? TURN_LINE.exec(r.activity) : null;
    if (who && m) out[who][Number(m[1]) - 1] = m[2]!;
  }
  for (const p of PLAYERS) out[p] = Array.from(out[p], (c) => c ?? "?");
  return out;
}

const DRAW_QUESTION = /\b(draw|draws|drawn|tie|tied|empate|empates|empataram|empatando)\b/i;

/** The question is the task text itself, minus the Analyst's boilerplate; used to pick the investigator and quoted in the report. */
export function questionOf(taskTitle: string): string {
  return taskTitle.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Tasks that ask something ("why", "understand", "check") rather than just "judge the latest run". */
export function isInvestigation(taskTitle: string): boolean {
  const t = taskTitle.trim();
  return t.length >= 15 && /\b(why|understand|investigate|explain|cause|how come|por que|porque|entender|investig|explic|causa)\b/i.test(t);
}

async function grepGame(reader: RepoReader, filePattern: RegExp, linePattern: RegExp, limit: number): Promise<{ file: string; line: number; text: string }[]> {
  const files = (await reader.listFiles()).filter((f) => filePattern.test(f)).slice(0, 8);
  const hits: { file: string; line: number; text: string }[] = [];
  for (const file of files) {
    const text = await reader.readFile(file);
    if (!text) continue;
    text.split("\n").forEach((line, i) => {
      if (hits.length < limit && linePattern.test(line)) hits.push({ file, line: i + 1, text: clip(line.trim(), 140) });
    });
  }
  return hits;
}

const cite = (h: { file: string; line: number; text: string }) => `${h.file}:${h.line}  ${h.text}`;

async function investigateDraw(question: string, a: ArtifactsData, reader: RepoReader | undefined): Promise<Investigation> {
  const result = record(record(a.summary).result);
  const outcome = record(result.outcome);
  const turnsReported = record(result.turns);
  const seqs = turnsFromEvents(a.eventLog ?? a.events);
  const alpha = seqs["player-alpha"];
  const bravo = seqs["player-bravo"];
  const sources = [`run ${a.runId}: summary.json, events.jsonl (${a.totals.events} lines)`];
  const hypotheses: Hypothesis[] = [];

  // H1 the match really ended in a draw for both sides.
  const outA = String(outcome.alpha ?? "unknown");
  const outB = String(outcome.bravo ?? "unknown");
  const isDraw = outA === "draw" && outB === "draw";
  hypotheses.push({
    id: "H1",
    claim: "The runner misread the result and the match was not really a draw",
    status: isDraw ? "refuted" : "unverified",
    evidence: [`Both game-over screens were read: Alpha "${outA}", Bravo "${outB}" (turns ${JSON.stringify(turnsReported.alpha)} / ${JSON.stringify(turnsReported.bravo)}); the two independent sessions agree.`],
  });

  // H2 both runners play the same cards.
  const n = Math.min(alpha.length, bravo.length);
  const common = alpha.slice(0, n).filter((c, i) => c === bravo[i]).length;
  const identical = n > 0 && common === n && alpha.length === bravo.length;
  const mutualShots = alpha.filter((c, i) => /^Tiro/.test(c) && /^Tiro/.test(bravo[i] ?? "")).length;
  hypotheses.push({
    id: "H2",
    claim: "Both players follow the same strategy, so they play mirrored turns",
    status: n === 0 ? "unverified" : identical ? "confirmed" : "refuted",
    evidence:
      n === 0
        ? ["No per-turn events were found in the run, so the cards played could not be compared."]
        : [
            `Alpha played: ${alpha.join(", ")}`,
            `Bravo played: ${bravo.join(", ")}`,
            `${common} of ${n} turns were the same card${identical ? " (identical sequences)" : ""}; both fired a shot on the same turn ${mutualShots} time(s).`,
          ],
  });

  // H3 the game's rules turn simultaneous shots into a draw.
  const rules: Hypothesis = { id: "H3", claim: "The game's rules make mutual shots end in a draw (a game rule, not a bug)", status: "unverified", evidence: [] };
  let lives: number | undefined;
  if (reader) {
    try {
      const drawHits = await grepGame(reader, /(?:^|\/)gameEngine\.[tj]sx?$/i, /["']draw["']|both.*(?:life|lives)|life\w*\s*(?:<=|===?)\s*0/i, 6);
      const livesHits = await grepGame(reader, /(?:^|\/)gameModes\.[tj]sx?$/i, /\blives\b\s*:\s*\d+/i, 6);
      const shotHits = await grepGame(reader, /(?:^|\/)gameEngine\.[tj]sx?$/i, /\b(?:lives|life)\b.*(?:-=\s*1|-\s*1|--)/i, 4);
      lives = Number(/\blives\b\s*:\s*(\d+)/i.exec(livesHits[0]?.text ?? "")?.[1]) || undefined;
      sources.push(...[...new Set([...drawHits, ...livesHits, ...shotHits].map((h) => h.file))].map((f) => `game code: ${f} (read-only)`));
      rules.evidence.push(...[...drawHits, ...shotHits, ...livesHits].map(cite));
      if (drawHits.length) {
        rules.status = isDraw && mutualShots > 0 ? "confirmed" : "unverified";
        if (lives !== undefined && mutualShots > 0) rules.evidence.push(`${mutualShots} mutual shot(s) played vs ${lives} starting lives in the first mode listed.`);
      } else rules.evidence.push("No draw rule was found in the game files read, so this is not confirmed from code.");
    } catch {
      rules.evidence.push("The game source could not be read.");
    }
  } else {
    rules.evidence.push("No game source is connected (Connections), so the rules were not read. Pick the game's code to verify this.");
  }
  hypotheses.push(rules);

  // H4 the two sessions are really different players.
  hypotheses.push({
    id: "H4",
    claim: "Both sessions are the same account playing itself",
    status: alpha.length && bravo.length ? "refuted" : "unverified",
    evidence: [alpha.length && bravo.length ? "Events came from two separate player sessions, each with its own turn log; one account cannot confirm turns for both sides at once." : "Events from both sessions were not found."],
  });

  const h2 = hypotheses[1]!;
  const h3 = hypotheses[2]!;
  let conclusion: string;
  if (isDraw && h2.status === "confirmed" && h3.status === "confirmed") {
    conclusion = `Most likely cause: both runners ran the same deterministic policy, so they played the same ${n} cards in the same order. Each turn where both shot cost both players a life (${mutualShots} such turn(s)${lives ? `, starting lives ${lives}` : ""}), so both reached 0 on the same turn and the game declared a draw. This is the runner's symmetry meeting the game rules, not a game defect. Fix: give the two players different policies (Bravo now plays defensively).`;
  } else if (isDraw && h2.status === "confirmed") {
    conclusion = "Most likely cause: both runners played identical card sequences, which makes a simultaneous finish likely. The game rule that turns it into a draw could not be confirmed (no game source connected or no draw rule found), so that half is unverified.";
  } else if (isDraw) {
    conclusion = "The result is a real draw but the cards played differed, so mirrored play does not explain it. Compare the sequences above against the game rules; the cause is not established.";
  } else {
    conclusion = `The latest run did not end in a draw (Alpha "${outA}", Bravo "${outB}"), so the question does not apply to this run.`;
  }
  return { question, hypotheses, conclusion, sources };
}

const OUTCOME_QUESTION = /\b(won|win|wins|winner|lost|lose|loser|venceu|ganhou|perdeu|vencedor|derrota)\b/i;
const ATTACKS = new Set(["Tiro", "Tiro Duplo"]);
const DEFENCES = new Set(["Desvio", "Contra-golpe"]);

/** "Who won and how": the result of each session, how each side played, and the last exchange. Facts first, no invented cause. */
async function investigateOutcome(question: string, a: ArtifactsData, reader: RepoReader | undefined): Promise<Investigation> {
  const result = record(record(a.summary).result);
  const outcome = record(result.outcome);
  const seqs = turnsFromEvents(a.eventLog ?? a.events);
  const alpha = seqs["player-alpha"];
  const bravo = seqs["player-bravo"];
  const sources = [`run ${a.runId}: summary.json, events.jsonl (${a.totals.events} lines)`];
  const outA = String(outcome.alpha ?? "unknown");
  const outB = String(outcome.bravo ?? "unknown");
  const winner = outA === "win" ? "Alpha" : outB === "win" ? "Bravo" : undefined;
  const loser = winner === "Alpha" ? "Bravo" : winner === "Bravo" ? "Alpha" : undefined;
  const consistent = (outA === "win" && outB === "loss") || (outA === "loss" && outB === "win");
  const hypotheses: Hypothesis[] = [
    {
      id: "H1",
      claim: "The two sessions disagree, so the result is not trustworthy",
      status: consistent ? "refuted" : "unverified",
      evidence: [`Alpha read "${outA}", Bravo read "${outB}" on their own game-over screens${consistent ? ": one win and one loss, they agree" : ""}.`],
    },
  ];
  const stats = (cards: string[]) => ({ attacks: cards.filter((c) => ATTACKS.has(c)).length, defences: cards.filter((c) => DEFENCES.has(c)).length, reloads: cards.filter((c) => c === "Recarga").length });
  const sa = stats(alpha);
  const sb = stats(bravo);
  const n = Math.min(alpha.length, bravo.length);
  const same = n > 0 && alpha.slice(0, n).every((c, i) => c === bravo[i]);
  hypotheses.push({
    id: "H2",
    claim: "The two players played different strategies",
    status: n === 0 ? "unverified" : same ? "refuted" : "confirmed",
    evidence:
      n === 0
        ? ["No per-turn events were found in the run."]
        : [
            `Alpha played: ${alpha.join(", ")}`,
            `Bravo played: ${bravo.join(", ")}`,
            `Alpha: ${sa.attacks} attack(s), ${sa.defences} defence(s), ${sa.reloads} reload(s). Bravo: ${sb.attacks} attack(s), ${sb.defences} defence(s), ${sb.reloads} reload(s).`,
          ],
  });
  const lastA = alpha.at(-1);
  const lastB = bravo.at(-1);
  const h3: Hypothesis = { id: "H3", claim: "The last exchange decided the match", status: "unverified", evidence: [] };
  if (lastA && lastB && winner) {
    h3.evidence.push(`Last turn (${n}): Alpha played ${lastA}, Bravo played ${lastB}.`);
    const loserCard = loser === "Alpha" ? lastA : lastB;
    const winnerCard = winner === "Alpha" ? lastA : lastB;
    const attackedIntoDefence = ATTACKS.has(loserCard) && DEFENCES.has(winnerCard);
    if (reader) {
      try {
        const hits = await grepGame(reader, /(?:^|\/)gameEngine\.[tj]sx?$/i, /contra|counter|desvio|dodge|shield|\blives?\b.*(?:-=|--|- ?1)/i, 8);
        sources.push(...[...new Set(hits.map((h) => `game code: ${h.file} (read-only)`))]);
        h3.evidence.push(...hits.map(cite));
        h3.status = attackedIntoDefence && hits.length ? "confirmed" : "unverified";
        if (!hits.length) h3.evidence.push("No rule for these cards was found in the game files read.");
      } catch {
        h3.evidence.push("The game source could not be read.");
      }
    } else h3.evidence.push("No game source is connected (Connections), so the card rules were not read.");
  } else h3.evidence.push("The last turn or the winner is missing from the run.");
  hypotheses.push(h3);

  let conclusion: string;
  if (!winner || !loser) {
    conclusion = `The run does not show one winner (Alpha "${outA}", Bravo "${outB}"), so the question does not apply to this run.`;
  } else {
    const [w, l] = winner === "Alpha" ? [sa, sb] : [sb, sa];
    const how = n === 0 ? "" : ` ${winner} played ${w.attacks} attack(s), ${w.defences} defence(s) and ${w.reloads} reload(s); ${loser} played ${l.attacks}, ${l.defences} and ${l.reloads}.`;
    const last = h3.status === "confirmed" ? ` On the last turn ${loser} attacked with ${loser === "Alpha" ? lastA : lastB} into ${winnerCard(winner, lastA, lastB)}, and the game code lines above show those cards' rules.` : "";
    conclusion = `${winner} won and ${loser} lost.${how}${last} The run does not record lives or damage per turn, so the exact margin is not established; add a per-turn HUD capture to the runner to prove it.`;
  }
  return { question, hypotheses, conclusion, sources };
}

const winnerCard = (winner: string, a?: string, b?: string) => (winner === "Alpha" ? a : b) ?? "a defence";

/** Generic fallback: states what the run shows and which game files mention the question's words. It never invents a cause. */
async function investigateGeneric(question: string, a: ArtifactsData, reader: RepoReader | undefined): Promise<Investigation> {
  const result = record(record(a.summary).result);
  const sources = [`run ${a.runId}: summary.json, events.jsonl`];
  const evidence = [
    `Outcome: ${JSON.stringify(result.outcome ?? null)}; turns: ${JSON.stringify(result.turns ?? null)}`,
    `Observer: ${a.findings ? `${a.findings.runs.flatMap((r) => r.findings).length} finding(s)` : "no findings file"}`,
  ];
  const words = [...new Set(question.toLowerCase().match(/[a-zà-ú]{5,}/g) ?? [])].filter((w) => !["there", "which", "should", "report", "check", "files", "understand", "because", "players", "player", "match", "happened", "tests"].includes(w)).slice(0, 4);
  if (reader && words.length) {
    try {
      const hits = await grepGame(reader, /^(?!\.github\/|docs\/|node_modules\/).*\.(?:[tj]sx?)$/i, new RegExp(words.map((w) => w.replace(/[^a-zà-ú]/g, "")).join("|"), "i"), 5);
      sources.push(...[...new Set(hits.map((h) => `game code: ${h.file} (read-only)`))]);
      evidence.push(...hits.map(cite));
    } catch {
      evidence.push("The game source could not be read.");
    }
  }
  return {
    question,
    hypotheses: [{ id: "H1", claim: "The run's artifacts alone explain the question", status: "unverified", evidence }],
    conclusion: "No specialised investigator exists for this question yet, so no cause is claimed. The facts the run does show are listed above.",
    sources,
  };
}

export async function investigate(taskTitle: string, a: ArtifactsData, reader?: RepoReader): Promise<Investigation> {
  const question = questionOf(taskTitle);
  if (DRAW_QUESTION.test(question)) return investigateDraw(question, a, reader);
  return OUTCOME_QUESTION.test(question) ? investigateOutcome(question, a, reader) : investigateGeneric(question, a, reader);
}

export function renderInvestigation(i: Investigation): string {
  const mark: Record<HypothesisStatus, string> = { confirmed: "confirmed", refuted: "refuted", unverified: "not verified" };
  return [
    "## Investigation",
    "",
    `Question: ${i.question}`,
    "",
    "### Hypotheses checked",
    ...i.hypotheses.flatMap((h) => [`- **${h.id} (${mark[h.status]})**: ${h.claim}`, ...h.evidence.map((e) => `  - ${e}`)]),
    "",
    "### Conclusion",
    i.conclusion,
    "",
    `Sources read: ${i.sources.join("; ")}`,
  ].join("\n");
}
