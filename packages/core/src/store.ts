import type { HugentsEvent } from "./events.js";

export const TASK_STATUSES = [
  "pending",
  "waiting",
  "in_progress",
  "completed",
  "blocked",
  "failed",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Closed list of task kinds. Free text never selects a kind. */
export const TASK_KINDS = [
  "run-private-match",
  "explore-screens",
  "observe-artifacts",
  "write-report",
  "review-screenshots",
  "run-generated-test",
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export interface Task {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  /** Validated, sanitized parameters only. */
  params: Record<string, string | number | boolean>;
  updatedAt: string;
}

/** All persistence goes through this interface. Firestore and SQLite are adapters. */
export interface Store {
  /** Appends a sanitized live event. Rejects `demo` events and out-of-order `seq`. */
  appendEvent(sessionId: string, event: HugentsEvent): Promise<void>;
  listEvents(sessionId: string, afterSeq?: number): Promise<HugentsEvent[]>;
  upsertTask(task: Task): Promise<void>;
  getTask(id: string): Promise<Task | undefined>;
  listTasks(status?: TaskStatus): Promise<Task[]>;
}

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

export class InMemoryStore implements Store {
  private readonly events = new Map<string, HugentsEvent[]>();
  private readonly tasks = new Map<string, Task>();

  async appendEvent(sessionId: string, event: HugentsEvent): Promise<void> {
    if (event.origin !== "live") throw new StoreError("demo events never enter live state");
    const list = this.events.get(sessionId) ?? [];
    const last = list[list.length - 1];
    if (last && event.seq <= last.seq) throw new StoreError("seq must increase");
    list.push({ ...event });
    this.events.set(sessionId, list);
  }

  async listEvents(sessionId: string, afterSeq = -1): Promise<HugentsEvent[]> {
    return (this.events.get(sessionId) ?? []).filter((e) => e.seq > afterSeq).map((e) => ({ ...e }));
  }

  async upsertTask(task: Task): Promise<void> {
    this.tasks.set(task.id, { ...task, params: { ...task.params } });
  }

  async getTask(id: string): Promise<Task | undefined> {
    const t = this.tasks.get(id);
    return t && { ...t, params: { ...t.params } };
  }

  async listTasks(status?: TaskStatus): Promise<Task[]> {
    return [...this.tasks.values()]
      .filter((t) => !status || t.status === status)
      .map((t) => ({ ...t, params: { ...t.params } }));
  }
}
