import type { Sanitizer, Store, Task } from "@hugents/core";
import { ApprovalError, assertRunnable } from "./approval.js";
import type { TestDraft } from "./contracts.js";
import { createStageEmitter } from "./events.js";
import type { Manifest } from "@hugents/core";
import type { DraftRepository } from "./pipeline.js";

/** Approved draft -> task on the same serial queue as hand-written scenarios. Params are ids and a hash only. */
export async function enqueueApprovedDraft(store: Store, draft: TestDraft, now: string): Promise<Task> {
  if (draft.status !== "approved" || !draft.approval) throw new ApprovalError("not-approved");
  const task: Task = {
    id: `run-${draft.id}`,
    kind: "run-generated-test",
    status: "pending",
    params: { draftId: draft.id, contentHash: draft.contentHash },
    updatedAt: now,
  };
  await store.upsertTask(task);
  return task;
}

/**
 * Executes a spec in the restricted harness. The real implementation lives with the worker (not built yet) and must
 * open the page through `openSeededPage`. It receives the spec text, nothing else the model produced.
 */
export type SpecExecutor = (spec: string, ctx: { draftId: string }) => Promise<{ passed: boolean }>;

export interface RunDeps {
  store: Store;
  drafts: DraftRepository;
  sanitizer: Sanitizer;
  manifest: Manifest;
  executor: SpecExecutor;
  now: () => string;
}

/** Handled by the tester agent. Blocks (never executes) on a missing, unapproved or altered draft. */
export async function runDraftTask(deps: RunDeps, task: Task): Promise<TestDraft | undefined> {
  const { store, drafts, sanitizer, manifest, now } = deps;
  const draftId = String(task.params.draftId ?? "");
  const emitter = createStageEmitter(store, sanitizer, `run-${draftId}`.slice(0, 64), now);
  const ids = { taskId: task.id };
  const setTask = (status: Task["status"]) => store.upsertTask({ ...task, status, updatedAt: now() });

  const draft = await drafts.get(draftId);
  try {
    if (!draft) throw new ApprovalError("not-approved");
    if (task.params.contentHash !== draft.contentHash) throw new ApprovalError("hash-mismatch");
    assertRunnable(draft, manifest);
  } catch {
    await setTask("blocked");
    await emitter.emit("failed", ids);
    return draft;
  }

  await emitter.emit("approved", ids);
  await setTask("in_progress");
  await drafts.save({ ...draft, status: "running" });
  await emitter.emit("running", ids);
  let passed = false;
  try {
    passed = (await deps.executor(draft.spec, { draftId: draft.id })).passed;
  } catch {
    passed = false;
  }
  const done: TestDraft = { ...draft, status: passed ? "passed" : "failed" };
  await drafts.save(done);
  await setTask(passed ? "completed" : "failed");
  await emitter.emit(passed ? "completed" : "failed", ids);
  return done;
}
