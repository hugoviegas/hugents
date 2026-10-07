import { constrainReport, unsafeKinds } from "./report.js";
import type { ChainResult, ProviderAttempt, ReportChain, ReportProvider } from "./types.js";

export interface ChainDeps {
  /** In order of preference. The deterministic template is not a member: it is what runs when this chain returns no report. */
  providers: ReportProvider[];
  /** Known secret values, including the provider key. */
  secrets: () => readonly string[];
  /** Statuses recorded before any call, e.g. `gemini: disabled` when it was asked for but is not configured. */
  skipped?: ProviderAttempt[];
}

/**
 * gemini -> ollama -> deterministic. Two guards wrap every provider: the payload is checked before anything is
 * sent (a hit means no provider is called at all) and each answer is checked before it is accepted.
 */
export function createReportChain(deps: ChainDeps): ReportChain {
  return {
    async generate(input, options): Promise<ChainResult> {
      const attempts: ProviderAttempt[] = [...(deps.skipped ?? [])];
      const secrets = deps.secrets();
      const blocked = unsafeKinds(JSON.stringify(input), secrets, "input");
      if (blocked.length) {
        for (const p of deps.providers) attempts.push({ provider: p.name, status: "guard-blocked" });
        return { tokens: 0, used: "deterministic", attempts };
      }
      for (const provider of deps.providers) {
        const result = await provider.generate(input, { runKey: `${input.run.id}:${input.agent}`, ...(options?.images?.length ? { images: options.images } : {}) });
        const last = result.attempts.at(-1);
        if (result.report && last && unsafeKinds(JSON.stringify(result.report), secrets, "output").length) {
          attempts.push(...result.attempts.slice(0, -1), { ...last, status: "unsafe-response" });
          continue;
        }
        attempts.push(...result.attempts);
        if (result.report && last) {
          return {
            report: constrainReport(result.report, input, Boolean(result.imagesSent)),
            tokens: result.tokens,
            used: provider.name,
            ...(last.model ? { model: last.model } : {}),
            ...(result.imagesSent ? { imagesSent: result.imagesSent } : {}),
            attempts,
          };
        }
      }
      return { tokens: 0, used: "deterministic", attempts };
    },
  };
}
