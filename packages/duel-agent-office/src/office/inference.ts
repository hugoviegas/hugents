export interface CompleteRequest {
  system: string;
  prompt: string;
  /** Base64 PNGs. Sent only when a vision model is configured. */
  images?: string[];
  /** JSON Schema for structured output (Ollama `format`). The answer is still validated by the caller. */
  jsonSchema?: unknown;
}

export interface Inference {
  /** True when `images` will actually be sent to a model. */
  readonly vision: boolean;
  /** `null` when the model is unreachable, slow or answers garbage: callers fall back to a template. */
  complete(request: CompleteRequest): Promise<{ text: string; tokens: number } | null>;
}

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  /** e.g. `llama3.2-vision`. Without it the design-critic never sends screenshots. */
  visionModel?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Local Ollama chat API (non-streaming). Never throws. */
export function ollamaInference(options: OllamaOptions = {}): Inference {
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
  const model = options.model ?? "llama3.2:latest";
  const call = options.fetchImpl ?? fetch;
  return {
    vision: Boolean(options.visionModel),
    async complete(request) {
      const { system, prompt, images } = request;
      const useImages = Boolean(options.visionModel && images?.length);
      try {
        const response = await call(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
          body: JSON.stringify({
            model: useImages ? options.visionModel : model,
            stream: false,
            ...(request.jsonSchema ? { format: request.jsonSchema } : {}),
            options: { temperature: 0.2 },
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt, ...(useImages ? { images } : {}) },
            ],
          }),
        });
        if (!response.ok) return null;
        const data = (await response.json()) as {
          message?: { content?: string };
          prompt_eval_count?: number;
          eval_count?: number;
        };
        const text = data.message?.content?.trim();
        if (!text) return null;
        return { text, tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0) };
      } catch {
        return null;
      }
    },
  };
}
