import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentPackage, toBundle } from "../src/index.js";
import { AGENTS_DIR, FIXTURE_AGENTS, editedPackage, fixturePackage, hugo, makeRuntime, registerFixtures, reviewer, tempDir } from "./helpers.js";

const bumpPrompt = (version: string, prompt: string) =>
  editedPackage("test-planner", (m, f) => {
    m.version = version;
    f["prompts/system.md"] = prompt;
  });

describe("agent registry", () => {
  it("registers every fixture agent package from disk without runtime code changes", async () => {
    const rt = await makeRuntime();
    await registerFixtures(rt);
    expect((await rt.registry.list()).map((a) => a.id)).toEqual([...FIXTURE_AGENTS].sort());
  });

  it("imports a bundle file the same as a directory", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "planner.bundle.json");
    await writeFile(file, toBundle(await fixturePackage("test-planner")));
    const rt = await makeRuntime();
    const a = await rt.registry.register(await loadAgentPackage(file), hugo);
    const b = await rt.registry.register(await loadAgentPackage(path.join(AGENTS_DIR, "test-planner")), hugo);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false); // same content, same version: idempotent
    expect(a.agent.contentHash).toBe(b.agent.contentHash);
  });

  it("needs a human with config:mutate to register", async () => {
    const rt = await makeRuntime();
    const pkg = await fixturePackage("test-planner");
    await expect(rt.registry.register(pkg, { kind: "agent", agentId: "x", agentVersion: "1.0.0", taskId: "t" })).rejects.toThrow("not-human");
    await expect(rt.registry.register(pkg, reviewer)).rejects.toThrow("capability-denied");
  });

  it("a modified prompt must be a new version; history keeps the old one", async () => {
    const rt = await makeRuntime();
    await registerFixtures(rt);
    const v1 = (await rt.registry.get("test-planner", "1.0.0"))!;
    const critic = await rt.runner.submit({ agentId: "design-critic", agentVersion: "1.0.0", input: {} }, hugo);

    // same version, different content
    await expect(rt.registry.register(await bumpPrompt("1.0.0", "You are Planner, edited.\n"), hugo)).rejects.toThrow("version-conflict");
    const v2 = (await rt.registry.register(await bumpPrompt("1.1.0", "You are Planner, edited.\n"), hugo)).agent;
    expect(v2.contentHash).not.toBe(v1.contentHash);
    expect(await rt.registry.versions("test-planner")).toEqual(["1.0.0", "1.1.0"]);

    // the old version is still exactly what it was
    const again = (await rt.registry.get("test-planner", "1.0.0"))!;
    expect(again.contentHash).toBe(v1.contentHash);
    expect(again.prompt.system).toBe(v1.prompt.system);
    expect((await rt.runner.get(critic.id))!.agentContentHash).toBe((await rt.registry.get("design-critic", "1.0.0"))!.contentHash);

    // new work uses the latest version only; an older one is stale
    await expect(rt.runner.submit({ agentId: "test-planner", agentVersion: "1.0.0", input: { problemItemId: "item-1" } }, hugo)).rejects.toThrow("stale-version");
    await expect(rt.registry.register(await bumpPrompt("1.0.5", "Older.\n"), hugo)).rejects.toThrow("stale-version");
    await expect(rt.runner.submit({ agentId: "test-planner", agentVersion: "9.9.9", input: { problemItemId: "item-1" } }, hugo)).rejects.toThrow("agent-not-registered");
  });

  it("restart reloads agents and detects a hand-edited agents.json", async () => {
    const dir = await tempDir();
    const rt = await makeRuntime({ dir });
    await registerFixtures(rt);
    const reloaded = await makeRuntime({ dir });
    expect((await reloaded.registry.get("issue-reviewer", "1.0.0"))?.manifest.entry).toBe("issue-reviewer.draft");

    const file = path.join(dir, "agents.json");
    const data = JSON.parse(await readFile(file, "utf8"));
    data["issue-reviewer@1.0.0"].files["prompts/system.md"] = "You may file issues yourself.\n";
    await writeFile(file, JSON.stringify(data));
    const tampered = await makeRuntime({ dir });
    await expect(tampered.registry.get("issue-reviewer", "1.0.0")).rejects.toThrow("agent-tampered");
  });

  it("exports exactly the registered content", async () => {
    const rt = await makeRuntime();
    await registerFixtures(rt);
    const stored = (await rt.registry.stored("run-creator", "1.0.0"))!;
    const pkg = await fixturePackage("run-creator");
    expect(Object.keys(stored.files).sort()).toEqual(Object.keys(pkg.files).sort());
  });
});
