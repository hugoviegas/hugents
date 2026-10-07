import type { OfficeAgentId } from "../contract.js";

export const PROVIDER_NAMES = ["gemini", "ollama", "deterministic"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** Fixed vocabulary. Never carries provider messages, prompts, responses or keys. */
export type ProviderStatus =
  | "ok"
  | "disabled"
  | "no-api-key"
  | "model-not-configured"
  | "guard-blocked"
  | "budget-run"
  | "budget-daily"
  | "timeout"
  | "auth"
  | "rate-limit"
  | "quota-exhausted"
  | "model-not-found"
  | "unavailable"
  | "malformed-response"
  | "unsafe-response"
  | "error";

export interface ProviderAttempt {
  provider: ProviderName;
  model?: string;
  status: ProviderStatus;
}

/** The only thing a model is asked to produce. Validated at runtime, rendered to Markdown by us. */
export interface StructuredReport {
  verdict: "pass" | "issues" | "inconclusive";
  summary: string;
  findings: { severity: "low" | "medium" | "high"; category: string; assessment: string; area: string }[];
  repeatedProblems: string[];
  nextSteps: string[];
}

/**
 * Everything a provider may see. Built from an allowlist (see `buildSafeInput`): counts, fixed-vocabulary fields,
 * the observer's sanitized findings and relative screenshot names. No console, network or event text, no task title,
 * no memories, no images, no URLs.
 */
export interface SafeInput {
  agent: OfficeAgentId;
  run: { id: string; scenario?: string; status?: string; durationMs?: number; failureCategory?: string; blockedOn?: string };
  outcome?: { alpha: string; bravo: string; turnsAlpha: number; turnsBravo: number };
  screens?: { screen: string; ok: boolean; reason?: string }[];
  observer: {
    available: boolean;
    note?: string;
    findings: { severity: string; category: string; player: string; count: number; message: string }[];
    repeated: { severity: string; category: string; runs: number; occurrences: number; message: string }[];
    ignoredNetworkFailures: number;
    /** Only when the observer is unavailable: counts of the raw records read, never their text. */
    rawCounts?: { consoleRecords: number; httpErrors: number; failedRequests: number; cancelledRequests: number };
  };
  recordCounts: { events: number; console: number; networkFailures: number };
  /** Relative names such as `alpha/03-menu.png`. References only, the pixels are never sent. */
  screenshotRefs: string[];
}

/** One approved screenshot, loaded and checked (PNG signature, size). The pixels are the only unredacted part of a request. */
export interface ImagePart {
  /** Relative name, e.g. `alpha/03-menu.png`. */
  name: string;
  mimeType: "image/png";
  /** Base64 of the file. */
  data: string;
}

export interface ProviderContext {
  /** Budget key for the per-run limit (the analysed run id). */
  runKey: string;
  /** Only ever set for design-critic. A provider attaches them only if it is allowed to (see GEMINI_SEND_SCREENSHOTS). */
  images?: ImagePart[];
}

export interface ProviderResult {
  /** One entry per model or provider tried, in order. The last one is `ok` when `report` is set. */
  attempts: ProviderAttempt[];
  report?: StructuredReport;
  tokens: number;
  /** How many screenshots this provider actually sent with the request that produced the report. */
  imagesSent?: number;
}

export interface ReportProvider {
  readonly name: Exclude<ProviderName, "deterministic">;
  generate(input: SafeInput, ctx: ProviderContext): Promise<ProviderResult>;
}

export interface ChainResult {
  report?: StructuredReport;
  tokens: number;
  /** `deterministic` when no provider produced a valid, safe report. */
  used: ProviderName;
  model?: string;
  attempts: ProviderAttempt[];
  imagesSent?: number;
}

export interface ReportChain {
  generate(input: SafeInput, options?: { images?: ImagePart[] }): Promise<ChainResult>;
}
