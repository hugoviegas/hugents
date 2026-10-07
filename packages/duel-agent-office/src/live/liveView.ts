import { createCapture, createFrameGate, resolveConfig, type Capture, type LiveFrame, type LiveStage, type QualityPreset, type ScreencastPage } from "@hugents/live";
import type { LiveWorkerConfig } from "./config.js";

/** The slice of a PlayerSession the live view needs. */
export interface LivePlayer {
  /** "alpha" or "bravo". */
  label: string;
  page: ScreencastPage;
  /** True while a login or account step runs. Starts true: frames stay hidden until login finishes. */
  inPrivateStep: boolean;
  /** Registered by the live view; the player calls it whenever `inPrivateStep` changes. */
  onPrivateStep?: (active: boolean) => void;
  /** False on any screen a frame must not show (login form, join-code field, waiting room, unknown). */
  isSafeToCapture(): Promise<boolean>;
}

export interface LiveView {
  stop(status: "completed" | "failed" | "stopped"): Promise<void>;
}

export interface LiveViewOptions {
  settings: LiveWorkerConfig;
  runId: string;
  players: readonly LivePlayer[];
  /** Receives fixed lifecycle labels only, never frame content. */
  onEvent?(stage: LiveStage): void;
  fetch?: typeof fetch;
}

/** The only two screens this runner knows how to tell apart. A manifest-driven resolver replaces this per project. */
const RUNNER_SCREENS = { screens: [{ id: "safe", hidden: false }, { id: "private", hidden: true }] } as const;

/**
 * Starts the live view for a run: announces the run to the loopback relay, and for each player runs a gate and a
 * capture that only start while someone watches. Fails soft: any relay problem turns the live view off and never
 * affects the run.
 */
export async function startLiveView(o: LiveViewOptions): Promise<LiveView | undefined> {
  const { settings } = o;
  const doFetch = o.fetch ?? fetch;
  const headers = { authorization: `Bearer ${settings.workerToken}`, "content-type": "application/json" };
  const call = async (path: string, init: RequestInit = {}): Promise<Record<string, unknown> | undefined> => {
    try {
      const res = await doFetch(`${settings.relayUrl}${path}`, { ...init, headers: { ...headers }, signal: AbortSignal.timeout(2000) });
      return res.ok ? ((await res.json()) as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };

  const begun = await call("/worker/run", {
    method: "POST",
    body: JSON.stringify({ action: "begin", runId: o.runId, agentId: settings.agentId, status: "working", phase: "setup" }),
  });
  if (!begun) return undefined; // relay offline or token refused: live view stays off

  let wanted = false;
  let inFlight = false;
  let stopped = false;
  const publish = (frame: LiveFrame): void => {
    if (inFlight) return; // backpressure: one POST at a time, extra frames are dropped
    inFlight = true;
    void call("/worker/frame", { method: "POST", body: JSON.stringify(frame) })
      .then((r) => {
        if (r && r.wanted === false) wanted = false;
        if (!r) wanted = false; // relay gone: stop capturing until the poll says otherwise
      })
      .finally(() => {
        inFlight = false;
      });
  };

  const gates = o.players.map((player) => {
    const gate = createFrameGate(RUNNER_SCREENS, async () => {
      if (player.inPrivateStep) return "private";
      return (await player.isSafeToCapture()) ? "safe" : "private";
    });
    gate.setPrivateStep(player.inPrivateStep);
    return gate;
  });

  // Phase for the viewer: "login" while any player is in a login step, then "match", then "report" at the end.
  let phase = "";
  const setPhase = (next: string): void => {
    if (next === phase || stopped) return;
    phase = next;
    void call("/worker/run", { method: "POST", body: JSON.stringify({ action: "update", phase: next }) });
  };
  const syncPhase = (): void => setPhase(o.players.some((p) => p.inPrivateStep) ? "login" : "match");
  o.players.forEach((player, i) => {
    player.onPrivateStep = (active) => {
      gates[i]!.setPrivateStep(active);
      syncPhase();
    };
  });
  syncPhase();

  const makeCaptures = (preset: QualityPreset): { capture: Capture; player: LivePlayer }[] => {
    const config = resolveConfig(preset, settings.overrides);
    return o.players.map((player, i) => ({
      player,
      capture: createCapture({
        page: player.page,
        gate: gates[i]!,
        config,
        runId: o.runId,
        agentId: settings.agentId,
        player: player.label,
        publish,
        hasViewer: () => wanted,
        ...(o.onEvent ? { onEvent: o.onEvent } : {}),
      }),
    }));
  };
  let currentPreset: QualityPreset = "medium";
  let parts = makeCaptures(currentPreset);

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const r = await call("/worker/wanted");
    const now = r?.wanted === true;
    if (now !== wanted) {
      wanted = now;
      o.onEvent?.(now ? "viewer-connected" : "viewer-disconnected");
    }
    const asked = r?.preset;
    if (wanted && (asked === "low" || asked === "medium" || asked === "high") && asked !== currentPreset) {
      // A viewer picked another quality: restart the captures with that preset's caps.
      await Promise.all(parts.map(({ capture }) => capture.stop()));
      currentPreset = asked;
      parts = makeCaptures(asked);
    }
    for (const { capture } of parts) {
      if (wanted && !capture.active) await capture.start().catch(() => undefined);
      else if (!wanted && capture.active) await capture.stop();
    }
  };
  const timer = setInterval(() => void tick(), settings.pollMs);
  timer.unref?.();

  return {
    async stop(status) {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await Promise.all(parts.map(({ capture }) => capture.stop()));
      for (const player of o.players) delete player.onPrivateStep;
      await call("/worker/run", { method: "POST", body: JSON.stringify({ action: "update", phase: "report" }) });
      await call("/worker/run", { method: "POST", body: JSON.stringify({ action: "end", runId: o.runId, status }) });
    },
  };
}
