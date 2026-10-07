import type { HugentsEvent, Sanitizer, Store } from "@hugents/core";

/** Stream lifecycle. Labels are fixed strings; no frame content, screen id or reason text goes into an event. */
export const LIVE_STAGES = [
  "stream-start",
  "gate-blocked",
  "gate-released",
  "viewer-connected",
  "viewer-disconnected",
  "stream-end",
] as const;
export type LiveStage = (typeof LIVE_STAGES)[number];

export interface LiveEmitter {
  emit(stage: LiveStage, ids: { runId: string; taskId?: string }): Promise<HugentsEvent>;
}

export function createLiveEmitter(store: Store, sanitizer: Sanitizer, sessionId: string, now: () => string): LiveEmitter {
  let next: number | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    emit(stage, ids) {
      const run = chain.then(async () => {
        if (next === undefined) {
          const existing = await store.listEvents(sessionId);
          next = (existing[existing.length - 1]?.seq ?? -1) + 1;
        }
        const event = sanitizer.sanitizeEvent({
          v: 1,
          seq: next++,
          at: now(),
          origin: "live",
          agent: "player-alpha",
          status: stage === "gate-blocked" ? "blocked" : stage === "stream-end" ? "completed" : "working",
          phase: "observe",
          tool: "run-scenario",
          label: `live view: ${stage}`,
          ...ids,
        });
        await store.appendEvent(sessionId, event);
        return event;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
