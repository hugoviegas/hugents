/**
 * Fixed reason-code vocabulary for the runtime. Every rejection and every failed stage carries one of these and, at
 * most, a field path. Never the offending value, a prompt, page text or file contents.
 */
export const RUNTIME_REASON_CODES = [
  // package and configuration validation
  "invalid-json",
  "too-large",
  "not-an-object",
  "missing-field",
  "unknown-field",
  "invalid-type",
  "invalid-value",
  "too-long",
  "too-many-items",
  "duplicate",
  "secret-shaped",
  "unsafe-env-name",
  "client-exposed-env",
  "unknown-tool",
  "undeclared-capability",
  "human-only-capability",
  "invalid-schema",
  "schema-incompatible",
  "unknown-board",
  "invalid-board-transition",
  "missing-file",
  "unreferenced-file",
  "unsafe-path",
  "invalid-bundle",
  // registry
  "version-conflict",
  "stale-version",
  "agent-not-registered",
  "agent-tampered",
  // tasks and runs
  "duplicate-task",
  "invalid-input",
  "invalid-output",
  "output-too-large",
  "token-limit",
  "timeout",
  "cancelled",
  "tool-failed",
  "precondition-failed",
  "draft-rejected",
  "capability-denied",
  "task-unknown",
  "task-not-runnable",
  "interrupted",
  // artifacts
  "artifact-unknown",
  "artifact-tampered",
  "artifact-expired",
  "artifact-kind-not-allowed",
  "artifact-too-large",
  "artifact-mime-not-allowed",
  "too-many-artifacts",
  // boards and approvals
  "item-unknown",
  "transition-not-allowed",
  "stale-item",
  "not-human",
  "self-approval",
  "approval-mismatch",
] as const;
export type RuntimeReasonCode = (typeof RUNTIME_REASON_CODES)[number];

/** A problem and where it is. Never carries the value. */
export interface Issue {
  code: RuntimeReasonCode;
  path: string;
}

export class RuntimeError extends Error {
  constructor(
    readonly code: RuntimeReasonCode,
    readonly path = "$",
    readonly issues: readonly Issue[] = [{ code, path }],
  ) {
    super(path === "$" ? code : `${code} at ${path}`);
    this.name = "RuntimeError";
  }

  /** Throws the first issue, keeping the full list for callers that report all of them. */
  static fromIssues(issues: readonly Issue[]): RuntimeError {
    const first = issues[0] ?? { code: "invalid-value", path: "$" };
    return new RuntimeError(first.code, first.path, issues);
  }
}

/** Thrown by tools to fail a stage with a fixed code. Any other thrown value becomes `tool-failed`. */
export class ToolFailure extends Error {
  constructor(readonly code: "precondition-failed" | "draft-rejected" | "tool-failed") {
    super(code);
    this.name = "ToolFailure";
  }
}
