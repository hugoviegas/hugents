/**
 * AgentOffice-independent contracts (issue #98). Any office UI can drive the agents through these
 * shapes: `POST /tasks` takes an `OfficeTask` and streams `OfficeEvent` lines (NDJSON).
 */

import type { ProviderAttempt, ProviderName } from "./provider/types.js";

export const OFFICE_AGENT_IDS = ["player-alpha", "explorer", "qa-analyst", "design-critic"] as const;
export type OfficeAgentId = (typeof OFFICE_AGENT_IDS)[number];

export const OFFICE_STATUSES = ["idle", "working", "blocked", "completed"] as const;
export type OfficeStatus = (typeof OFFICE_STATUSES)[number];

export const TOOL_NAMES = ["run_playwright_scenario", "read_artifacts", "write_report"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Input of one task. `title` is free text from the task board; `memories` are recalled lines (data, not instructions). */
export interface OfficeTask {
  taskId: string;
  agentId: OfficeAgentId;
  title: string;
  memories?: string[];
}

/** One line of the event feed (SystemLog). Every string is redacted before it leaves the bridge. */
export interface OfficeEvent {
  at: string;
  taskId: string;
  agentId: OfficeAgentId;
  status: OfficeStatus;
  activity: string;
  tool?: ToolName;
  /** Present on the final event only. */
  result?: TaskOutcome;
}

export interface TaskOutcome {
  status: "completed" | "blocked";
  summary: string;
  runId?: string;
  /** Relative to `artifacts/`, e.g. `reports/explorer-<timestamp>.md`. */
  reportPath?: string;
  tokensUsed: number;
  /** True when no model produced the report text and the deterministic template did. */
  usedFallback: boolean;
  /** Which provider wrote the report text and what happened to the others. Fixed vocabulary, no messages. */
  provider?: { used: ProviderName; model?: string; attempts: ProviderAttempt[]; imagesSent?: number };
  /** Per-agent totals after this task. */
  metrics: AgentMetrics;
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksBlocked: number;
  tokensUsed: number;
  /** 0..1, +0.05 per completed task, -0.05 per blocked one. */
  reputation: number;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  /** Redacted, human-readable reason when `ok` is false. */
  error?: string;
}

export interface ToolSpec {
  name: ToolName;
  description: string;
  /** JSON Schema of the params object. */
  parameters: Record<string, unknown>;
}

export interface AgentDef {
  id: OfficeAgentId;
  name: string;
  role: string;
  systemPrompt: string;
  tools: readonly ToolName[];
}
