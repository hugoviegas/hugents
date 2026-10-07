import { describe, expect, it } from "vitest";
import { investigate, isInvestigation, renderInvestigation, turnsFromEvents } from "../src/office/investigation.js";
import type { RepoReader } from "../src/office/repoSource.js";
import type { ArtifactsData } from "../src/office/tools.js";

const QUESTION = "You need to understand why the both players are getting draw every time, check the test report and the files";
const cards = ["Recarga", "Tiro", "Recarga", "Tiro", "Recarga", "Tiro", "Recarga", "Tiro"];
const turnEvents = (agent: string, list: string[]) => list.map((c, i) => ({ agent, activity: `Turn ${i + 1}: played ${c}` }));

function run(alpha: string[], bravo: string[], outcome = "draw"): ArtifactsData {
  return {
    runId: "2026-10-07T13-00-00-000Z",
    summary: { result: { outcome: { alpha: outcome, bravo: outcome }, turns: { alpha: alpha.length, bravo: bravo.length } } },
    events: [],
    eventLog: [...turnEvents("player-alpha", alpha), ...turnEvents("player-bravo", bravo)],
    console: [],
    networkFailures: [],
    totals: { events: alpha.length + bravo.length, console: 0, networkFailures: 0 },
    findings: null,
    screenshots: [],
  };
}

const reader = (files: Record<string, string>): RepoReader => ({
  summary: async () => ({ kind: "local", label: "game", commits: [] }),
  listFiles: async () => Object.keys(files),
  readFile: async (f) => files[f],
});
const GAME = {
  "lib/gameEngine.ts": "export function checkWinner(a, b) {\n  if (a.life <= 0 && b.life <= 0) return \"draw\";\n}",
  "lib/gameModes.ts": "export const classic = {\n  lives: 4,\n};",
};

describe("investigation", () => {
  it("recognises questions but not the default judging task", () => {
    expect(isInvestigation(QUESTION)).toBe(true);
    expect(isInvestigation("Judge the latest run")).toBe(false);
  });

  it("parses each player's cards from the event log", () => {
    const seq = turnsFromEvents(run(cards, cards).eventLog!);
    expect(seq["player-alpha"]).toEqual(cards);
    expect(seq["player-bravo"]).toHaveLength(8);
  });

  it("explains a draw from identical play and the game's rule, with cited evidence", async () => {
    const inv = await investigate(QUESTION, run(cards, cards), reader(GAME));
    const byId = Object.fromEntries(inv.hypotheses.map((h) => [h.id, h.status]));
    expect(byId).toMatchObject({ H1: "refuted", H2: "confirmed", H3: "confirmed", H4: "refuted" });
    const text = renderInvestigation(inv);
    expect(text).toContain("lib/gameEngine.ts:2");
    expect(text).toContain("starting lives 4");
    expect(inv.conclusion).toMatch(/same deterministic policy/);
  });

  it("does not claim the game rule without a game source", async () => {
    const inv = await investigate(QUESTION, run(cards, cards));
    expect(inv.hypotheses.find((h) => h.id === "H3")?.status).toBe("unverified");
    expect(inv.conclusion).toMatch(/unverified/);
  });

  it("refutes mirrored play when the sequences differ", async () => {
    const other = ["Recarga", "Recarga", "Contra-golpe", "Tiro", "Tiro", "Tiro", "Tiro", "Tiro"];
    const inv = await investigate(QUESTION, run(cards, other), reader(GAME));
    expect(inv.hypotheses.find((h) => h.id === "H2")?.status).toBe("refuted");
    expect(inv.conclusion).not.toMatch(/same deterministic policy/);
  });

  it("falls back to facts, claiming no cause, for other questions", async () => {
    const inv = await investigate("Understand why the login is slow in the lobby", run(cards, cards), reader(GAME));
    expect(inv.hypotheses[0]!.status).toBe("unverified");
    expect(inv.conclusion).toMatch(/no cause is claimed/);
  });
});
