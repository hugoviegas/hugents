import type { Sanitizer } from "@hugents/core";

/** Fixed vocabulary. A rejection never carries free text, code or model output. */
export const REASON_CODES = [
  "forbidden-action",
  "disallowed-import",
  "hardcoded-url",
  "locator-not-allowed",
  "api-not-allowed",
  "network-access",
  "filesystem-access",
  "process-access",
  "env-access",
  "dynamic-code",
  "secret-in-spec",
  "missing-seed-fixture",
  "size-limit",
  "syntax-error",
  "provider-unavailable",
  "provider-malformed",
  "screen-hidden",
  "screen-unknown",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const REQUEST_STATUSES = ["requested", "planning", "generating", "validating", "completed", "failed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const DRAFT_STATUSES = ["draft", "rejected", "approved", "running", "passed", "failed"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const MAX_GOAL_LENGTH = 200;
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface TestRequest {
  id: string;
  projectId: string;
  /** Opaque id of the finding or observation that motivated the request. */
  sourceId: string;
  /** Screen identifier from the manifest. */
  screenId: string;
  /** Sanitized, length-capped. Display and planning input only. */
  goal: string;
  status: RequestStatus;
  createdBy: string;
  createdAt: string;
}

export interface ValidationIssue {
  code: ReasonCode;
  /** 1-based line in the spec. Never the line's text. */
  line?: number;
}

export interface ValidatorResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface ApprovalRecord {
  by: string;
  at: string;
  /** Hash of the spec that was approved. */
  contentHash: string;
}

export interface TestDraft {
  id: string;
  requestId: string;
  /** Markdown plan. */
  plan: string;
  /** Generated spec file content. Untrusted. */
  spec: string;
  validation: ValidatorResult;
  status: DraftStatus;
  approval?: ApprovalRecord;
  /** SHA-256 (hex) of `spec`. */
  contentHash: string;
  /** Why the draft was rejected, when it was. */
  reasons: ReasonCode[];
}

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

export interface NewRequestInput {
  id: string;
  projectId: string;
  sourceId: string;
  screenId: string;
  goal: string;
  createdBy: string;
  createdAt: string;
}

/** Builds a request from untrusted input: ids must be opaque and the goal is sanitized and capped. */
export function createRequest(input: NewRequestInput, sanitizer: Sanitizer): TestRequest {
  for (const field of ["id", "projectId", "sourceId", "screenId", "createdBy"] as const) {
    if (!OPAQUE_ID.test(input[field])) throw new ContractError(`invalid ${field}`);
  }
  if (Number.isNaN(Date.parse(input.createdAt))) throw new ContractError("invalid createdAt");
  const goal = sanitizer.sanitizeText(input.goal, MAX_GOAL_LENGTH);
  if (!goal) throw new ContractError("empty goal");
  return {
    id: input.id,
    projectId: input.projectId,
    sourceId: input.sourceId,
    screenId: input.screenId,
    goal,
    status: "requested",
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  };
}
