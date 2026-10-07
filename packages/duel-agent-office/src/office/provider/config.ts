import type { BudgetLimits } from "./budget.js";
import { PROVIDER_NAMES, type ProviderAttempt, type ProviderName } from "./types.js";

export const GEMINI_DEFAULTS = {
  timeoutMs: 30_000,
  maxOutputTokens: 1_024,
  maxRequestsPerRun: 3,
  maxRequestsPerDay: 20,
  maxScreenshots: 4,
  maxScreenshotBytes: 1_500_000,
} as const;

export interface GeminiSettings {
  apiKey: string;
  /** GEMINI_SEND_SCREENSHOTS. Default false: no image byte goes to Gemini. */
  sendScreenshots: boolean;
  /** Primary first, then alternatives. */
  models: string[];
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface ProviderConfig {
  preferred: ProviderName;
  /** Present only when Gemini is enabled, has a key and at least one model, and the preferred provider allows it. */
  gemini?: GeminiSettings;
  ollama: boolean;
  limits: BudgetLimits;
  /** Count and size caps for the screenshots of a design review (Gemini and the local vision model alike). */
  images: { max: number; maxBytes: number };
  /** Why Gemini is not in the chain although it was asked for. Fixed vocabulary. */
  skipped: ProviderAttempt[];
  /** Names and rules only, never values. */
  warnings: string[];
}

const MODEL_NAME = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const MAX_MODELS = 5;

/**
 * Reads the local process environment (the bridge loads `.env` before this). Variables:
 *   AI_PROVIDER                    gemini | ollama | deterministic. Unset = gemini when enabled, else ollama, else template.
 *   GEMINI_ENABLED                 must be `true` to use Gemini at all.
 *   GEMINI_API_KEY                 server-side only. Never a VITE_ variable, never sent to the browser.
 *   GEMINI_MODEL                   primary model. No default in code: the models available differ per project.
 *   GEMINI_FALLBACK_MODELS         comma list tried in order when the primary is out of quota or unavailable.
 *   GEMINI_TIMEOUT_MS, GEMINI_MAX_OUTPUT_TOKENS
 *   GEMINI_MAX_REQUESTS_PER_RUN    requests per analysed run, all models together (retries count).
 *   GEMINI_MAX_REQUESTS_PER_DAY    requests per model per day (Pacific midnight reset).
 *   GEMINI_SEND_SCREENSHOTS        `true` lets design-critic send approved screenshots to Gemini. Default false.
 *   GEMINI_MAX_SCREENSHOTS         screenshots per review (1..8, default 4); GEMINI_MAX_SCREENSHOT_BYTES per image (default 1.5 MB).
 *   OFFICE_OLLAMA_ENABLED          `false` removes Ollama from the chain.
 * A bad value never stops the office: it is reported by name and the safe choice is used (provider off, default limit).
 */
export function loadProviderConfig(env: Record<string, string | undefined>): ProviderConfig {
  const warnings: string[] = [];
  const get = (name: string) => (env[name] ?? "").trim();
  const bool = (name: string, fallback: boolean): boolean => {
    const v = get(name).toLowerCase();
    if (!v) return fallback;
    if (v === "true") return true;
    if (v === "false") return false;
    warnings.push(`${name} must be true or false`);
    return fallback;
  };
  const int = (name: string, fallback: number, min: number, max: number): number => {
    const raw = get(name);
    if (!raw) return fallback;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= min && n <= max) return n;
    warnings.push(`${name} must be an integer between ${min} and ${max}`);
    return fallback;
  };

  let preferred: ProviderName | undefined;
  const rawProvider = get("AI_PROVIDER").toLowerCase();
  if (rawProvider) {
    if ((PROVIDER_NAMES as readonly string[]).includes(rawProvider)) preferred = rawProvider as ProviderName;
    else {
      warnings.push("AI_PROVIDER must be gemini, ollama or deterministic; using deterministic");
      preferred = "deterministic"; // a typo must not switch a remote provider on
    }
  }

  const enabled = bool("GEMINI_ENABLED", false);
  const apiKey = get("GEMINI_API_KEY");
  const models: string[] = [];
  for (const raw of [get("GEMINI_MODEL"), ...get("GEMINI_FALLBACK_MODELS").split(",")]) {
    const name = raw.trim().replace(/^models\//, "");
    if (!name) continue;
    if (!MODEL_NAME.test(name)) {
      warnings.push("GEMINI_MODEL / GEMINI_FALLBACK_MODELS contain an invalid model name; it was ignored");
      continue;
    }
    if (!models.includes(name)) models.push(name);
  }
  if (models.length > MAX_MODELS) models.length = MAX_MODELS;
  // The primary must be GEMINI_MODEL itself: alternatives alone do not count as a configured model.
  const primaryConfigured = Boolean(get("GEMINI_MODEL")) && models.length > 0;

  const geminiAllowed = preferred === undefined || preferred === "gemini";
  const wanted = preferred === "gemini" || enabled;
  const skipped: ProviderAttempt[] = [];
  let gemini: GeminiSettings | undefined;
  if (geminiAllowed && wanted) {
    if (!enabled) skipped.push({ provider: "gemini", status: "disabled" });
    else if (!apiKey) skipped.push({ provider: "gemini", status: "no-api-key" });
    else if (!primaryConfigured) skipped.push({ provider: "gemini", status: "model-not-configured" });
    else {
      gemini = {
        apiKey,
        sendScreenshots: bool("GEMINI_SEND_SCREENSHOTS", false),
        models,
        timeoutMs: int("GEMINI_TIMEOUT_MS", GEMINI_DEFAULTS.timeoutMs, 1_000, 120_000),
        maxOutputTokens: int("GEMINI_MAX_OUTPUT_TOKENS", GEMINI_DEFAULTS.maxOutputTokens, 64, 8_192),
      };
    }
  }

  return {
    preferred: preferred ?? (gemini ? "gemini" : "ollama"),
    ...(gemini ? { gemini } : {}),
    ollama: preferred !== "deterministic" && bool("OFFICE_OLLAMA_ENABLED", true),
    images: {
      max: int("GEMINI_MAX_SCREENSHOTS", GEMINI_DEFAULTS.maxScreenshots, 1, 8),
      maxBytes: int("GEMINI_MAX_SCREENSHOT_BYTES", GEMINI_DEFAULTS.maxScreenshotBytes, 50_000, 5_000_000),
    },
    limits: {
      perRun: int("GEMINI_MAX_REQUESTS_PER_RUN", GEMINI_DEFAULTS.maxRequestsPerRun, 1, 100),
      perDayPerModel: int("GEMINI_MAX_REQUESTS_PER_DAY", GEMINI_DEFAULTS.maxRequestsPerDay, 1, 10_000),
    },
    skipped,
    warnings,
  };
}
