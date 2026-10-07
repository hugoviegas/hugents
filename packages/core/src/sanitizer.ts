import { MAX_LABEL_LENGTH, parseEvent, type HugentsEvent } from "./events.js";

export interface SanitizerRule {
  name: string;
  pattern: RegExp;
}

/** Built-in rules. Project-specific ones (e.g. room codes) are added by adapters. */
export const DEFAULT_RULES: readonly SanitizerRule[] = [
  { name: "url", pattern: /\b(?:https?|wss?|ftp):\/\/[^\s"'<>]+/gi },
  { name: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: "jwt", pattern: /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}\b/g },
  { name: "bearer", pattern: /\bBearer\s+[\w.~+/-]{8,}=*/gi },
  { name: "google-api-key", pattern: /\bAIza[\w-]{20,}\b/g },
  { name: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: "secret-assignment", pattern: /\b(?:api[_-]?key|token|secret|password|passwd)\s*[=:]\s*\S+/gi },
  { name: "long-token", pattern: /\b[A-Za-z0-9_-]{32,}\b/g },
];

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export interface Sanitizer {
  sanitizeText(text: string, maxLength?: number): string;
  sanitizeEvent(input: unknown): HugentsEvent;
}

export function createSanitizer(extraRules: readonly SanitizerRule[] = []): Sanitizer {
  const rules = [...DEFAULT_RULES, ...extraRules];

  function sanitizeText(text: string, maxLength = MAX_LABEL_LENGTH): string {
    let out = text.replace(CONTROL_CHARS, " ");
    for (const rule of rules) {
      out = out.replace(new RegExp(rule.pattern.source, rule.pattern.flags), `[${rule.name}]`);
    }
    out = out.replace(/\s+/g, " ").trim();
    if (out.length > maxLength) out = `${out.slice(0, maxLength - 1)}…`;
    return out;
  }

  function sanitizeEvent(input: unknown): HugentsEvent {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return parseEvent(input);
    }
    const raw = input as Record<string, unknown>;
    const label = typeof raw.label === "string" ? sanitizeText(raw.label) : raw.label;
    return parseEvent({ ...raw, label });
  }

  return { sanitizeText, sanitizeEvent };
}
