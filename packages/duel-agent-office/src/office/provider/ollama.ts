import type { Inference } from "../inference.js";
import { REPORT_JSON_SCHEMA, buildPrompt, validateReport } from "./report.js";
import type { ReportProvider } from "./types.js";

/** Optional local fallback: the same safe input and the same structured answer as Gemini, over the existing Ollama client. */
export function ollamaProvider(inference: Inference, model = "ollama", visionModel?: string): ReportProvider {
  return {
    name: "ollama",
    async generate(input, ctx) {
      const images = ctx.images ?? [];
      // A screenshot review needs a local vision model (OFFICE_VISION_MODEL); a text-only answer would not have seen the screens.
      if (images.length && !inference.vision) return { attempts: [{ provider: "ollama", status: "disabled" }], tokens: 0 };
      const used = images.length ? (visionModel ?? model) : model;
      const { system, user } = buildPrompt(input, images.map((i) => i.name));
      const answer = await inference.complete({ system, prompt: user, jsonSchema: REPORT_JSON_SCHEMA, ...(images.length ? { images: images.map((i) => i.data) } : {}) });
      if (!answer) return { attempts: [{ provider: "ollama", model: used, status: "unavailable" }], tokens: 0 };
      let report;
      try {
        report = validateReport(JSON.parse(answer.text));
      } catch {
        report = undefined;
      }
      return report
        ? { attempts: [{ provider: "ollama", model: used, status: "ok" }], report, tokens: answer.tokens, ...(images.length ? { imagesSent: images.length } : {}) }
        : { attempts: [{ provider: "ollama", model: used, status: "malformed-response" }], tokens: answer.tokens };
    },
  };
}
