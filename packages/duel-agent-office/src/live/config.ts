import { resolveConfig, QUALITY_PRESETS, type LiveConfig, type QualityPreset } from "@hugents/live";

export interface LiveWorkerConfig {
  /** Loopback relay base URL, e.g. http://127.0.0.1:3101. */
  relayUrl: string;
  workerToken: string;
  agentId: string;
  config: LiveConfig;
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
  const config = resolveConfig(preset, {
    ...(num(env.QA_LIVE_MAX_FPS) !== undefined ? { maxFps: num(env.QA_LIVE_MAX_FPS)! } : {}),
    ...(num(env.QA_LIVE_MAX_WIDTH) !== undefined ? { maxWidth: num(env.QA_LIVE_MAX_WIDTH)! } : {}),
    ...(num(env.QA_LIVE_MAX_HEIGHT) !== undefined ? { maxHeight: num(env.QA_LIVE_MAX_HEIGHT)! } : {}),
    ...(num(env.QA_LIVE_QUALITY) !== undefined ? { quality: num(env.QA_LIVE_QUALITY)! } : {}),
  });
  const agentId = /^[A-Za-z0-9_-]{1,64}$/.test(env.QA_LIVE_AGENT_ID ?? "") ? env.QA_LIVE_AGENT_ID! : "player-alpha";
  return { relayUrl: url.origin, workerToken, agentId, config, pollMs: 1500 };
}
