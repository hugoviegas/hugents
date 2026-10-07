import type { Manifest, Sanitizer, Store } from "@hugents/core";
import { createRequest, generateDraft, type DraftRepository, type TestDraft } from "@hugents/generator";
import { payloadHash, type BoardItem } from "../boards.js";
import { ToolFailure } from "../errors.js";
import type { Db } from "../persist.js";
import type { Schema } from "../schema.js";
import type { ToolContext, ToolDefinition, ToolRegistry } from "../tools.js";

/**
 * Tools for the first workflow: design critic -> test planner -> (human) -> run creator -> runner -> issue reviewer.
 * They are plugins: the runtime does not know them, agent packages select them by name. Playwright generation is a
 * capability of `run-creator.generate`, which reuses the generator pipeline and validator unchanged.
 */

/** Drafts kept in the runtime files (the persistence that #14 originally asked for), behind the generator's interface. */
export class DbDraftRepository implements DraftRepository {
  constructor(private readonly db: Db) {}
  async save(draft: TestDraft): Promise<void> {
    await this.db.mutate<TestDraft, void>("drafts", (all) => {
      all[draft.id] = structuredClone(draft);
    });
  }
  async get(id: string): Promise<TestDraft | undefined> {
    return (await this.db.read<TestDraft>("drafts"))[id];
  }
}

export interface WorkflowDeps {
  manifest: Manifest;
  drafts: DraftRepository;
  store: Store;
  sanitizer: Sanitizer;
  now: () => string;
}

const ID = { type: "string", maxLength: 64, pattern: "^[A-Za-z0-9_-]{1,64}$" } as const;
const SCREEN = { type: "string", maxLength: 64, pattern: "^[a-z0-9][a-z0-9-]{0,63}$" } as const;
const SEVERITY = { type: "string", enum: ["low", "medium", "high"] } as const;
const obj = (properties: Record<string, Schema>, required: string[]): Schema => ({ type: "object", additionalProperties: false, properties, required });

const FINDING = /^\s*[-*]\s*\[(low|medium|high)\]\s*(.+)$/gim;
const SCREEN_HINT = /\(\s*screen:\s*([a-z0-9][a-z0-9-]{0,63})\s*\)/i;
const ROLES = ["button", "link", "heading", "tab", "checkbox", "textbox", "dialog", "main", "navigation"];

async function mustRead(ctx: ToolContext, id: string, board: BoardItem["board"], states: readonly string[]): Promise<BoardItem> {
  const item = await ctx.readItem(id);
  if (!item || item.board !== board || !states.includes(item.state)) throw new ToolFailure("precondition-failed");
  return item;
}

/** Reads the critic's Markdown report: `- [severity] text (screen: id)` lines. The text is data, never instructions. */
export const designCriticReview: ToolDefinition = {
  name: "design-critic.review",
  version: "1.0.0",
  description: "Turns design-critic report findings and their screenshots into problem items.",
  requires: ["artifact:read", "board:propose"],
  inputSchema: obj({ focus: { type: "string", maxLength: 200 } }, []),
  outputSchema: obj(
    {
      problems: { type: "array", maxItems: 20, items: obj({ title: { type: "string", maxLength: 120 }, severity: SEVERITY, screenId: SCREEN }, ["title", "severity", "screenId"]) },
      screenshotsReviewed: { type: "integer", minimum: 0, maximum: 50 },
    },
    ["problems", "screenshotsReviewed"],
  ),
  async run(ctx) {
    const reports = ctx.artifacts.filter((a) => a.ref.kind === "report");
    const shots = ctx.artifacts.filter((a) => a.ref.kind === "screenshot");
    if (!reports.length) throw new ToolFailure("precondition-failed");
    const problems: { title: string; severity: "low" | "medium" | "high"; screenId: string; from: string }[] = [];
    for (const report of reports) {
      const text = (await report.read()).toString("utf8");
      for (const m of text.matchAll(FINDING)) {
        if (problems.length >= 20) break;
        const raw = m[2] ?? "";
        const screenId = SCREEN_HINT.exec(raw)?.[1]?.toLowerCase() ?? "unknown";
        const title = ctx.sanitize(raw.replace(SCREEN_HINT, ""), 120);
        if (title) problems.push({ title, severity: (m[1] ?? "low").toLowerCase() as "low", screenId, from: report.ref.id });
      }
    }
    return {
      output: { problems: problems.map(({ title, severity, screenId }) => ({ title, severity, screenId })), screenshotsReviewed: shots.length },
      proposals: problems.map((p) => ({
        board: "problems",
        state: "open",
        payload: { title: p.title, severity: p.severity, screenId: p.screenId },
        artifacts: [reports.find((r) => r.ref.id === p.from)!.ref, ...shots.map((s) => s.ref)],
        reason: "design-critic finding",
      })),
    };
  },
};

export const testPlannerSuggest: ToolDefinition = {
  name: "test-planner.suggest",
  version: "1.0.0",
  description: "Proposes one run suggestion for an open problem and marks the problem triaged.",
  requires: ["board:read", "board:propose", "board:transition"],
  inputSchema: obj({ problemItemId: ID }, ["problemItemId"]),
  outputSchema: obj({ screenId: SCREEN, goal: { type: "string", maxLength: 200 } }, ["screenId", "goal"]),
  async run(ctx) {
    const problem = await mustRead(ctx, String(ctx.input.problemItemId), "problems", ["open"]);
    const screenId = String(problem.payload.screenId);
    const goal = ctx.sanitize(`Check that this no longer happens: ${String(problem.payload.title)}`, 200);
    return {
      output: { screenId, goal },
      proposals: [
        {
          board: "run-suggestions",
          state: "proposed",
          parentId: problem.id,
          payload: { problemItemId: problem.id, screenId, goal, rationale: `Severity ${String(problem.payload.severity)} problem reported on ${screenId}.` },
          artifacts: problem.artifacts,
        },
      ],
      transitions: [{ itemId: problem.id, to: "triaged", reason: "run suggested" }],
    };
  },
};

export function runCreatorGenerate(deps: WorkflowDeps): ToolDefinition {
  return {
    name: "run-creator.generate",
    version: "1.0.0",
    description: "Generates and validates a Playwright spec draft for an approved run suggestion. Never approves or runs it.",
    requires: ["board:read", "board:propose", "board:transition", "artifact:write"],
    inputSchema: obj(
      {
        suggestionItemId: ID,
        elements: { type: "array", maxItems: 40, items: obj({ role: { type: "string", enum: ROLES }, name: { type: "string", maxLength: 80 } }, ["role", "name"]) },
      },
      ["suggestionItemId", "elements"],
    ),
    outputSchema: obj(
      { draftId: ID, contentHash: { type: "string", maxLength: 64, pattern: "^[a-f0-9]{64}$" }, checks: { type: "integer", minimum: 0, maximum: 400 } },
      ["draftId", "contentHash"],
    ),
    async run(ctx) {
      const suggestion = await mustRead(ctx, String(ctx.input.suggestionItemId), "run-suggestions", ["approved"]);
      // the human approval must cover exactly this payload and these artifacts
      if (!suggestion.approval || suggestion.approval.payloadHash !== payloadHash(suggestion)) throw new ToolFailure("precondition-failed");
      const screenId = String(suggestion.payload.screenId);
      const request = createRequest(
        {
          id: `req-${ctx.taskId}`.slice(0, 64),
          projectId: deps.manifest.projectId,
          sourceId: String(suggestion.payload.problemItemId),
          screenId,
          goal: String(suggestion.payload.goal),
          createdBy: ctx.agent.id,
          createdAt: deps.now(),
        },
        deps.sanitizer,
      );
      const elements = (ctx.input.elements as { role: string; name: string }[]).map((e) => ({ role: e.role, name: e.name }));
      const draft = await generateDraft(
        { store: deps.store, drafts: deps.drafts, sanitizer: deps.sanitizer, manifest: deps.manifest, now: deps.now, restrictToObservedElements: true },
        request,
        { screenId, elements },
      );
      if (draft.status !== "draft") throw new ToolFailure("draft-rejected");
      const spec = await ctx.writeArtifact("generated-spec", "text/typescript", draft.spec);
      return {
        output: { draftId: draft.id, contentHash: draft.contentHash, checks: draft.spec.split("\n").filter((l) => l.includes("expect(")).length },
        proposals: [
          {
            board: "approved-runs",
            state: "draft-ready",
            parentId: suggestion.id,
            payload: { suggestionItemId: suggestion.id, draftId: draft.id, contentHash: draft.contentHash, screenId },
            artifacts: [spec, ...suggestion.artifacts],
          },
        ],
        transitions: [{ itemId: suggestion.id, to: "consumed", reason: "spec draft created" }],
      };
    },
  };
}

const short = (hash: string) => hash.slice(0, 12);

export const issueReviewerDraft: ToolDefinition = {
  name: "issue-reviewer.draft",
  version: "1.0.0",
  description: "Writes a GitHub issue draft for a finished run, with artifact references only. Never files it.",
  requires: ["board:read", "board:propose", "artifact:read", "artifact:write"],
  inputSchema: obj({ runItemId: ID }, ["runItemId"]),
  outputSchema: obj({ title: { type: "string", maxLength: 120 }, severity: SEVERITY, outcome: { type: "string", enum: ["passed", "failed"] } }, ["title", "severity", "outcome"]),
  async run(ctx) {
    const run = await mustRead(ctx, String(ctx.input.runItemId), "approved-runs", ["passed", "failed"]);
    const suggestion = await mustRead(ctx, String(run.parentId ?? ""), "run-suggestions", ["consumed"]);
    const problem = await mustRead(ctx, String(suggestion.parentId ?? ""), "problems", ["triaged", "resolved", "dismissed"]);
    const evidenceRef = run.artifacts.find((a) => a.kind === "run-evidence");
    if (!evidenceRef) throw new ToolFailure("precondition-failed");
    const evidence = JSON.parse((await ctx.readArtifact(evidenceRef.id)).bytes.toString("utf8")) as { reasons?: unknown };
    // evidence holds reason codes only; anything else is dropped rather than copied into the draft
    const reasons = Array.isArray(evidence.reasons) ? evidence.reasons.filter((r): r is string => typeof r === "string" && /^[a-z-]{1,40}$/.test(r)).slice(0, 10) : [];

    const outcome = run.state === "passed" ? "passed" : "failed";
    const severity = problem.payload.severity as "low" | "medium" | "high";
    const title = ctx.sanitize(`${outcome === "failed" ? "" : "Not reproduced: "}${String(problem.payload.title)}`, 120);
    const all = [...new Map([...problem.artifacts, ...suggestion.artifacts, ...run.artifacts].map((a) => [a.id, a])).values()];
    const approvals = [suggestion, run].filter((i) => i.approval).map((i) => `- ${i.board} item ${i.id} approved by ${i.approval!.by} at ${i.approval!.at}`);
    const body = [
      `# ${title}`,
      "",
      `Severity: ${severity} · Screen: ${String(problem.payload.screenId)} · Run outcome: ${outcome}${reasons.length ? ` (${reasons.join(", ")})` : ""}`,
      "",
      "## Problem",
      `${String(problem.payload.title)} (problem item ${problem.id})`,
      "",
      "## Reproduction",
      `Goal: ${String(suggestion.payload.goal)}`,
      `Spec draft ${String(run.payload.draftId)}, sha256 ${short(String(run.payload.contentHash))}, validated by the generator and approved before it ran.`,
      "",
      "## Evidence (artifact references, contents not copied)",
      ...all.map((a) => `- ${a.kind} ${a.id} sha256:${short(a.sha256)} ${a.size} bytes`),
      "",
      "## Approvals",
      ...approvals,
      "",
      "_Draft for human review. Not filed: filing needs a human with the github:create-issue capability._",
      "",
    ].join("\n");
    const draft = await ctx.writeArtifact("issue-draft", "text/markdown", body);
    return {
      output: { title, severity, outcome },
      proposals: [
        {
          board: "issue-drafts",
          state: "draft",
          parentId: run.id,
          payload: { runItemId: run.id, problemItemId: problem.id, title, severity, outcome, bodyArtifactId: draft.id },
          artifacts: [draft, ...all],
        },
      ],
    };
  },
};

export function registerWorkflowTools(tools: ToolRegistry, deps: () => WorkflowDeps): ToolRegistry {
  // `deps` is read at run time, so validating or importing packages does not need a project manifest
  const lazy = runCreatorGenerate({
    get manifest() { return deps().manifest; },
    get drafts() { return deps().drafts; },
    get store() { return deps().store; },
    get sanitizer() { return deps().sanitizer; },
    now: () => deps().now(),
  });
  return tools.register(designCriticReview).register(testPlannerSuggest).register(lazy).register(issueReviewerDraft);
}
