import { resolveConfig, QUALITY_PRESETS, type LiveConfig, type QualityPreset } from "@hugents/live";

export interface LiveWorkerConfig {
  /** Loopback relay base URL, e.g. http://127.0.0.1:3101. */
  relayUrl: string;
  workerToken: string;
  agentId: string;
  /** The caps in force before a viewer picks a quality (the configured preset, with overrides). */
  config: LiveConfig;
  /** Only the caps set explicitly in the environment. A viewer's quality preset is combined with these. */
  overrides: Partial<LiveConfig>;
  pollMs: number;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Reads the live-view settings the bridge hands to the runner. Returns undefined (live view off) unless the relay URL
 * is plain http on a loopback address and a worker token is present. Never throws and never echoes a value.
 */
export function parseLiveWorkerConfig(env: Record<string, string | undefined>): LiveWorkerConfig | undefined {
  const raw = (env.QA_LIVE_RELAY_URL ?? "").trim();
  const workerToken = (env.QA_LIVE_WORKER_TOKEN ?? "").trim();
  if (!raw || workerToken.length < 16) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname) || url.username || url.password) return undefined;
  const preset = (QUALITY_PRESETS as readonly string[]).includes(env.QA_LIVE_PRESET ?? "") ? (env.QA_LIVE_PRESET as QualityPreset) : "low";
  const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const overrides: Partial<LiveConfig> = {
    ...(num(env.QA_LIVE_MAX_FPS) !== undefined ? { maxFps: num(env.QA_LIVE_MAX_FPS)! } : {}),
    ...(num(env.QA_LIVE_MAX_WIDTH) !== undefined ? { maxWidth: num(env.QA_LIVE_MAX_WIDTH)! } : {}),
    ...(num(env.QA_LIVE_MAX_HEIGHT) !== undefined ? { maxHeight: num(env.QA_LIVE_MAX_HEIGHT)! } : {}),
    ...(num(env.QA_LIVE_QUALITY) !== undefined ? { quality: num(env.QA_LIVE_QUALITY)! } : {}),
  };
  const config = resolveConfig(preset, overrides);
  const agentId = /^[A-Za-z0-9_-]{1,64}$/.test(env.QA_LIVE_AGENT_ID ?? "") ? env.QA_LIVE_AGENT_ID! : "player-alpha";
  return { relayUrl: url.origin, workerToken, agentId, config, overrides, pollMs: 1500 };
}
