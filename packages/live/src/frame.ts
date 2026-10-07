/** LiveFrame contract. Frames are transient: they exist in memory only and never reach a store, log or event. */

export const GATE_REASONS = ["hidden-screen", "private-step", "unknown-screen", "gate-error"] as const;
export type GateReason = (typeof GATE_REASONS)[number];

export type GateState = { state: "visible" } | { state: "hidden"; reason: GateReason };

export interface LiveFrame {
  runId: string;
  agentId: string;
  /** Player label, e.g. "alpha" or "bravo". */
  player: string;
  seq: number;
  /** ISO-8601 capture time. */
  at: string;
  width: number;
  height: number;
  /** Base64 JPEG. Empty when the gate is hidden: a hidden frame carries no pixels. */
  jpeg: string;
  gate: GateState;
}

export const QUALITY_PRESETS = ["low", "medium", "high"] as const;
export type QualityPreset = (typeof QUALITY_PRESETS)[number];

export interface LiveConfig {
  /** Frames per second ceiling. */
  maxFps: number;
  maxWidth: number;
  maxHeight: number;
  /** JPEG quality 1-100. */
  quality: number;
  /** Largest accepted payload in bytes (decoded). */
  maxFrameBytes: number;
}

export const PRESETS: Record<QualityPreset, LiveConfig> = {
  low: { maxFps: 2, maxWidth: 640, maxHeight: 360, quality: 40, maxFrameBytes: 200_000 },
  medium: { maxFps: 4, maxWidth: 960, maxHeight: 540, quality: 55, maxFrameBytes: 400_000 },
  high: { maxFps: 8, maxWidth: 1280, maxHeight: 720, quality: 70, maxFrameBytes: 800_000 },
};
/** Hard ceilings. Configuration can lower these caps, never raise them. */
export const HARD_LIMITS: LiveConfig = { maxFps: 10, maxWidth: 1600, maxHeight: 900, quality: 80, maxFrameBytes: 1_000_000 };

const clamp = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** Builds a config from a preset plus optional overrides, clamped to the hard limits. */
export function resolveConfig(preset: QualityPreset = "low", overrides: Partial<LiveConfig> = {}): LiveConfig {
  const base = PRESETS[preset];
  return {
    maxFps: clamp(overrides.maxFps, base.maxFps, 1, HARD_LIMITS.maxFps),
    maxWidth: clamp(overrides.maxWidth, base.maxWidth, 160, HARD_LIMITS.maxWidth),
    maxHeight: clamp(overrides.maxHeight, base.maxHeight, 90, HARD_LIMITS.maxHeight),
    quality: clamp(overrides.quality, base.quality, 1, HARD_LIMITS.quality),
    maxFrameBytes: clamp(overrides.maxFrameBytes, base.maxFrameBytes, 1_000, HARD_LIMITS.maxFrameBytes),
  };
}

const LABEL = /^[A-Za-z0-9_-]{1,64}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Validates untrusted frame input (relay ingest). Returns a clean frame or undefined. Never throws. */
export function parseFrame(input: unknown, config: LiveConfig): LiveFrame | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const f = input as Record<string, unknown>;
  const { runId, agentId, player, seq, at, width, height, jpeg, gate } = f;
  if (typeof runId !== "string" || !LABEL.test(runId)) return undefined;
  if (typeof agentId !== "string" || !LABEL.test(agentId)) return undefined;
  if (typeof player !== "string" || !LABEL.test(player)) return undefined;
  if (!Number.isInteger(seq) || (seq as number) < 0) return undefined;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return undefined;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return undefined;
  const g = gate as { state?: unknown; reason?: unknown } | undefined;
  if (typeof g !== "object" || g === null) return undefined;
  let gateState: GateState;
  if (g.state === "visible") gateState = { state: "visible" };
  else if (g.state === "hidden" && (GATE_REASONS as readonly unknown[]).includes(g.reason)) {
    gateState = { state: "hidden", reason: g.reason as GateReason };
  } else return undefined;
  if (typeof jpeg !== "string" || !BASE64.test(jpeg)) return undefined;
  const w = width as number;
  const h = height as number;
  if (gateState.state === "hidden") {
    if (jpeg !== "") return undefined; // fail closed: a hidden frame must carry no pixels
    return { runId, agentId, player, seq: seq as number, at, width: 0, height: 0, jpeg: "", gate: gateState };
  }
  if (w < 1 || h < 1 || w > config.maxWidth || h > config.maxHeight) return undefined;
  if (jpeg === "" || Math.floor((jpeg.length * 3) / 4) > config.maxFrameBytes) return undefined;
  return { runId, agentId, player, seq: seq as number, at, width: w, height: h, jpeg, gate: gateState };
}
