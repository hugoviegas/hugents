import type { Sanitizer, Store } from "@hugents/core";
import { hashSpec } from "./approval.js";
import type { ReasonCode, TestDraft, TestRequest } from "./contracts.js";
import { createStageEmitter } from "./events.js";
import type { GeneratorManifest } from "./manifest.js";
import { validateSpec } from "./validator.js";

/** What a model may see about a screen: sanitized role and name pairs. No page text blocks, URLs or ids. */
export interface ExplorationInput {
  screenId: string;
  goal: string;
  elements: { role: string; name: string }[];
}

/** Raw observation from the tester agent. Untrusted: it holds visible page text. */
export interface ExplorationObservation {
  screenId: string;
  elements: { role: string; name: string }[];
}

const ROLES = new Set(["button", "link", "heading", "tab", "checkbox", "textbox", "dialog", "main", "navigation"]);
const MAX_ELEMENTS = 40;
const MAX_NAME = 80;

/** Project rule on top of the core sanitizer: room-code-like text after a room word. */
export const ROOM_CODE_RULE = { name: "room-code", pattern: /\b(?:room|sala|c[oó]digo)\b(?:\s+(?:code|c[oó]digo))?[\s:#-]*\b[A-Za-z0-9]{4,8}\b/gi };

/** Returns undefined for hidden or unknown screens, so their content can never reach a provider. */
export function buildExplorationInput(
  observation: ExplorationObservation,
  request: Pick<TestRequest, "screenId" | "goal">,
  manifest: GeneratorManifest,
  sanitizer: Sanitizer,
): ExplorationInput | undefined {
  const screen = manifest.screens.find((s) => s.id === request.screenId);
  if (!screen || screen.hidden || observation.screenId !== screen.id) return undefined;
  const elements = observation.elements
    .filter((e) => ROLES.has(e.role))
    .slice(0, MAX_ELEMENTS)
    .map((e) => ({ role: e.role, name: sanitizer.sanitizeText(e.name, MAX_NAME) }))
    .filter((e) => e.name.length > 0);
  return { screenId: screen.id, goal: request.goal, elements };
}

export type ProviderFailureCode = "timeout" | "quota" | "malformed" | "unavailable";

export class ProviderFailure extends Error {
  constructor(readonly code: ProviderFailureCode) {
    super(code);
    this.name = "ProviderFailure";
  }
}

/** Providers write plan text and spec code only. They never pick the target, account, tools or whether to run. */
export interface TestGenerationProvider {
  readonly name: string;
  plan(input: ExplorationInput): Promise<string>;
  generateSpec(plan: string, input: ExplorationInput): Promise<string>;
}

const q = (s: string) => JSON.stringify(s);

/** Deterministic provider: a visibility-only skeleton, no model involved. Also the fallback when none is configured. */
export class DeterministicProvider implements TestGenerationProvider {
  readonly name = "deterministic";

  async plan(input: ExplorationInput): Promise<string> {
    const lines = input.elements.slice(0, 5).map((e) => `- Expect ${e.role} ${q(e.name)} to be visible.`);
    return [`# Plan: ${input.screenId}`, "", "Skeleton: confirms the screen renders. No interactions.", "", ...lines].join("\n");
  }

  async generateSpec(_plan: string, input: ExplorationInput): Promise<string> {
    const checks = input.elements
      .slice(0, 5)
      .map((e) => `  await expect(page.getByRole(${q(e.role)}, { name: ${q(e.name)} })).toBeVisible();`);
    return [
      `import { test, expect } from "hugents-seed";`,
      "",
      `test(${q(`${input.screenId} renders`)}, async ({ page }) => {`,
      `  await expect(page.getByRole("main")).toBeVisible();`,
      ...checks,
      `});`,
      "",
    ].join("\n");
  }
}

export interface DraftRepository {
  save(draft: TestDraft): Promise<void>;
  get(id: string): Promise<TestDraft | undefined>;
}

export class InMemoryDraftRepository implements DraftRepository {
  private readonly drafts = new Map<string, TestDraft>();
  async save(draft: TestDraft): Promise<void> {
    this.drafts.set(draft.id, structuredClone(draft));
  }
  async get(id: string): Promise<TestDraft | undefined> {
    const d = this.drafts.get(id);
    return d && structuredClone(d);
  }
}

export interface PipelineDeps {
  store: Store;
  drafts: DraftRepository;
  sanitizer: Sanitizer;
  manifest: GeneratorManifest;
  /** Omit to use the deterministic skeleton. A configured provider that fails produces a rejected draft. */
  provider?: TestGenerationProvider;
  now: () => string;
}

const FAILURE_REASON: Record<ProviderFailureCode, ReasonCode> = {
  timeout: "provider-unavailable",
  quota: "provider-unavailable",
  unavailable: "provider-unavailable",
  malformed: "provider-malformed",
};

function sanitizePlan(plan: string, sanitizer: Sanitizer): string {
  return plan
    .split("\n")
    .map((l) => sanitizer.sanitizeText(l, 300))
    .join("\n")
    .slice(0, 4000);
}

/**
 * request -> plan -> spec -> validation. Never approves and never runs anything. The draft id is `draft-<requestId>`.
 */
export async function generateDraft(
  deps: PipelineDeps,
  request: TestRequest,
  observation: ExplorationObservation,
): Promise<TestDraft> {
  const { store, drafts, sanitizer, manifest, now } = deps;
  const provider = deps.provider ?? new DeterministicProvider();
  const emitter = createStageEmitter(store, sanitizer, `gen-${request.id}`, now);
  const ids = { taskId: `gen-${request.id}` };
  const id = `draft-${request.id}`;

  const finish = async (spec: string, plan: string, reasons: ReasonCode[], validation: TestDraft["validation"], status: TestDraft["status"]) => {
    const draft: TestDraft = { id, requestId: request.id, plan, spec, validation, status, contentHash: hashSpec(spec), reasons };
    await drafts.save(draft);
    return draft;
  };

  await emitter.emit("requested", ids);

  const input = buildExplorationInput(observation, request, manifest, sanitizer);
  if (!input) {
    const hidden = manifest.screens.some((s) => s.id === request.screenId && s.hidden);
    const code: ReasonCode = hidden ? "screen-hidden" : "screen-unknown";
    await emitter.emit("rejected", ids);
    return finish("", "", [code], { ok: false, issues: [{ code }] }, "rejected");
  }

  let plan: string;
  let spec: string;
  try {
    await emitter.emit("planning", ids);
    plan = await provider.plan(input);
    if (typeof plan !== "string" || !plan.trim()) throw new ProviderFailure("malformed");
    await emitter.emit("generating", ids);
    spec = await provider.generateSpec(plan, input);
    if (typeof spec !== "string" || !spec.trim()) throw new ProviderFailure("malformed");
  } catch (err) {
    const code: ReasonCode = err instanceof ProviderFailure ? FAILURE_REASON[err.code] : "provider-unavailable";
    await emitter.emit("failed", ids);
    return finish("", "", [code], { ok: false, issues: [{ code }] }, "rejected");
  }

  await emitter.emit("validating", ids);
  const validation = validateSpec(spec, manifest);
  const safePlan = sanitizePlan(plan, sanitizer);
  if (!validation.ok) {
    await emitter.emit("rejected", ids);
    return finish(spec, safePlan, validation.issues.map((i) => i.code), validation, "rejected");
  }
  await emitter.emit("awaiting-approval", ids);
  return finish(spec, safePlan, [], validation, "draft");
}
