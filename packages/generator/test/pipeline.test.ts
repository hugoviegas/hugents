import { describe, expect, it, vi } from "vitest";
import {
  approveDraft, createRequest, DeterministicProvider, enqueueApprovedDraft, generateDraft, ProviderFailure, runDraftTask,
  type ExplorationObservation, type TestGenerationProvider,
} from "../src/index.js";
import { GOOD_SPEC, makeDeps, manifest, NOW, sanitizer } from "./fixtures.js";

const request = (screenId = "screen-one", goal = "Exercise this screen") =>
  createRequest({ id: "r1", projectId: "example-project", sourceId: "obs1", screenId, goal, createdBy: "explorer", createdAt: NOW }, sanitizer);
const observation = (screenId = "screen-one"): ExplorationObservation => ({
  screenId,
  elements: [{ role: "button", name: "Save" }, { role: "heading", name: "Settings" }],
});
const stages = async (d: ReturnType<typeof makeDeps>, id: string) =>
  (await d.store.listEvents(id)).map((e) => `${e.status}/${e.phase}`);
const admin = { id: "hugo", role: "admin" as const };

describe("request contract", () => {
  it("sanitizes and caps the goal, and rejects non-opaque ids", () => {
    const r = request("screen-one", `mail me at a@example.test ${"x ".repeat(300)}`);
    expect(r.goal).not.toContain("@");
    expect(r.goal.length).toBeLessThanOrEqual(200);
    expect(() => createRequest({ ...r, id: "../x", createdAt: NOW }, sanitizer)).toThrow();
  });
});

describe("generation pipeline", () => {
  it("produces a validated draft with no model (deterministic skeleton)", async () => {
    const d = makeDeps();
    const draft = await generateDraft(d, request(), observation());
    expect(draft.status).toBe("draft");
    expect(draft.validation.ok).toBe(true);
    expect(draft.approval).toBeUndefined();
    expect(await stages(d, "gen-r1")).toEqual([
      "waiting/queued", "planning/analyze", "working/analyze", "reviewing/analyze", "waiting/report",
    ]);
  });

  it.each([
    ["timeout", "provider-unavailable"],
    ["quota", "provider-unavailable"],
    ["malformed", "provider-malformed"],
  ] as const)("provider %s never yields an approved or running draft", async (code, reason) => {
    const d = makeDeps();
    const provider: TestGenerationProvider = { name: "x", plan: async () => { throw new ProviderFailure(code); }, generateSpec: async () => "" };
    const draft = await generateDraft({ ...d, provider }, request(), observation());
    expect(draft.status).toBe("rejected");
    expect(draft.reasons).toEqual([reason]);
    const last = (await d.store.listEvents("gen-r1")).at(-1);
    expect(last?.status).toBe("failed");
  });

  it("a provider returning non-strings or garbage is malformed or rejected", async () => {
    const d = makeDeps();
    const provider = { name: "x", plan: async () => "plan", generateSpec: async () => 42 as unknown as string };
    expect((await generateDraft({ ...d, provider }, request(), observation())).reasons).toEqual(["provider-malformed"]);
  });

  it("rejects a generated spec that breaks a rule, with reason codes", async () => {
    const d = makeDeps();
    const provider: TestGenerationProvider = {
      name: "x",
      plan: async () => "# plan",
      generateSpec: async () => GOOD_SPEC.replace("Save", "Delete account"),
    };
    const draft = await generateDraft({ ...d, provider }, request(), observation());
    expect(draft.status).toBe("rejected");
    expect(draft.reasons).toContain("forbidden-action");
    expect((await d.store.listEvents("gen-r1")).at(-1)?.status).toBe("blocked");
  });

  it("never sends seeded e-mail, token, room code or URL to the provider or stores them", async () => {
    const d = makeDeps();
    const token = "Zk3" + "q9X7".repeat(9);
    const seen: string[] = [];
    const provider: TestGenerationProvider = {
      name: "spy",
      plan: async (i) => { seen.push(JSON.stringify(i)); return "# plan"; },
      generateSpec: async (_p, i) => { seen.push(JSON.stringify(i)); return GOOD_SPEC; },
    };
    const obs: ExplorationObservation = {
      screenId: "screen-one",
      elements: [
        { role: "button", name: "mail fake.person@example.test" },
        { role: "heading", name: `key ${token}` },
        { role: "heading", name: "Room code: AB12CD" },
        { role: "link", name: "see https://qa-one.example.test/r/secret" },
      ],
    };
    const draft = await generateDraft({ ...d, provider }, request("screen-one", "visit https://qa-one.example.test now"), obs);
    const blob = seen.join("\n") + JSON.stringify(draft);
    for (const leak of ["fake.person@example.test", token, "AB12CD", "qa-one.example.test"]) expect(blob).not.toContain(leak);
    expect(seen.length).toBe(2);
  });

  it("hidden and unknown screens never reach a provider", async () => {
    const d = makeDeps();
    const plan = vi.fn(async () => "# plan");
    const provider: TestGenerationProvider = { name: "spy", plan, generateSpec: async () => GOOD_SPEC };
    const hidden = await generateDraft({ ...d, provider }, request("screen-hidden"), observation("screen-hidden"));
    expect(hidden.reasons).toEqual(["screen-hidden"]);
    const unknown = await generateDraft({ ...makeDeps(), provider }, request("nope"), observation("nope"));
    expect(unknown.reasons).toEqual(["screen-unknown"]);
    expect(plan).not.toHaveBeenCalled();
  });

  it("the deterministic skeleton always passes its own validator", async () => {
    const p = new DeterministicProvider();
    const input = { screenId: "screen-one", goal: "g", elements: [{ role: "button", name: 'Quote "x" \\ end' }] };
    const spec = await p.generateSpec(await p.plan(input), input);
    const d = makeDeps();
    const draft = await generateDraft({ ...d, provider: { name: "s", plan: async () => "# p", generateSpec: async () => spec } }, request(), { screenId: "screen-one", elements: input.elements });
    expect(draft.validation.ok).toBe(true);
  });
});

describe("full flow with a mocked run", () => {
  it("request -> draft -> approval -> queue -> run -> recorded result, events in order", async () => {
    const d = makeDeps();
    const draft = await generateDraft(d, request(), observation());
    const approved = approveDraft(draft, admin, manifest, NOW);
    await d.drafts.save(approved);
    const task = await enqueueApprovedDraft(d.store, approved, NOW);
    expect(task).toMatchObject({ kind: "run-generated-test", status: "pending", params: { draftId: draft.id } });

    const executor = vi.fn(async () => ({ passed: true }));
    const done = await runDraftTask({ ...d, executor }, task);
    expect(done?.status).toBe("passed");
    expect((await d.store.getTask(task.id))?.status).toBe("completed");
    expect((await d.drafts.get(draft.id))?.status).toBe("passed");
    expect(await stages(d, `run-${draft.id}`)).toEqual(["working/queued", "working/play", "completed/teardown"]);
  });

  it("a failing run is recorded as failed", async () => {
    const d = makeDeps();
    const approved = approveDraft(await generateDraft(d, request(), observation()), admin, manifest, NOW);
    await d.drafts.save(approved);
    const task = await enqueueApprovedDraft(d.store, approved, NOW);
    const done = await runDraftTask({ ...d, executor: async () => { throw new Error("boom"); } }, task);
    expect(done?.status).toBe("failed");
    expect((await d.store.getTask(task.id))?.status).toBe("failed");
  });

  it("an unapproved draft cannot be queued or run", async () => {
    const d = makeDeps();
    const draft = await generateDraft(d, request(), observation());
    await expect(enqueueApprovedDraft(d.store, draft, NOW)).rejects.toThrow(/not-approved/);
    await d.drafts.save(draft);
    const executor = vi.fn(async () => ({ passed: true }));
    await runDraftTask({ ...d, executor }, { id: "run-x", kind: "run-generated-test", status: "pending", params: { draftId: draft.id, contentHash: draft.contentHash }, updatedAt: NOW });
    expect(executor).not.toHaveBeenCalled();
  });

  it("tampering after approval blocks the run", async () => {
    const d = makeDeps();
    const approved = approveDraft(await generateDraft(d, request(), observation()), admin, manifest, NOW);
    const task = await enqueueApprovedDraft(d.store, approved, NOW);
    await d.drafts.save({ ...approved, spec: approved.spec + "\n// swapped" });
    const executor = vi.fn(async () => ({ passed: true }));
    await runDraftTask({ ...d, executor }, task);
    expect(executor).not.toHaveBeenCalled();
    expect((await d.store.getTask(task.id))?.status).toBe("blocked");
    expect((await d.store.listEvents(`run-${approved.id}`)).at(-1)?.status).toBe("failed");
  });
});
