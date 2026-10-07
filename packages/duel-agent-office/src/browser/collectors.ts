import type { Page } from "playwright";
import { redact } from "../redact.js";
import { appendJsonl, type RunPaths } from "../storage/artifacts.js";
import type { AgentName } from "../orchestrator/eventBus.js";

/** Writes redacted console errors, uncaught page errors and failed requests as JSONL. */
export function attachCollectors(
  page: Page,
  agent: AgentName,
  run: RunPaths,
  secrets: readonly string[],
  now: () => Date = () => new Date(),
): void {
  const write = (file: string, record: Record<string, unknown>) => {
    appendJsonl(file, { at: now().toISOString(), agent, ...record }).catch(() => undefined);
  };

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    write(run.console, {
      kind: "console-error",
      text: redact(message.text(), secrets).slice(0, 1000),
      location: redact(message.location().url ?? "", secrets),
    });
  });
  page.on("pageerror", (error) => {
    write(run.console, { kind: "page-error", text: redact(error.message, secrets).slice(0, 1000) });
  });
  page.on("requestfailed", (request) => {
    write(run.networkFailures, {
      kind: "request-failed",
      method: request.method(),
      url: redact(request.url(), secrets),
      failure: redact(request.failure()?.errorText ?? "unknown", secrets),
    });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    write(run.networkFailures, {
      kind: "http-error",
      method: response.request().method(),
      url: redact(response.url(), secrets),
      status: response.status(),
    });
  });
}
