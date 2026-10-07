import { GoogleGenAI } from "@google/genai";
import type { Budget } from "./budget.js";
import { REPORT_JSON_SCHEMA, buildPrompt, validateReport } from "./report.js";
import type { ImagePart, ProviderAttempt, ProviderResult, ProviderStatus, ReportProvider, SafeInput, StructuredReport } from "./types.js";

/** The slice of the official `@google/genai` client this provider uses. Injectable so tests never touch the network. */
export interface GeminiClientLike {
  models: {
    generateContent(params: {
      model: string;
      contents: string | { role: string; parts: Record<string, unknown>[] }[];
      config: Record<string, unknown>;
    }): Promise<{ text?: string; usageMetadata?: { totalTokenCount?: number } }>;
  };
}

export interface GeminiOptions {
  /** Read from the local process environment only. Never logged, never put in a prompt or a status. */
  apiKey: string;
  /** Primary model first, then alternatives tried in order when one is out of quota or unavailable. */
  models: string[];
  timeoutMs: number;
  maxOutputTokens: number;
  budget: Budget;
  /**
   * GEMINI_SEND_SCREENSHOTS. Off (the default): this provider never attaches an image and does not even make a request
   * for a screenshot review, so no image byte leaves the machine. This is the only module that builds image parts.
   */
  sendImages?: boolean;
  client?: GeminiClientLike;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Maps an SDK or network error to a status. Only the status and the message text are looked at, and neither is stored:
 * provider messages can echo request details.
 */
export function classifyError(error: unknown): ProviderStatus {
  const e = (error ?? {}) as { status?: unknown; name?: unknown; message?: unknown };
  const status = typeof e.status === "number" ? e.status : undefined;
  const message = typeof e.message === "string" ? e.message : "";
  if (status === undefined && (e.name === "AbortError" || e.name === "TimeoutError" || /timed? ?out|timeout|aborted/i.test(message))) {
    return "timeout";
  }
  if (status === 401 || status === 403) return "auth";
  if (status === 400 && /api[ _-]?key/i.test(message)) return "auth"; // an invalid key answers 400, not 401
  if (status === 404) return "model-not-found";
  if (status === 429) return /per ?day|daily|quota ?exhaust/i.test(message) ? "quota-exhausted" : "rate-limit";
  if (status !== undefined && status >= 500) return "unavailable";
  return "error";
}

const RETRYABLE: ReadonlySet<ProviderStatus> = new Set(["timeout", "unavailable"]);
/** After these, another model may still work. Auth, budget and bad answers stop the whole provider. */
const TRY_NEXT_MODEL: ReadonlySet<ProviderStatus> = new Set([
  "rate-limit",
  "quota-exhausted",
  "model-not-found",
  "budget-daily",
  "timeout",
  "unavailable",
]);

export function geminiProvider(options: GeminiOptions): ReportProvider {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let client = options.client;
  const getClient = (): GeminiClientLike => (client ??= new GoogleGenAI({ apiKey: options.apiKey }) as unknown as GeminiClientLike);

  async function callOnce(model: string, input: SafeInput, images: ImagePart[]): Promise<{ status: ProviderStatus; report?: StructuredReport; tokens: number }> {
    const { system, user } = buildPrompt(input, images.map((i) => i.name));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await getClient().models.generateContent({
        model,
        contents: images.length
          ? [{ role: "user", parts: [{ text: user }, ...images.map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } }))] }]
          : user,
        config: {
          systemInstruction: system,
          temperature: 0.2,
          maxOutputTokens: options.maxOutputTokens,
          responseMimeType: "application/json",
          responseJsonSchema: REPORT_JSON_SCHEMA,
          abortSignal: controller.signal,
          // One request per attempt: the SDK's own retries (default 5) would bypass the local budget.
          httpOptions: { timeout: options.timeoutMs, retryOptions: { attempts: 1 } },
        },
      });
      const tokens = response.usageMetadata?.totalTokenCount ?? 0;
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.text ?? "");
      } catch {
        return { status: "malformed-response", tokens };
      }
      const report = validateReport(parsed);
      return report ? { status: "ok", report, tokens } : { status: "malformed-response", tokens };
    } catch (error) {
      return { status: controller.signal.aborted ? "timeout" : classifyError(error), tokens: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  async function tryModel(model: string, input: SafeInput, runKey: string, images: ImagePart[]) {
    let last: { status: ProviderStatus; report?: StructuredReport; tokens: number } = { status: "error", tokens: 0 };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let reservation;
      try {
        reservation = await options.budget.reserve(runKey, model);
      } catch {
        return { status: "error" as const, tokens: 0 };
      }
      if (reservation !== "ok") return { status: reservation, tokens: 0 };
      last = await callOnce(model, input, images);
      // One bounded retry, only for transient failures. Rate limits and quota are not retried.
      if (!RETRYABLE.has(last.status) || attempt === 1) break;
      await sleep(options.retryDelayMs ?? 1_000);
    }
    return last;
  }

  return {
    name: "gemini",
    async generate(input, ctx): Promise<ProviderResult> {
      const attempts: ProviderAttempt[] = [];
      const images = ctx.images ?? [];
      // A screenshot review without permission to send the screenshots: no request, no budget spent, nothing leaves.
      if (images.length && !options.sendImages) return { attempts: [{ provider: "gemini", status: "disabled" }], tokens: 0 };
      for (const model of options.models) {
        const result = await tryModel(model, input, ctx.runKey, images);
        attempts.push({ provider: "gemini", model, status: result.status });
        if (result.report) return { attempts, report: result.report, tokens: result.tokens, ...(images.length ? { imagesSent: images.length } : {}) };
        if (!TRY_NEXT_MODEL.has(result.status)) break;
      }
      return { attempts, tokens: 0 };
    },
  };
}
