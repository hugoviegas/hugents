import { describe, expect, it } from "vitest";
import { ApprovalError, approveDraft, assertRunnable, editDraft, hashSpec, validateSpec, type TestDraft } from "../src/index.js";
import { GOOD_SPEC, manifest, NOW } from "./fixtures.js";

const draft = (): TestDraft => ({
  id: "d1",
  requestId: "r1",
  plan: "# plan",
  spec: GOOD_SPEC,
  validation: validateSpec(GOOD_SPEC, manifest),
  status: "draft",
  contentHash: hashSpec(GOOD_SPEC),
  reasons: [],
});
const admin = { id: "hugo", role: "admin" as const };

describe("approval gate", () => {
  it("only an explicit admin action approves", () => {
    expect(() => approveDraft(draft(), { id: "agent", role: "agent" }, manifest, NOW)).toThrow(ApprovalError);
    expect(() => approveDraft(draft(), undefined, manifest, NOW)).toThrow(ApprovalError);
    const ok = approveDraft(draft(), admin, manifest, NOW);
    expect(ok.status).toBe("approved");
    expect(ok.approval).toEqual({ by: "hugo", at: NOW, contentHash: ok.contentHash });
  });

  it("unapproved drafts cannot run", () => {
    expect(() => assertRunnable(draft(), manifest)).toThrow(/not-approved/);
  });

  it("editing after approval resets approval and revalidates", () => {
    const approved = approveDraft(draft(), admin, manifest, NOW);
    const edited = editDraft(approved, { spec: GOOD_SPEC + "\n// more" }, manifest);
    expect(edited.status).toBe("draft");
    expect(edited.approval).toBeUndefined();
    expect(() => assertRunnable(edited, manifest)).toThrow(/not-approved/);
    const bad = editDraft(approved, { spec: 'const u = "https://x.example.test";' }, manifest);
    expect(bad.status).toBe("rejected");
    expect(bad.reasons.length).toBeGreaterThan(0);
  });

  it("a hash mismatch blocks the run", () => {
    const approved = approveDraft(draft(), admin, manifest, NOW);
    expect(() => assertRunnable({ ...approved, spec: GOOD_SPEC + "\n// swapped" }, manifest)).toThrow(/hash-mismatch/);
  });

  it("a rejected draft cannot be approved", () => {
    expect(() => approveDraft({ ...draft(), status: "rejected" }, admin, manifest, NOW)).toThrow(/not-approvable/);
  });
});
