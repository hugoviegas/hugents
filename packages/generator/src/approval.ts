import { createHash } from "node:crypto";
import type { TestDraft, ValidatorResult } from "./contracts.js";
import type { GeneratorManifest } from "./manifest.js";
import { validateSpec } from "./validator.js";

const validateDraft = (draft: Pick<TestDraft, "spec" | "allowedElements">, spec: string, manifest: GeneratorManifest) =>
  validateSpec(spec, manifest, { allowedElements: draft.allowedElements });

export function hashSpec(spec: string): string {
  return createHash("sha256").update(spec, "utf8").digest("hex");
}

/** Only a human admin acting through the admin surface qualifies. Agents and models never do. */
export interface AdminActor {
  id: string;
  role: "admin";
}

export class ApprovalError extends Error {
  constructor(readonly code: "not-admin" | "not-approvable" | "hash-mismatch" | "not-approved" | "invalid-spec") {
    super(code);
    this.name = "ApprovalError";
  }
}

function isAdmin(actor: unknown): actor is AdminActor {
  return typeof actor === "object" && actor !== null && (actor as AdminActor).role === "admin" && typeof (actor as AdminActor).id === "string";
}

/**
 * draft -> approved. This function trusts its caller: it checks the shape of `actor`, not who is really behind it.
 * Identity must be verified at the admin API before this is called. It is exported from `./admin` only.
 *
 *  Revalidates, so a stale validator result can never be approved. */
export function approveDraft(draft: TestDraft, actor: unknown, manifest: GeneratorManifest, now: string): TestDraft {
  if (!isAdmin(actor)) throw new ApprovalError("not-admin");
  if (draft.status !== "draft") throw new ApprovalError("not-approvable");
  const hash = hashSpec(draft.spec);
  if (hash !== draft.contentHash) throw new ApprovalError("hash-mismatch");
  if (!validateDraft(draft, draft.spec, manifest).ok) throw new ApprovalError("invalid-spec");
  return { ...draft, status: "approved", approval: { by: actor.id, at: now, contentHash: hash } };
}

/** Any edit revalidates and drops the approval. The draft goes back to `draft` (or `rejected`). */
export function editDraft(draft: TestDraft, changes: { plan?: string; spec?: string }, manifest: GeneratorManifest): TestDraft {
  if (draft.status === "running") throw new ApprovalError("not-approvable");
  const spec = changes.spec ?? draft.spec;
  const validation: ValidatorResult = validateDraft(draft, spec, manifest);
  const { approval: _dropped, ...rest } = draft;
  void _dropped;
  return {
    ...rest,
    plan: changes.plan ?? draft.plan,
    spec,
    contentHash: hashSpec(spec),
    validation,
    status: validation.ok ? "draft" : "rejected",
    reasons: validation.issues.map((i) => i.code),
  };
}

/** Gate before any execution: approved, approval bound to this exact content, and the spec still validates. */
export function assertRunnable(draft: TestDraft, manifest: GeneratorManifest): void {
  if (draft.status !== "approved" || !draft.approval) throw new ApprovalError("not-approved");
  const hash = hashSpec(draft.spec);
  if (hash !== draft.contentHash || hash !== draft.approval.contentHash) throw new ApprovalError("hash-mismatch");
  if (!validateDraft(draft, draft.spec, manifest).ok) throw new ApprovalError("invalid-spec");
}
