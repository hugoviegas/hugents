import { describe, expect, it } from "vitest";
import type { Actor } from "../src/index.js";
import { hugo, makeRuntime, registerFixtures, reviewer } from "./helpers.js";

const critic: Actor = { kind: "agent", agentId: "design-critic", agentVersion: "1.0.0", taskId: "task-x" };
const planner: Actor = { kind: "agent", agentId: "test-planner", agentVersion: "1.0.0", taskId: "task-y" };
const problem = { title: "Button overlaps footer", severity: "high", screenId: "screen-one" };

async function setup() {
  const rt = await makeRuntime();
  await registerFixtures(rt);
  return rt;
}

describe("boards", () => {
  it("records actor, agent version, reason and artifact ids on every change", async () => {
    const rt = await setup();
    const report = await rt.artifacts.register({ kind: "report", mime: "text/markdown", data: "# r", origin: { kind: "import", actorId: "hugo" } });
    const item = await rt.boards.propose(critic, { board: "problems", state: "open", payload: problem, artifacts: [report], reason: "finding" });
    expect(item.history[0]).toMatchObject({ from: null, to: "open", actor: { kind: "agent", agentId: "design-critic", agentVersion: "1.0.0" }, reason: "finding", artifactIds: [report.id] });
    const triaged = await rt.boards.transition(item.id, "triaged", planner, { expectedRev: 1, reason: "suggested" });
    expect(triaged.history[1]).toMatchObject({ from: "open", to: "triaged", actor: { agentId: "test-planner", agentVersion: "1.0.0" }, reason: "suggested" });
    expect(triaged.rev).toBe(2);
  });

  it("agents only propose where their package allows, with schema-valid payloads", async () => {
    const rt = await setup();
    await expect(rt.boards.propose(critic, { board: "issue-drafts", state: "draft", payload: {} })).rejects.toThrow("capability-denied");
    await expect(rt.boards.propose(critic, { board: "problems", state: "triaged", payload: problem })).rejects.toThrow("invalid-board-transition");
    await expect(rt.boards.propose(critic, { board: "problems", state: "open", payload: { ...problem, extra: 1 } })).rejects.toThrow("unknown-field");
    await expect(rt.boards.propose(critic, { board: "problems", state: "open", payload: { ...problem, title: "x".repeat(121) } })).rejects.toThrow("too-long");
    await expect(rt.boards.propose(critic, { board: "nowhere", state: "open", payload: problem })).rejects.toThrow("unknown-board");
    const ghost: Actor = { kind: "agent", agentId: "design-critic", agentVersion: "7.0.0", taskId: "t" };
    await expect(rt.boards.propose(ghost, { board: "problems", state: "open", payload: problem })).rejects.toThrow("agent-not-registered");
    await expect(rt.boards.propose(critic, { board: "problems", state: "open", payload: problem, artifacts: [{ id: "art-404", kind: "report", sha256: "0".repeat(64), size: 1 }] })).rejects.toThrow("artifact-unknown");
  });

  it("sanitizes free text in payloads but keeps ids exact", async () => {
    const rt = await setup();
    const item = await rt.boards.propose(critic, { board: "problems", state: "open", payload: { ...problem, title: "see https://x.example.test/a and a@b.co" } });
    expect(item.payload.title).toBe("see [url] and [email]");
    expect(item.payload.screenId).toBe("screen-one");
  });

  it("an agent can never approve, and approvals need approval:grant from someone other than the creator", async () => {
    const rt = await setup();
    const p = await rt.boards.propose(critic, { board: "problems", state: "open", payload: problem });
    const s = await rt.boards.propose(planner, { board: "run-suggestions", state: "proposed", parentId: p.id, payload: { problemItemId: p.id, screenId: "screen-one", goal: "check" } });
    await expect(rt.boards.transition(s.id, "approved", planner, { expectedRev: 1 })).rejects.toThrow("not-human");
    await expect(rt.boards.transition(s.id, "approved", { kind: "system", id: "runner" }, { expectedRev: 1 })).rejects.toThrow("not-human");
    await expect(rt.boards.transition(s.id, "approved", { kind: "human", id: "reviewer-2", role: "admin", capabilities: [] }, { expectedRev: 1 })).rejects.toThrow("capability-denied");
    await expect(rt.boards.transition(s.id, "approved", { ...hugo, role: "viewer" } as unknown as Actor, { expectedRev: 1 })).rejects.toThrow("not-human");

    const own = await rt.boards.propose(hugo, { board: "run-suggestions", state: "proposed", parentId: p.id, payload: { problemItemId: p.id, screenId: "screen-one", goal: "mine" } });
    await expect(rt.boards.transition(own.id, "approved", hugo, { expectedRev: 1 })).rejects.toThrow("self-approval");
    const ok = await rt.boards.transition(own.id, "approved", reviewer, { expectedRev: 1 });
    expect(ok.approval?.by).toBe("reviewer-2");
    rt.boards.verifyApproval(ok);
  });

  it("rejects transitions that do not exist or that the agent did not declare", async () => {
    const rt = await setup();
    const p = await rt.boards.propose(critic, { board: "problems", state: "open", payload: problem });
    await expect(rt.boards.transition(p.id, "resolved", hugo, { expectedRev: 1 })).rejects.toThrow("transition-not-allowed");
    await expect(rt.boards.transition(p.id, "triaged", critic, { expectedRev: 1 })).rejects.toThrow("capability-denied");
    await expect(rt.boards.transition("item-nope", "triaged", planner, { expectedRev: 1 })).rejects.toThrow("item-unknown");
  });

  it("replayed and concurrent transitions apply once (stale-item)", async () => {
    const rt = await setup();
    const p = await rt.boards.propose(critic, { board: "problems", state: "open", payload: problem });
    const results = await Promise.allSettled([
      rt.boards.transition(p.id, "dismissed", hugo, { expectedRev: 1, reason: "a" }),
      rt.boards.transition(p.id, "dismissed", reviewer, { expectedRev: 1, reason: "b" }),
      rt.boards.transition(p.id, "triaged", planner, { expectedRev: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const after = (await rt.boards.get(p.id))!;
    expect(after.rev).toBe(2);
    expect(after.history).toHaveLength(2);
    // replaying the same request later fails too
    await expect(rt.boards.transition(p.id, "dismissed", hugo, { expectedRev: 1 })).rejects.toThrow(/stale-item|transition-not-allowed/);
  });

  it("filing an issue draft needs github:create-issue on a human", async () => {
    const rt = await setup();
    const reviewerAgent: Actor = { kind: "agent", agentId: "issue-reviewer", agentVersion: "1.0.0", taskId: "t" };
    const body = await rt.artifacts.register({ kind: "issue-draft", mime: "text/markdown", data: "# draft", origin: { kind: "system", stage: "test" } });
    const d = await rt.boards.propose(reviewerAgent, {
      board: "issue-drafts",
      state: "draft",
      payload: { runItemId: "item-1", problemItemId: "item-2", title: "t", severity: "low", outcome: "failed", bodyArtifactId: body.id },
      artifacts: [body],
    });
    await expect(rt.boards.transition(d.id, "approved", reviewerAgent, { expectedRev: 1 })).rejects.toThrow("not-human");
    const approved = await rt.boards.transition(d.id, "approved", reviewer, { expectedRev: 1 });
    await expect(rt.boards.transition(d.id, "filed", reviewerAgent, { expectedRev: approved.rev })).rejects.toThrow("not-human");
    await expect(rt.boards.transition(d.id, "filed", reviewer, { expectedRev: approved.rev })).rejects.toThrow("capability-denied");
    expect((await rt.boards.transition(d.id, "filed", hugo, { expectedRev: approved.rev })).state).toBe("filed");
  });

  it("an approval stops verifying once the stored payload changes", async () => {
    const rt = await setup();
    const p = await rt.boards.propose(critic, { board: "problems", state: "open", payload: problem });
    const s = await rt.boards.propose(planner, { board: "run-suggestions", state: "proposed", payload: { problemItemId: p.id, screenId: "screen-one", goal: "check" } });
    await rt.boards.transition(s.id, "approved", hugo, { expectedRev: 1 });
    await rt.db.mutate<{ payload: Record<string, unknown> }, void>("board-items", (all) => {
      all[s.id]!.payload.goal = "delete the account";
    });
    const forged = (await rt.boards.get(s.id))!;
    expect(() => rt.boards.verifyApproval(forged)).toThrow("approval-mismatch");
  });
});
