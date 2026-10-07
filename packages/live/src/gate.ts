import type { Manifest } from "@hugents/core";
import type { GateState } from "./frame.js";

/**
 * Resolves the id of the screen the page shows now, or undefined when unknown. Project-specific (an adapter reads a
 * stable marker such as a data attribute). It must not read page text into logs or events.
 */
export type ScreenResolver = () => Promise<string | undefined>;

export interface FrameGate {
  /** Called by the seed fixture or an adapter around login and account steps. Frames stay hidden while active. */
  setPrivateStep(active: boolean): void;
  /** Decides for the frame about to leave the worker. Never throws, fails closed. */
  decide(): Promise<GateState>;
}

/**
 * The frame gate. It runs inside the worker, before a frame leaves it. Only a screen the manifest lists as visible
 * releases frames: a hidden screen, an unlisted screen, an unresolvable screen and a resolver error all hide them.
 */
export function createFrameGate(manifest: Pick<Manifest, "screens">, resolveScreen: ScreenResolver): FrameGate {
  const visible = new Set(manifest.screens.filter((s) => !s.hidden).map((s) => s.id));
  const hidden = new Set(manifest.screens.filter((s) => s.hidden).map((s) => s.id));
  let privateStep = false;
  return {
    setPrivateStep(active) {
      privateStep = active;
    },
    async decide() {
      if (privateStep) return { state: "hidden", reason: "private-step" };
      try {
        const id = await resolveScreen();
        // Re-check: a login step may have started while the screen was being read.
        if (privateStep) return { state: "hidden", reason: "private-step" };
        if (id === undefined) return { state: "hidden", reason: "unknown-screen" };
        if (hidden.has(id)) return { state: "hidden", reason: "hidden-screen" };
        if (visible.has(id)) return { state: "visible" };
        return { state: "hidden", reason: "unknown-screen" };
      } catch {
        return { state: "hidden", reason: "gate-error" };
      }
    },
  };
}
