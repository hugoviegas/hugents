import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runtimeAgentsFor } from "../src/office/runtimeAgents.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "office-runtime-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const manifest = (version: string, officeAgent?: string) =>
  JSON.stringify({
    id: "ally",
    version,
    identity: { name: "Ally", role: "Accessibility Critic", description: "Finds accessibility problems." },
    ...(officeAgent ? { officeAgent } : {}),
    model: { provider: "deterministic" },
    prompt: { system: "prompts/system.md" },
    skills: [{ id: "touch-targets", file: "skills/touch-targets.md" }],
    tools: ["design-critic.review"],
    capabilities: ["artifact:read", "board:propose"],
    limits: { timeoutMs: 20000, maxRetries: 1 },
    boards: { produces: [{ board: "problems", state: "open" }], transitions: [] },
  });

async function seed() {
  const pkg = (version: string) => ({
    id: "ally",
    version,
    contentHash: "a".repeat(64),
    files: {
      "agent.json": manifest(version, "design-critic"),
      "prompts/system.md": `You are Ally ${version}.\nNever echo owner@example.com.`,
      "skills/touch-targets.md": "Minimum 44 by 44 points.",
    },
  });
  await writeFile(path.join(dir, "agents.json"), JSON.stringify({ "ally@1.2.0": pkg("1.2.0"), "ally@1.10.0": pkg("1.10.0"), "other@1.0.0": { id: "other", version: "1.0.0", files: { "agent.json": "{}" } } }));
  await writeFile(
    path.join(dir, "tasks.json"),
    JSON.stringify({
      t1: { id: "task-1", agentId: "ally", agentVersion: "1.10.0", state: "succeeded", createdAt: "2026-10-07T10:00:00.000Z", result: { outputSummary: "problems: 1 item(s)", proposedItemIds: ["item-1"] } },
    }),
  );
  await writeFile(path.join(dir, "board-items.json"), JSON.stringify({ "item-1": { id: "item-1", board: "problems", state: "open", payload: { title: "Settings icon has no accessible name" } } }));
}

describe("runtime packages in the agent editor", () => {
  it("shows the newest version of packages linked to the office agent, with prompt, skills and recent tasks, masked", async () => {
    await seed();
    const [ally, ...rest] = await runtimeAgentsFor(dir, "design-critic");
    expect(rest).toEqual([]);
    expect(ally).toMatchObject({ id: "ally", version: "1.10.0", versions: ["1.2.0", "1.10.0"], name: "Ally", tools: ["design-critic.review"] });
    expect(ally!.prompt).toContain("You are Ally 1.10.0.\n");
    expect(ally!.prompt).not.toContain("owner@example.com");
    expect(ally!.skills).toEqual([{ id: "touch-targets", text: "Minimum 44 by 44 points." }]);
    expect(ally!.tasks[0]).toMatchObject({ state: "succeeded", summary: "problems: 1 item(s)", items: [{ board: "problems", state: "open", title: "Settings icon has no accessible name" }] });
    expect(await runtimeAgentsFor(dir, "explorer")).toEqual([]);
  });

  it("returns nothing when the runtime has no data", async () => {
    expect(await runtimeAgentsFor(path.join(dir, "missing"), "design-critic")).toEqual([]);
  });
});
