/** Pure state for the office popup. The UI renders `text` for every state; colour is never the only signal. */

export const POPUP_STATES = ["relay-offline", "connecting", "no-active-run", "live", "hidden-by-gate", "slow", "run-ended"] as const;
export type PopupState = (typeof POPUP_STATES)[number];

export interface PopupInput {
  relayReachable: boolean;
  streamOpen: boolean;
  run: { runId: string } | null;
  lastRunStatus?: string;
  /** Latest frame metadata for the selected player, if any. */
  frame?: { gate: "visible" | "hidden"; ageMs: number };
  /** True when the run ended while the popup was open. */
  endedWhileOpen?: boolean;
  /** Frame age above which the view is labelled slow. */
  slowAfterMs?: number;
}

export const POPUP_TEXT: Record<PopupState, string> = {
  "relay-offline": "Live relay offline",
  connecting: "Connecting to the live view",
  "no-active-run": "No active run",
  live: "Live",
  "hidden-by-gate": "Private screen hidden",
  slow: "Slow connection: showing the last frame",
  "run-ended": "Run ended",
};

export function popupState(i: PopupInput): PopupState {
  if (!i.relayReachable) return "relay-offline";
  if (!i.run) return i.endedWhileOpen ? "run-ended" : "no-active-run";
  if (!i.streamOpen) return "connecting";
  if (!i.frame) return "connecting";
  if (i.frame.gate === "hidden") return "hidden-by-gate";
  if (i.frame.ageMs > (i.slowAfterMs ?? 3000)) return "slow";
  return "live";
}

/** A popup opens only for an agent that has an active run. */
export function canOpenPopup(agent: { id: string }, activeRun: { agentId: string } | null | undefined): boolean {
  return !!activeRun && activeRun.agentId === agent.id;
}

/** Whether a frame image may be shown. Frames are cleared on run end and while the view is paused or hidden. */
export function shouldShowFrame(state: PopupState, controls: { paused: boolean; hidden: boolean }): boolean {
  return (state === "live" || state === "slow") && !controls.hidden && !controls.paused ? true : false;
}

/** The dialog's single source of truth for what the stage shows (design handoff, LiveRunDialog). */
export const STREAM_STATUSES = ["connecting", "live", "private", "slow", "ended", "none", "offline"] as const;
export type StreamStatus = (typeof STREAM_STATUSES)[number];
export type DialogView = "connecting" | "live" | "paused" | "slow" | "hidden" | "private" | "ended" | "none" | "offline";

/** The person's choice (hide) wins over stream detail; pause only applies while live. */
export function deriveView(status: StreamStatus, local: { paused: boolean; viewHidden: boolean }): DialogView {
  if (status === "connecting" || status === "ended" || status === "none" || status === "offline") return status;
  if (local.viewHidden) return "hidden";
  if (status === "private") return "private";
  if (status === "live" && local.paused) return "paused";
  return status;
}
