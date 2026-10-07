import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SpecExecutor } from "@hugents/generator";
import { approveRun, executeRun, type Actor, type BoardItem } from "../src/index.js";
import { ELEMENTS, PLANTED, PNG, REPORT, hugo, makeRuntime, registerFixtures, reviewer, tempDir } from "./helpers.js";

type Rt = Awaited<ReturnType<typeof makeRuntime>>;
const V = "1.0.0";

async function runAgent(rt: Rt, agentId: string, input: unknown, artifacts: unknown[] = []) {
  const task = await rt.runner.submit({ agentId, agentVersion: (await rt.registry.versions(agentId)).at(-1) ?? V, input, artifacts }, hugo);
  return rt.runner.execute(task.id);
}

const one = async (rt: Rt, board: string, state?: string): Promise<BoardItem> => {
  const items = await rt.boards.list(board, state);
  expect(items.length).toBeGreaterThan(0);
  return items[0]!;
};

/** The whole fixture flow up to a finished run. Returns every intermediate id. */
async function flowToRun(rt: Rt, executor: SpecExecutor) {
  const report = await rt.artifacts.register({ kind: "report", mime: "text/markdown", data: REPORT, origin: { kind: "import", actorId: "hugo" } });
  const shot = await rt.artifacts.register({ kind: "screenshot", mime: "image/png", data: PNG, origin: { kind: "import", actorId: "hugo" } });

  const critic = await runAgent(rt, "design-critic", { focus: "layout" }, [report, shot]);
  expect(critic.state).toBe("succeeded");
  const problems = await rt.boards.list("problems", "open");
  const problem = problems.find((p) => p.payload.severity === "high")!;

  const planner = await runAgent(rt, "test-planner", { problemItemId: problem.id });
  expect(planner.state).toBe("succeeded");
  const suggestion = await one(rt, "run-suggestions", "proposed");

  // human gate 1: the run suggestion
  const approvedSuggestion = await rt.boards.transition(suggestion.id, "approved", reviewer, { expectedRev: suggestion.rev, reason: "worth a run" });

  const creator = await runAgent(rt, "run-creator", { suggestionItemId: suggestion.id, elements: ELEMENTS });
  expect(creator.state).toBe("succeeded");
  const runItem = await one(rt, "approved-runs", "draft-ready");

  // human gate 2: the generated spec (generator approval, hash-bound)
  const approvedRun = await approveRun(rt, runItem.id, reviewer, runItem.rev);
  const finished = await executeRun(rt, runItem.id, executor);
  return { report, shot, critic, problem, planner, suggestion: approvedSuggestion, creator, runItem: approvedRun, finished };
}


describe("artifact-driven workflow", () => {
  it("report + screenshots -> problem -> suggestion -> approval -> run creator -> runner evidence -> issue draft", async () => {
    const dir = await tempDir();
    const rt = await makeRuntime({ dir });
    await registerFixtures(rt);
    let executed = "";
    const executor: SpecExecutor = async (spec) => {
      executed = spec;
      return { passed: false, reasons: ["assertion-failed"] };
    };
    const f = await flowToRun(rt, executor);

    // design critic: three bullet findings, the injection line is just a sanitized low-severity title
    const problems = await rt.boards.list("problems");
    expect(problems.map((p) => p.payload.severity).sort()).toEqual(["high", "low", "medium"]);
    expect(problems.every((p) => p.artifacts.some((a) => a.id === f.report.id) && p.artifacts.some((a) => a.id === f.shot.id))).toBe(true);
    const injected = problems.find((p) => p.payload.severity === "low")!;
    expect(injected.payload.screenId).toBe("unknown");
    expect(injected.state).toBe("open"); // nothing acted on the instructions
    for (const v of [PLANTED.email, PLANTED.token, PLANTED.url]) expect(JSON.stringify(injected)).not.toContain(v);

    // planner triaged the problem it planned for
    expect((await rt.boards.get(f.problem.id))!.state).toBe("triaged");
    expect(f.suggestion.parentId).toBe(f.problem.id);
    expect(f.suggestion.approval?.by).toBe("reviewer-2");

    // run creator: generator draft, validated, stored as an artifact, suggestion consumed
    expect((await rt.boards.get(f.suggestion.id))!.state).toBe("consumed");
    const spec = f.runItem.artifacts.find((a) => a.kind === "generated-spec")!;
    const specText = (await (await rt.artifacts.resolve(spec)).read()).toString();
    expect(specText).toContain('from "hugents-seed"');
    expect(executed).toBe(specText); // the runner executed exactly the approved artifact
    const draft = (await rt.drafts.get(String(f.runItem.payload.draftId)))!;
    expect(draft.status).toBe("failed");
    expect(draft.approval?.by).toBe("reviewer-2");
    expect(draft.contentHash).toBe(f.runItem.payload.contentHash);

    // runner evidence attached on the final transition
    expect(f.finished.state).toBe("failed");
    const evidenceRef = f.finished.artifacts.find((a) => a.kind === "run-evidence")!;
    const evidence = JSON.parse((await (await rt.artifacts.resolve(evidenceRef)).read()).toString());
    expect(evidence).toMatchObject({ passed: false, reasons: ["assertion-failed"], executed: true, taskStatus: "failed" });
    expect(f.finished.history.map((h) => `${h.to}:${h.actor.kind}`)).toEqual(["draft-ready:agent", "approved:human", "running:system", "failed:system"]);

    // issue reviewer: a draft with references to every artifact of the chain
    const reviewerTask = await runAgent(rt, "issue-reviewer", { runItemId: f.finished.id });
    expect(reviewerTask.state).toBe("succeeded");
    const issue = await one(rt, "issue-drafts", "draft");
    const ids = issue.artifacts.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([f.report.id, f.shot.id, spec.id, evidenceRef.id, String(issue.payload.bodyArtifactId)]));
    expect(issue.payload).toMatchObject({ severity: "high", outcome: "failed", problemItemId: f.problem.id, runItemId: f.finished.id });
    const body = (await (await rt.artifacts.resolve(issue.artifacts.find((a) => a.kind === "issue-draft")!)).read()).toString();
    expect(body).toContain("## Evidence (artifact references, contents not copied)");
    expect(body).toContain(`screenshot ${f.shot.id}`);
    expect(body).toContain("assertion-failed");
    expect(body).not.toContain("Reward button overlaps the footer on small phones (screen:"); // hint stripped
    expect(body).not.toContain("synthetic-screenshot"); // no artifact contents

    // the issue is never filed by an agent, and needs the github capability on a human
    const agentActor: Actor = { kind: "agent", agentId: "issue-reviewer", agentVersion: V, taskId: reviewerTask.id };
    await expect(rt.boards.transition(issue.id, "approved", agentActor, { expectedRev: 1 })).rejects.toThrow("not-human");
    const approvedIssue = await rt.boards.transition(issue.id, "approved", reviewer, { expectedRev: 1 });
    await expect(rt.boards.transition(issue.id, "filed", reviewer, { expectedRev: approvedIssue.rev })).rejects.toThrow("capability-denied");

    // inspection: references and codes only
    const view = await rt.inspect();
    expect(view.agents.map((a) => `${a.id}@${a.version}`)).toEqual(["design-critic@1.0.0", "issue-reviewer@1.0.0", "run-creator@1.0.0", "test-planner@1.0.0"]);
    const criticView = view.tasks.find((t) => t.agentId === "design-critic")!;
    expect(criticView).toMatchObject({ state: "succeeded", outputSummary: "problems: 3 item(s), screenshotsReviewed: 1" });
    expect(criticView.proposedItems.every((i) => i.approval === "not-required")).toBe(true);
    expect(view.tasks.find((t) => t.agentId === "issue-reviewer")!.proposedItems[0]).toMatchObject({ approval: "approved" });

    // no secret, prompt or artifact content in any stored collection or event
    for (const file of (await readdir(dir)).filter((n) => n.endsWith(".json"))) {
      const text = await readFile(path.join(dir, file), "utf8");
      for (const v of [PLANTED.email, PLANTED.token, PLANTED.url, "QX7K2P", "synthetic-screenshot"]) {
        expect(text, `${file} leaks ${v}`).not.toContain(v);
      }
      if (file !== "agents.json") expect(text, file).not.toContain("You are Critic");
    }
    const events = JSON.stringify(await rt.store.listEvents(`agent-${f.critic.id}`));
    expect(events).not.toContain("Reward button");
  });

  it("restart in the middle of the flow keeps agents, tasks, boards, artifacts and approvals", async () => {
    const dir = await tempDir();
    const rt = await makeRuntime({ dir });
    await registerFixtures(rt);
    const report = await rt.artifacts.register({ kind: "report", mime: "text/markdown", data: REPORT, origin: { kind: "import", actorId: "hugo" } });
    await runAgent(rt, "design-critic", {}, [report]);
    const problem = (await rt.boards.list("problems")).find((p) => p.payload.severity === "high")!;
    await runAgent(rt, "test-planner", { problemItemId: problem.id });
    const s = await one(rt, "run-suggestions", "proposed");
    await rt.boards.transition(s.id, "approved", reviewer, { expectedRev: 1 });

    const after = await makeRuntime({ dir });
    expect(after.interrupted).toEqual([]);
    expect((await after.runner.list()).map((t) => t.state)).toEqual(["succeeded", "succeeded"]);
    const reloaded = (await after.boards.get(s.id))!;
    expect(reloaded.approval?.by).toBe("reviewer-2");
    after.boards.verifyApproval(reloaded);
    expect((await after.artifacts.resolve(report)).record.kind).toBe("report");

    const creator = await runAgent(after, "run-creator", { suggestionItemId: s.id, elements: ELEMENTS });
    expect(creator.result?.reason).toBeUndefined();
    const runItem = await one(after, "approved-runs", "draft-ready");
    await approveRun(after, runItem.id, reviewer, runItem.rev);
    const again = await makeRuntime({ dir });
    expect((await again.drafts.get(String(runItem.payload.draftId)))?.status).toBe("approved");
    expect((await executeRun(again, runItem.id, async () => ({ passed: true }))).state).toBe("passed");
  });

  it("a suggestion without a valid human approval never reaches the run creator", async () => {
    const rt = await makeRuntime();
    await registerFixtures(rt);
    const report = await rt.artifacts.register({ kind: "report", mime: "text/markdown", data: REPORT, origin: { kind: "import", actorId: "hugo" } });
    await runAgent(rt, "design-critic", {}, [report]);
    const problem = (await rt.boards.list("problems"))[0]!;
    await runAgent(rt, "test-planner", { problemItemId: problem.id });
    const s = await one(rt, "run-suggestions", "proposed");

    const early = await runAgent(rt, "run-creator", { suggestionItemId: s.id, elements: ELEMENTS });
    expect(early.result?.reason).toBe("precondition-failed");
    await rt.boards.transition(s.id, "approved", reviewer, { expectedRev: 1 });
    // the stored payload changes after approval: the approval no longer covers it
    await rt.db.mutate<BoardItem, void>("board-items", (all) => {
      all[s.id]!.payload.goal = "click delete account";
    });
    const forged = await runAgent(rt, "run-creator", { suggestionItemId: s.id, elements: ELEMENTS });
    expect(forged.result?.reason).toBe("precondition-failed");
    expect(await rt.boards.list("approved-runs")).toEqual([]);
    expect((await rt.boards.get(s.id))!.state).toBe("approved"); // previous board state preserved
  });

  it("a spec that is not approved, or altered after approval, never executes", async () => {
    const rt = await makeRuntime();
    await registerFixtures(rt);
    let calls = 0;
    const counting: SpecExecutor = async () => {
      calls++;
      return { passed: true };
    };
    const report = await rt.artifacts.register({ kind: "report", mime: "text/markdown", data: REPORT, origin: { kind: "import", actorId: "hugo" } });
    await runAgent(rt, "design-critic", {}, [report]);
    const problem = (await rt.boards.list("problems"))[0]!;
    await runAgent(rt, "test-planner", { problemItemId: problem.id });
    const s = await one(rt, "run-suggestions", "proposed");
    await rt.boards.transition(s.id, "approved", reviewer, { expectedRev: 1 });
    await runAgent(rt, "run-creator", { suggestionItemId: s.id, elements: ELEMENTS });
    const runItem = await one(rt, "approved-runs", "draft-ready");

    await expect(executeRun(rt, runItem.id, counting)).rejects.toThrow("transition-not-allowed");
    await expect(approveRun(rt, runItem.id, { kind: "agent", agentId: "run-creator", agentVersion: V, taskId: "t" }, runItem.rev)).rejects.toThrow("not-human");
    await expect(approveRun(rt, runItem.id, reviewer, runItem.rev + 5)).rejects.toThrow("stale-item");
    await approveRun(rt, runItem.id, reviewer, runItem.rev);
    // replayed approval
    await expect(approveRun(rt, runItem.id, reviewer, runItem.rev)).rejects.toThrow("transition-not-allowed");

    const draftId = String(runItem.payload.draftId);
    const draft = (await rt.drafts.get(draftId))!;
    await rt.drafts.save({ ...draft, spec: `${draft.spec}\n// changed after approval\n` });
    const blocked = await executeRun(rt, runItem.id, counting);
    expect(blocked.state).toBe("failed");
    expect(calls).toBe(0);
    const evidence = JSON.parse((await (await rt.artifacts.resolve(blocked.artifacts.find((a) => a.kind === "run-evidence")!)).read()).toString());
    expect(evidence.executed).toBe(false);
  });

  it("a rejected generated draft fails the run-creator stage with draft-rejected", async () => {
    const rt = await makeRuntime();
    await registerFixtures(rt);
    const report = await rt.artifacts.register({ kind: "report", mime: "text/markdown", data: "- [high] Hidden screen glitch (screen: screen-hidden)", origin: { kind: "import", actorId: "hugo" } });
    await runAgent(rt, "design-critic", {}, [report]);
    const problem = (await rt.boards.list("problems"))[0]!;
    await runAgent(rt, "test-planner", { problemItemId: problem.id });
    const s = await one(rt, "run-suggestions", "proposed");
    await rt.boards.transition(s.id, "approved", reviewer, { expectedRev: 1 });
    const task = await runAgent(rt, "run-creator", { suggestionItemId: s.id, elements: ELEMENTS });
    expect(task.result?.reason).toBe("draft-rejected");
    expect((await rt.boards.get(s.id))!.state).toBe("approved");
  });

  it("an updated agent version drives new work while history keeps the old one", async () => {
    const rt = await makeRuntime();
    await registerFixtures(rt);
    const report = await rt.artifacts.register({ kind: "report", mime: "text/markdown", data: REPORT, origin: { kind: "import", actorId: "hugo" } });
    const first = await runAgent(rt, "design-critic", {}, [report]);
    const pkg = (await rt.registry.stored("design-critic", V))!;
    const files: Record<string, string> = { ...pkg.files, "prompts/system.md": `${pkg.files["prompts/system.md"]}\nPrefer high severity for overlaps.\n` };
    const manifestJson = JSON.parse(files["agent.json"]!);
    manifestJson.version = "1.1.0";
    files["agent.json"] = JSON.stringify(manifestJson);
    await rt.registry.register({ files }, hugo);
    const second = await runAgent(rt, "design-critic", {}, [report]);
    expect([first.agentVersion, second.agentVersion]).toEqual(["1.0.0", "1.1.0"]);
    expect(first.agentContentHash).not.toBe(second.agentContentHash);
    expect((await rt.runner.get(first.id))!.agentVersion).toBe("1.0.0");
    const v = (await rt.boards.list("problems")).map((p) => (p.createdBy.kind === "agent" ? p.createdBy.agentVersion : ""));
    expect(new Set(v)).toEqual(new Set(["1.0.0", "1.1.0"]));
  });
});
