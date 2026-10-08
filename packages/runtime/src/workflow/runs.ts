import { ApprovalError, enqueueApprovedDraft, runDraftTask, type SpecExecutor } from "@hugents/generator";
import { approveDraft } from "@hugents/generator/admin";
import type { Actor, BoardItem } from "../boards.js";
import { RuntimeError } from "../errors.js";
import type { Runtime } from "../runtime.js";

/**
 * The two non-agent stages of the workflow. Approving a spec is a human act and reuses the generator's admin approval
 * (hash-bound, revalidating). Running it is a system act and reuses the generator queue, `assertRunnable` and the
 * restricted executor. The board item and the draft must agree on the content hash at every step.
 */

async function runItem(rt: Runtime, itemId: string, state: string): Promise<BoardItem> {
  const item = await rt.boards.get(itemId);
  if (!item || item.board !== "approved-runs") throw new RuntimeError("item-unknown", "itemId");
  if (item.state !== state) throw new RuntimeError("transition-not-allowed", "state");
  return item;
}

/** draft-ready -> approved. Needs a human admin with `approval:grant`; binds both approvals to the spec hash. */
export async function approveRun(rt: Runtime, itemId: string, human: Actor, expectedRev: number): Promise<BoardItem> {
  const item = await runItem(rt, itemId, "draft-ready");
  const plan = await rt.boards.prepareTransition(itemId, "approved", human, { expectedRev, reason: "spec approved" });
  if (human.kind !== "human") throw new RuntimeError("not-human", "actor");
  const { manifest } = rt.workflowDeps();
  const draft = await rt.drafts.get(String(item.payload.draftId));
  if (!draft || draft.contentHash !== item.payload.contentHash) throw new RuntimeError("approval-mismatch", "draft");
  let approved;
  try {
    approved = approveDraft(draft, { id: human.id, role: "admin" }, manifest, rt.now().toISOString());
  } catch (err) {
    throw new RuntimeError(err instanceof ApprovalError && err.code === "hash-mismatch" ? "approval-mismatch" : "precondition-failed", "draft");
  }
  const { transitioned } = await rt.boards.commit([], [plan]);
  await rt.drafts.save(approved);
  return transitioned[0]!;
}

/**
 * approved -> running -> passed | failed, with a `run-evidence` artifact (status, reason codes and counts only) attached
 * to the item. A missing, altered or unapproved draft never executes: the item ends `failed` with the evidence saying why.
 */
export async function executeRun(rt: Runtime, itemId: string, executor: SpecExecutor): Promise<BoardItem> {
  const item = await runItem(rt, itemId, "approved");
  rt.boards.verifyApproval(item);
  const system: Actor = { kind: "system", id: "runner" };
  const deps = rt.workflowDeps();
  const draft = await rt.drafts.get(String(item.payload.draftId));

  const fail = async (reasons: string[]) => {
    const evidence = await rt.artifacts.register({
      kind: "run-evidence",
      mime: "application/json",
      data: JSON.stringify({ draftId: item.payload.draftId, passed: false, reasons, executed: false }),
      origin: { kind: "system", stage: "run" },
    });
    return rt.boards.transition(itemId, "failed", system, { expectedRev: item.rev, reason: "not run", artifacts: [evidence] });
  };
  if (!draft || draft.contentHash !== item.payload.contentHash || draft.status !== "approved") return fail(["not-approved"]);

  const running = await rt.boards.transition(itemId, "running", system, { expectedRev: item.rev, reason: "run started" });
  const task = await enqueueApprovedDraft(deps.store, draft, deps.now());
  const done = await runDraftTask({ ...deps, executor }, task);
  const coreTask = await deps.store.getTask(task.id);
  const passed = done?.status === "passed";
  const evidence = await rt.artifacts.register({
    kind: "run-evidence",
    mime: "application/json",
    data: JSON.stringify({
      draftId: draft.id,
      contentHash: draft.contentHash,
      runTaskId: task.id,
      taskStatus: coreTask?.status ?? "unknown",
      passed,
      reasons: done?.reasons ?? [],
      executed: coreTask?.status === "completed" || coreTask?.status === "failed",
    }),
    origin: { kind: "system", stage: "run" },
  });
  return rt.boards.transition(itemId, passed ? "passed" : "failed", system, {
    expectedRev: running.rev,
    reason: passed ? "run passed" : "run failed",
    artifacts: [evidence],
  });
}
