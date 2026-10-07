import { redact } from "../redact.js";
import { appendJsonl } from "../storage/artifacts.js";

export const EVENT_STATUSES = [
  "idle",
  "planning",
  "working",
  "waiting",
  "reviewing",
  "blocked",
  "completed",
  "failed",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const AGENTS = ["runner", "player-alpha", "player-bravo"] as const;
export type AgentName = (typeof AGENTS)[number];

export interface RunEvent {
  at: string;
  runId: string;
  agent: AgentName;
  status: EventStatus;
  activity: string;
  scenario: string;
  /** Path relative to the run directory, never absolute. */
  artifactPath?: string;
}

export function validateEvent(event: RunEvent): void {
  if (!EVENT_STATUSES.includes(event.status)) throw new Error(`Invalid event status: ${String(event.status)}`);
  if (!AGENTS.includes(event.agent)) throw new Error(`Invalid event agent: ${String(event.agent)}`);
  if (!event.at || !event.runId || !event.scenario || !event.activity) throw new Error("Incomplete event");
  if (event.artifactPath && (event.artifactPath.startsWith("/") || /^[A-Za-z]:/.test(event.artifactPath))) {
    throw new Error("artifactPath must be relative");
  }
}

/** Append-only JSONL event stream. Every activity string is redacted before it is written. */
export class EventBus {
  readonly events: RunEvent[] = [];

  constructor(
    private readonly file: string,
    private readonly runId: string,
    private readonly scenario: string,
    private readonly secrets: readonly string[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async emit(agent: AgentName, status: EventStatus, activity: string, artifactPath?: string): Promise<RunEvent> {
    const event: RunEvent = {
      at: this.now().toISOString(),
      runId: this.runId,
      agent,
      status,
      activity: redact(activity, this.secrets).slice(0, 500),
      scenario: this.scenario,
      ...(artifactPath ? { artifactPath } : {}),
    };
    validateEvent(event);
    this.events.push(event);
    await appendJsonl(this.file, event);
    return event;
  }
}
