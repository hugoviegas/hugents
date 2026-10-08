import type { Sanitizer } from "@hugents/core";
import type { ArtifactRef, ArtifactRegistry } from "./artifacts.js";
import { RuntimeError } from "./errors.js";
import type { Db } from "./persist.js";
import { checkSchema, sanitizeFreeText, validateValue, type Schema } from "./schema.js";
import { OPAQUE_ID, defaultNewId, hashValue, snapshot } from "./util.js";

/** Capabilities only a verified human holds. No agent package may declare them. */
export const HUMAN_CAPABILITIES = ["approval:grant", "github:create-issue", "config:mutate"] as const;
export type HumanCapability = (typeof HUMAN_CAPABILITIES)[number];

/**
 * Who acts. The runtime trusts the shape of a human actor, like `approveDraft` does: identity must be verified by the
 * admin surface before a human actor is built. Agent actors are built by the runner only, from the task it runs.
 */
export type Actor =
  | { kind: "human"; id: string; role: "admin"; capabilities: readonly HumanCapability[] }
  | { kind: "agent"; agentId: string; agentVersion: string; taskId: string }
  | { kind: "system"; id: "runner" | "runtime" };

export type ActorRef =
  | { kind: "human"; id: string }
  | { kind: "agent"; agentId: string; agentVersion: string; taskId: string }
  | { kind: "system"; id: string };

export const actorRef = (a: Actor): ActorRef =>
  a.kind === "human" ? { kind: "human", id: a.id } : a.kind === "agent" ? { kind: "agent", agentId: a.agentId, agentVersion: a.agentVersion, taskId: a.taskId } : { kind: "system", id: a.id };

export interface TransitionDef {
  from: string;
  to: string;
  by: "agent" | "human" | "system";
  /** An approval: human only, never by the creator, and bound to the payload hash. */
  approval?: true;
  /** Extra human capability required (e.g. filing an issue). */
  capability?: HumanCapability;
}

export interface BoardDefinition {
  id: BoardId;
  version: number;
  states: readonly string[];
  /** States an item may be created in. */
  initial: readonly string[];
  transitions: readonly TransitionDef[];
  itemSchema: Schema;
}

export const BOARD_IDS = ["problems", "run-suggestions", "approved-runs", "issue-drafts"] as const;
export type BoardId = (typeof BOARD_IDS)[number];

const ID_PATTERN = "^[A-Za-z0-9_-]{1,64}$";
const SCREEN = { type: "string", maxLength: 64, pattern: "^[a-z0-9][a-z0-9-]{0,63}$" } as const;
const SEVERITY = { type: "string", enum: ["low", "medium", "high"] } as const;
const ITEM_ID = { type: "string", maxLength: 64, pattern: ID_PATTERN } as const;

export const BOARDS: Record<BoardId, BoardDefinition> = {
  problems: {
    id: "problems",
    version: 1,
    states: ["open", "triaged", "dismissed", "resolved"],
    initial: ["open"],
    transitions: [
      { from: "open", to: "triaged", by: "agent" },
      { from: "open", to: "dismissed", by: "human" },
      { from: "triaged", to: "dismissed", by: "human" },
      { from: "triaged", to: "resolved", by: "human" },
    ],
    itemSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "severity", "screenId"],
      properties: { title: { type: "string", maxLength: 120 }, severity: SEVERITY, screenId: SCREEN, summary: { type: "string", maxLength: 600 } },
    },
  },
  "run-suggestions": {
    id: "run-suggestions",
    version: 1,
    states: ["proposed", "approved", "rejected", "consumed"],
    initial: ["proposed"],
    transitions: [
      { from: "proposed", to: "approved", by: "human", approval: true },
      { from: "proposed", to: "rejected", by: "human" },
      { from: "approved", to: "consumed", by: "agent" },
    ],
    itemSchema: {
      type: "object",
      additionalProperties: false,
      required: ["problemItemId", "screenId", "goal"],
      properties: { problemItemId: ITEM_ID, screenId: SCREEN, goal: { type: "string", maxLength: 200 }, rationale: { type: "string", maxLength: 600 } },
    },
  },
  "approved-runs": {
    id: "approved-runs",
    version: 1,
    states: ["draft-ready", "approved", "rejected", "running", "passed", "failed"],
    initial: ["draft-ready"],
    transitions: [
      { from: "draft-ready", to: "approved", by: "human", approval: true },
      { from: "draft-ready", to: "rejected", by: "human" },
      { from: "approved", to: "running", by: "system" },
      { from: "approved", to: "failed", by: "system" },
      { from: "running", to: "passed", by: "system" },
      { from: "running", to: "failed", by: "system" },
    ],
    itemSchema: {
      type: "object",
      additionalProperties: false,
      required: ["suggestionItemId", "draftId", "contentHash", "screenId"],
      properties: { suggestionItemId: ITEM_ID, draftId: ITEM_ID, contentHash: { type: "string", maxLength: 64, pattern: "^[a-f0-9]{64}$" }, screenId: SCREEN },
    },
  },
  "issue-drafts": {
    id: "issue-drafts",
    version: 1,
    states: ["draft", "approved", "rejected", "filed"],
    initial: ["draft"],
    transitions: [
      { from: "draft", to: "approved", by: "human", approval: true },
      { from: "draft", to: "rejected", by: "human" },
      { from: "approved", to: "filed", by: "human", capability: "github:create-issue" },
    ],
    itemSchema: {
      type: "object",
      additionalProperties: false,
      required: ["runItemId", "problemItemId", "title", "severity", "outcome", "bodyArtifactId"],
      properties: {
        runItemId: ITEM_ID,
        problemItemId: ITEM_ID,
        title: { type: "string", maxLength: 120 },
        severity: SEVERITY,
        outcome: { type: "string", enum: ["passed", "failed"] },
        bodyArtifactId: ITEM_ID,
      },
    },
  },
};

for (const b of Object.values(BOARDS)) if (checkSchema(b.itemSchema).length) throw new Error(`board ${b.id}: invalid item schema`);

export interface TransitionRecord {
  at: string;
  from: string | null;
  to: string;
  actor: ActorRef;
  /** Sanitized, at most 200 characters. */
  reason?: string;
  artifactIds: string[];
}

export interface BoardItem {
  id: string;
  board: BoardId;
  boardVersion: number;
  state: string;
  payload: Record<string, unknown>;
  artifacts: ArtifactRef[];
  /** Item this one came from (problem -> suggestion -> run -> issue draft). */
  parentId?: string;
  createdBy: ActorRef;
  createdAt: string;
  /** Increments on every change. Transitions must name the revision they saw (optimistic concurrency, replay guard). */
  rev: number;
  approval?: { by: string; at: string; payloadHash: string };
  history: TransitionRecord[];
}

/** What an agent version may do on boards, looked up server-side from the registry, never taken from the caller. */
export interface AgentBoardPolicy {
  capabilities: readonly string[];
  produces: readonly { board: string; state: string }[];
  transitions: readonly { board: string; from: string; to: string }[];
}

export interface BoardServiceOptions {
  db: Db;
  artifacts: ArtifactRegistry;
  sanitizer: Sanitizer;
  policyOf: (agentId: string, version: string) => Promise<AgentBoardPolicy | undefined>;
  now: () => Date;
  newId?: (prefix: string) => string;
}

export interface Proposal {
  board: string;
  state: string;
  payload: unknown;
  artifacts?: readonly ArtifactRef[];
  parentId?: string;
  reason?: string;
}

export interface TransitionPlan {
  itemId: string;
  from: string;
  to: string;
  expectedRev: number;
  approval: boolean;
  actor: ActorRef;
  artifacts: ArtifactRef[];
  reason?: string;
}

export const payloadHash = (item: Pick<BoardItem, "board" | "payload" | "artifacts">) =>
  hashValue({ board: item.board, payload: item.payload, artifacts: item.artifacts.map((a) => [a.id, a.sha256]) });

export class BoardService {
  private readonly newId: (prefix: string) => string;

  constructor(private readonly o: BoardServiceOptions) {
    this.newId = o.newId ?? defaultNewId;
  }

  private board(id: string): BoardDefinition {
    if (!(BOARD_IDS as readonly string[]).includes(id)) throw new RuntimeError("unknown-board", "board");
    return BOARDS[id as BoardId];
  }

  private async agentPolicy(actor: Extract<Actor, { kind: "agent" }>): Promise<AgentBoardPolicy> {
    const policy = await this.o.policyOf(actor.agentId, actor.agentVersion);
    if (!policy) throw new RuntimeError("agent-not-registered", "actor");
    return policy;
  }

  private async checkArtifacts(refs: readonly ArtifactRef[] = []): Promise<ArtifactRef[]> {
    if (refs.length > 50) throw new RuntimeError("too-many-artifacts", "artifacts");
    const out: ArtifactRef[] = [];
    for (const ref of refs) {
      const { record } = await this.o.artifacts.resolve(ref);
      if (!out.some((a) => a.id === record.id)) out.push({ id: record.id, kind: record.kind, sha256: record.sha256, size: record.size });
    }
    return out;
  }

  /** Validates a proposal without writing it. The runner checks every proposal of a task before writing any. */
  async prepare(actor: Actor, p: Proposal): Promise<BoardItem> {
    const board = this.board(p.board);
    if (!board.initial.includes(p.state)) throw new RuntimeError("invalid-board-transition", "state");
    if (actor.kind === "agent") {
      const policy = await this.agentPolicy(actor);
      if (!policy.capabilities.includes("board:propose") || !policy.produces.some((x) => x.board === p.board && x.state === p.state)) {
        throw new RuntimeError("capability-denied", "board");
      }
    }
    const issues = validateValue(board.itemSchema, p.payload, "payload");
    if (issues.length) throw RuntimeError.fromIssues(issues);
    if (p.parentId !== undefined && !(OPAQUE_ID.test(p.parentId) && (await this.get(p.parentId)))) throw new RuntimeError("item-unknown", "parentId");
    const payload = sanitizeFreeText(board.itemSchema, p.payload, (t, max) => this.o.sanitizer.sanitizeText(t, max)) as Record<string, unknown>;
    const artifacts = await this.checkArtifacts(p.artifacts);
    const at = this.o.now().toISOString();
    return {
      id: this.newId("item"),
      board: board.id,
      boardVersion: board.version,
      state: p.state,
      payload,
      artifacts,
      ...(p.parentId ? { parentId: p.parentId } : {}),
      createdBy: actorRef(actor),
      createdAt: at,
      rev: 1,
      history: [{ at, from: null, to: p.state, actor: actorRef(actor), ...this.reason(p.reason), artifactIds: artifacts.map((a) => a.id) }],
    };
  }

  /** Writes prepared items and transitions in one mutation: all or none. */
  async commit(items: readonly BoardItem[], plans: readonly TransitionPlan[] = []): Promise<{ items: BoardItem[]; transitioned: BoardItem[] }> {
    return this.o.db.mutate<BoardItem, { items: BoardItem[]; transitioned: BoardItem[] }>("board-items", (all) => {
      for (const item of items) {
        if (all[item.id]) throw new RuntimeError("duplicate", "id");
        all[item.id] = structuredClone(item);
      }
      const transitioned = plans.map((plan) => this.apply(all, plan));
      return { items: items.map((i) => snapshot(i)), transitioned };
    });
  }

  async propose(actor: Actor, p: Proposal): Promise<BoardItem> {
    const { items } = await this.commit([await this.prepare(actor, p)]);
    return items[0]!;
  }

  async get(id: string): Promise<BoardItem | undefined> {
    const item = (await this.o.db.read<BoardItem>("board-items"))[id];
    return item && snapshot(item);
  }

  async list(board?: string, state?: string): Promise<BoardItem[]> {
    return Object.values(await this.o.db.read<BoardItem>("board-items"))
      .filter((i) => (!board || i.board === board) && (!state || i.state === state))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
      .map((i) => snapshot(i));
  }

  /**
   * Checks a transition without writing it: the transition exists, the actor kind and capabilities match, and approvals
   * come from a human who is not the creator. `commit` re-checks the revision inside the write.
   */
  async prepareTransition(
    itemId: string,
    to: string,
    actor: Actor,
    opts: { expectedRev: number; reason?: string; artifacts?: readonly ArtifactRef[] },
  ): Promise<TransitionPlan> {
    const current = await this.get(itemId);
    if (!current) throw new RuntimeError("item-unknown", "itemId");
    const board = this.board(current.board);
    const def = board.transitions.find((t) => t.from === current.state && t.to === to);
    if (!def) throw new RuntimeError("transition-not-allowed", "to");
    if (def.by === "human") {
      if (actor.kind !== "human" || actor.role !== "admin" || !OPAQUE_ID.test(actor.id)) throw new RuntimeError("not-human", "actor");
      if (def.capability && !actor.capabilities.includes(def.capability)) throw new RuntimeError("capability-denied", "actor");
      if (def.approval) {
        if (!actor.capabilities.includes("approval:grant")) throw new RuntimeError("capability-denied", "actor");
        if (current.createdBy.kind === "human" && current.createdBy.id === actor.id) throw new RuntimeError("self-approval", "actor");
      }
    } else if (def.by === "agent") {
      if (actor.kind !== "agent") throw new RuntimeError("capability-denied", "actor");
      const policy = await this.agentPolicy(actor);
      if (!policy.capabilities.includes("board:transition") || !policy.transitions.some((t) => t.board === board.id && t.from === def.from && t.to === def.to)) {
        throw new RuntimeError("capability-denied", "actor");
      }
    } else if (actor.kind !== "system") {
      throw new RuntimeError("capability-denied", "actor");
    }
    return {
      itemId,
      from: current.state,
      to,
      expectedRev: opts.expectedRev,
      approval: def.approval === true && actor.kind === "human",
      actor: actorRef(actor),
      artifacts: await this.checkArtifacts(opts.artifacts),
      ...this.reason(opts.reason),
    };
  }

  /**
   * The only way an item changes state. A replayed or concurrent request names a revision that is no longer current
   * and fails with `stale-item` instead of applying twice.
   */
  async transition(
    itemId: string,
    to: string,
    actor: Actor,
    opts: { expectedRev: number; reason?: string; artifacts?: readonly ArtifactRef[] },
  ): Promise<BoardItem> {
    const plan = await this.prepareTransition(itemId, to, actor, opts);
    return (await this.commit([], [plan])).transitioned[0]!;
  }

  private apply(all: Record<string, BoardItem>, plan: TransitionPlan): BoardItem {
    const item = all[plan.itemId];
    if (!item || item.rev !== plan.expectedRev || item.state !== plan.from) throw new RuntimeError("stale-item", "expectedRev");
    const at = this.o.now().toISOString();
    for (const a of plan.artifacts) if (!item.artifacts.some((x) => x.id === a.id)) item.artifacts.push(a);
    if (plan.approval && plan.actor.kind === "human") item.approval = { by: plan.actor.id, at, payloadHash: payloadHash(item) };
    item.history.push({
      at,
      from: item.state,
      to: plan.to,
      actor: plan.actor,
      ...(plan.reason ? { reason: plan.reason } : {}),
      artifactIds: plan.artifacts.map((a) => a.id),
    });
    item.state = plan.to;
    item.rev += 1;
    return snapshot(item);
  }

  /** True only when the item carries a human approval bound to exactly its current payload and artifacts. */
  verifyApproval(item: BoardItem): void {
    if (!item.approval || item.approval.payloadHash !== payloadHash(item)) throw new RuntimeError("approval-mismatch", "approval");
  }

  private reason(text?: string): { reason?: string } {
    const r = text ? this.o.sanitizer.sanitizeText(text, 200) : "";
    return r ? { reason: r } : {};
  }
}
