/** Versioned event contract. Animation reads structured fields, never `label`. */

export const EVENT_VERSION = 1 as const;

export const AGENT_IDS = ["player-alpha", "explorer", "qa-analyst", "design-critic"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const STATUSES = [
  "idle",
  "planning",
  "working",
  "waiting",
  "reviewing",
  "blocked",
  "completed",
  "failed",
] as const;
export type Status = (typeof STATUSES)[number];

export const PHASES = [
  "idle",
  "queued",
  "setup",
  "navigate",
  "play",
  "observe",
  "analyze",
  "report",
  "teardown",
] as const;
export type Phase = (typeof PHASES)[number];

export const TOOLS = [
  "run-scenario",
  "explore-screens",
  "read-findings",
  "ai-provider",
  "review-screenshots",
  "generate-test",
] as const;
export type Tool = (typeof TOOLS)[number];

export const ORIGINS = ["live", "demo"] as const;
export type Origin = (typeof ORIGINS)[number];

export interface HugentsEvent {
  v: typeof EVENT_VERSION;
  seq: number;
  /** ISO-8601 timestamp. */
  at: string;
  origin: Origin;
  agent: AgentId | "system";
  status: Status;
  phase: Phase;
  tool?: Tool;
  taskId?: string;
  runId?: string;
  /** Short, sanitized text. Display only. */
  label: string;
  /** Opaque identifier, never a path or URL. */
  artifactRef?: string;
}

export const MAX_LABEL_LENGTH = 120;
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class EventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventValidationError";
  }
}

function oneOf<T extends string>(list: readonly T[], value: unknown, field: string): T {
  if (typeof value !== "string" || !(list as readonly string[]).includes(value)) {
    throw new EventValidationError(`invalid ${field}`);
  }
  return value as T;
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !OPAQUE_ID.test(value)) {
    throw new EventValidationError(`invalid ${field}: must be an opaque id`);
  }
  return value;
}

/** Runtime validation of untrusted input. Unknown keys are dropped, never copied. */
export function parseEvent(input: unknown): HugentsEvent {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new EventValidationError("event must be an object");
  }
  const e = input as Record<string, unknown>;
  if (e.v !== EVENT_VERSION) throw new EventValidationError("unsupported event version");
  if (typeof e.seq !== "number" || !Number.isSafeInteger(e.seq) || e.seq < 0) {
    throw new EventValidationError("invalid seq");
  }
  if (typeof e.at !== "string" || Number.isNaN(Date.parse(e.at))) {
    throw new EventValidationError("invalid at");
  }
  if (typeof e.label !== "string" || e.label.length > MAX_LABEL_LENGTH) {
    throw new EventValidationError("invalid label");
  }
  const agent =
    e.agent === "system" ? "system" : oneOf(AGENT_IDS, e.agent, "agent");
  const tool = e.tool === undefined ? undefined : oneOf(TOOLS, e.tool, "tool");
  const event: HugentsEvent = {
    v: EVENT_VERSION,
    seq: e.seq,
    at: e.at,
    origin: oneOf(ORIGINS, e.origin, "origin"),
    agent,
    status: oneOf(STATUSES, e.status, "status"),
    phase: oneOf(PHASES, e.phase, "phase"),
    label: e.label,
  };
  if (tool) event.tool = tool;
  const taskId = optionalId(e.taskId, "taskId");
  const runId = optionalId(e.runId, "runId");
  const artifactRef = optionalId(e.artifactRef, "artifactRef");
  if (taskId) event.taskId = taskId;
  if (runId) event.runId = runId;
  if (artifactRef) event.artifactRef = artifactRef;
  return event;
}
