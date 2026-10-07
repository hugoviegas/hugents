import type { Sanitizer } from "./sanitizer.js";

/** Already-sanitized, structured input. Never raw page text, traces or screenshots. */
export interface ReportInput {
  runId: string;
  totals: { findings: number; errors: number; warnings: number };
  findings: Array<{ id: string; severity: "error" | "warning" | "info"; title: string }>;
}

export interface Report {
  provider: string;
  summary: string;
  highlights: string[];
}

/** Providers write text only. They never choose tools, parameters or actions. */
export interface AiProvider {
  readonly name: string;
  generateReport(input: ReportInput): Promise<Report>;
}

export class DeterministicProvider implements AiProvider {
  readonly name = "deterministic";

  async generateReport(input: ReportInput): Promise<Report> {
    const { totals } = input;
    const summary = `Run ${input.runId}: ${totals.findings} findings (${totals.errors} errors, ${totals.warnings} warnings).`;
    const highlights = input.findings
      .filter((f) => f.severity !== "info")
      .slice(0, 5)
      .map((f) => `${f.severity}: ${f.title}`);
    return { provider: this.name, summary, highlights };
  }
}

export function validateReport(value: unknown, sanitizer: Sanitizer): Report {
  if (typeof value !== "object" || value === null) throw new Error("invalid report");
  const r = value as Record<string, unknown>;
  if (typeof r.provider !== "string" || typeof r.summary !== "string" || !Array.isArray(r.highlights)) {
    throw new Error("invalid report shape");
  }
  if (!r.highlights.every((h) => typeof h === "string")) throw new Error("invalid highlights");
  return {
    provider: sanitizer.sanitizeText(r.provider, 40),
    summary: sanitizer.sanitizeText(r.summary, 600),
    highlights: (r.highlights as string[]).slice(0, 10).map((h) => sanitizer.sanitizeText(h, 200)),
  };
}

/**
 * Tries providers in order. Any failure or invalid output falls through to the next;
 * the deterministic provider always terminates the chain.
 */
export function createProviderChain(
  providers: readonly AiProvider[],
  sanitizer: Sanitizer,
): AiProvider {
  const chain = [...providers.filter((p) => p.name !== "deterministic"), new DeterministicProvider()];
  return {
    name: "chain",
    async generateReport(input) {
      for (const provider of chain) {
        try {
          return validateReport(await provider.generateReport(input), sanitizer);
        } catch {
          // fall through to the next provider
        }
      }
      throw new Error("unreachable: deterministic provider failed");
    },
  };
}
