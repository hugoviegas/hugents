import type { AgentId, HugentsEvent, Phase, Sanitizer, Status, Store } from "@hugents/core";

/** Pipeline stages. The mapping to the core event contract is fixed here; nothing parses `label` for state. */
export const STAGES = [
  "requested",
  "planning",
  "generating",
  "validating",
  "rejected",
  "awaiting-approval",
  "approved",
  "running",
  "completed",
  "failed",
] as const;
export type Stage = (typeof STAGES)[number];

const STAGE_EVENT: Record<Stage, { agent: AgentId | "system"; status: Status; phase: Phase }> = {
  requested: { agent: "system", status: "waiting", phase: "queued" },
  planning: { agent: "explorer", status: "planning", phase: "analyze" },
  generating: { agent: "explorer", status: "working", phase: "analyze" },
  validating: { agent: "explorer", status: "reviewing", phase: "analyze" },
  rejected: { agent: "explorer", status: "blocked", phase: "analyze" },
  "awaiting-approval": { agent: "system", status: "waiting", phase: "report" },
  approved: { agent: "system", status: "working", phase: "queued" },
  running: { agent: "player-alpha", status: "working", phase: "play" },
  completed: { agent: "player-alpha", status: "completed", phase: "teardown" },
  failed: { agent: "system", status: "failed", phase: "teardown" },
};

export interface StageEmitter {
  emit(stage: Stage, ids?: { taskId?: string; runId?: string }): Promise<HugentsEvent>;
}

/** Emits sanitized live events to the store. Sequence numbers continue from whatever the store already holds. */
export function createStageEmitter(store: Store, sanitizer: Sanitizer, sessionId: string, now: () => string): StageEmitter {
  let next: number | undefined;
  return {
    async emit(stage, ids = {}) {
      if (next === undefined) {
        const existing = await store.listEvents(sessionId);
        next = (existing[existing.length - 1]?.seq ?? -1) + 1;
      }
      const m = STAGE_EVENT[stage];
      const event = sanitizer.sanitizeEvent({
        v: 1,
        seq: next++,
        at: now(),
        origin: "live",
        agent: m.agent,
        status: m.status,
        phase: m.phase,
        tool: "generate-test",
        label: `test draft: ${stage}`,
        ...ids,
      });
      await store.appendEvent(sessionId, event);
      return event;
    },
  };
}
