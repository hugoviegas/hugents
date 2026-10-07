import { DEFAULT_RULES } from "./sanitizer.js";

/** Project manifest (docs/manifest.md). The single source of truth for every package. */
export interface Manifest {
  projectId: string;
  /** Regular expression source anchored with ^ and $, tested against the origin of a target URL. */
  allowedTargetUrlPattern: string;
  /** Case-insensitive host substrings. Always win over the allowlist. */
  blockedTargets: readonly string[];
  /** Names of environment variables holding test accounts. Never values. */
  testAccountVariableNames: readonly string[];
  /** Scenario ids available for this project. */
  availableScenarios: readonly string[];
  /** Screens a test may target. A hidden screen is masked in generated views and never explored. */
  screens: readonly { id: string; hidden: boolean }[];
  /** Operations a generated test must never perform, as lower-case phrases. */
  forbiddenActions: readonly string[];
}

export const MANIFEST_LIMITS = {
  maxBytes: 64 * 1024,
  maxBlockedTargets: 100,
  maxAccounts: 20,
  maxScenarios: 200,
  maxScreens: 200,
  maxForbiddenActions: 100,
  maxPatternLength: 500,
  maxPhraseLength: 80,
  maxIdLength: 64,
} as const;

export const MANIFEST_REASON_CODES = [
  "invalid-json",
  "too-large",
  "not-an-object",
  "missing-field",
  "invalid-type",
  "invalid-value",
  "unknown-field",
  "unanchored-pattern",
  "invalid-pattern",
  "secret-shaped",
  "too-many-items",
  "too-long",
  "duplicate",
] as const;
export type ManifestReasonCode = (typeof MANIFEST_REASON_CODES)[number];

/** A problem and where it is. Never carries the offending value. */
export interface ManifestIssue {
  code: ManifestReasonCode;
  path: string;
}

export type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; issues: ManifestIssue[] };

const FIELDS = [
  "projectId",
  "allowedTargetUrlPattern",
  "blockedTargets",
  "testAccountVariableNames",
  "availableScenarios",
  "screens",
  "forbiddenActions",
] as const;
/** Required safety fields. `availableScenarios` is optional (defaults to empty). */
const REQUIRED = FIELDS.filter((f) => f !== "availableScenarios");

const ID = /^[a-z0-9][a-z0-9-]*$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const HOST_FRAGMENT = /^[a-z0-9.-]+$/;

/** True when the source starts with ^, ends with an unescaped $ and has no top-level alternation. */
export function isAnchoredPattern(source: string): boolean {
  if (!source.startsWith("^") || !source.endsWith("$")) return false;
  let backslashes = 0;
  for (let i = source.length - 2; i >= 0 && source[i] === "\\"; i--) backslashes++;
  if (backslashes % 2 === 1) return false;
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") i++;
    else if (inClass) inClass = c !== "]";
    else if (c === "[") inClass = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "|" && depth === 0) return false;
  }
  return true;
}

/** True when the text matches a built-in secret rule. `allowUrl` is for the allowlist pattern, which holds a scheme. */
function looksSecret(text: string, allowUrl: boolean): boolean {
  return DEFAULT_RULES.some(
    (rule) => !(allowUrl && rule.name === "url") && new RegExp(rule.pattern.source, rule.pattern.flags).test(text),
  );
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Parses and validates a manifest from JSON text or an already-parsed value. Fails closed: any problem rejects the
 * whole manifest and no partial data is returned. Issues carry a fixed code and a field path, never a value.
 */
export function parseManifest(input: unknown): ManifestResult {
  const issues: ManifestIssue[] = [];
  const add = (code: ManifestReasonCode, path: string) => issues.push({ code, path });
  const fail = (): ManifestResult => ({ ok: false, issues });

  let value = input;
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > MANIFEST_LIMITS.maxBytes) {
      add("too-large", "$");
      return fail();
    }
    try {
      value = JSON.parse(input);
    } catch {
      add("invalid-json", "$");
      return fail();
    }
  }
  if (!isObject(value)) {
    add("not-an-object", "$");
    return fail();
  }
  const raw = value;

  for (const key of Object.keys(raw)) {
    if (!(FIELDS as readonly string[]).includes(key)) add("unknown-field", key);
  }
  for (const key of REQUIRED) {
    if (raw[key] === undefined) add("missing-field", key);
  }

  /** A string field: type, length, shape and secret check. Returns the string when it is clean. */
  function str(path: string, v: unknown, max: number, shape?: RegExp, allowUrl = false): string | undefined {
    if (typeof v !== "string") return add("invalid-type", path), undefined;
    if (v.length === 0) return add("invalid-value", path), undefined;
    if (v.length > max) return add("too-long", path), undefined;
    if (looksSecret(v, allowUrl)) return add("secret-shaped", path), undefined;
    if (shape && !shape.test(v)) return add("invalid-value", path), undefined;
    return v;
  }

  /** A list of strings with a count limit and no duplicates. */
  function list(path: string, v: unknown, maxItems: number, max: number, shape: RegExp | undefined, min = 0): string[] | undefined {
    if (!Array.isArray(v)) return add("invalid-type", path), undefined;
    if (v.length > maxItems) return add("too-many-items", path), undefined;
    if (v.length < min) return add("invalid-value", path), undefined;
    const out: string[] = [];
    const seen = new Set<string>();
    v.forEach((item, i) => {
      const s = str(`${path}[${i}]`, item, max, shape);
      if (s === undefined) return;
      if (seen.has(s)) add("duplicate", `${path}[${i}]`);
      seen.add(s);
      out.push(s);
    });
    return out;
  }

  const L = MANIFEST_LIMITS;
  const projectId = raw.projectId === undefined ? undefined : str("projectId", raw.projectId, L.maxIdLength, ID);

  let pattern: string | undefined;
  if (raw.allowedTargetUrlPattern !== undefined) {
    pattern = str("allowedTargetUrlPattern", raw.allowedTargetUrlPattern, L.maxPatternLength, undefined, true);
    if (pattern !== undefined) {
      if (!isAnchoredPattern(pattern)) add("unanchored-pattern", "allowedTargetUrlPattern");
      else {
        try {
          new RegExp(pattern);
        } catch {
          add("invalid-pattern", "allowedTargetUrlPattern");
        }
      }
    }
  }

  // At least one blocked target: production is always blocked, so an empty list is a misconfiguration.
  const blocked = raw.blockedTargets === undefined ? undefined : list("blockedTargets", raw.blockedTargets, L.maxBlockedTargets, L.maxPhraseLength, HOST_FRAGMENT, 1);
  const accounts = raw.testAccountVariableNames === undefined ? undefined : list("testAccountVariableNames", raw.testAccountVariableNames, L.maxAccounts, L.maxIdLength, ENV_NAME);
  const scenarios = raw.availableScenarios === undefined ? [] : list("availableScenarios", raw.availableScenarios, L.maxScenarios, L.maxIdLength, ID);
  const forbidden = raw.forbiddenActions === undefined ? undefined : list("forbiddenActions", raw.forbiddenActions, L.maxForbiddenActions, L.maxPhraseLength, undefined);

  let screens: { id: string; hidden: boolean }[] | undefined;
  if (raw.screens !== undefined) {
    if (!Array.isArray(raw.screens)) add("invalid-type", "screens");
    else if (raw.screens.length > L.maxScreens) add("too-many-items", "screens");
    else {
      screens = [];
      const seen = new Set<string>();
      raw.screens.forEach((entry: unknown, i) => {
        const base = `screens[${i}]`;
        if (!isObject(entry)) return add("invalid-type", base);
        for (const key of Object.keys(entry)) if (key !== "id" && key !== "hidden") add("unknown-field", `${base}.${key}`);
        const id = entry.id === undefined ? (add("missing-field", `${base}.id`), undefined) : str(`${base}.id`, entry.id, L.maxIdLength, ID);
        // A missing `hidden` flag would silently expose a screen, so it is required.
        if (entry.hidden === undefined) add("missing-field", `${base}.hidden`);
        else if (typeof entry.hidden !== "boolean") add("invalid-type", `${base}.hidden`);
        if (id === undefined) return;
        if (seen.has(id)) add("duplicate", `${base}.id`);
        seen.add(id);
        if (typeof entry.hidden === "boolean") screens!.push({ id, hidden: entry.hidden });
      });
    }
  }

  if (issues.length > 0 || !projectId || !pattern || !blocked || !accounts || !scenarios || !forbidden || !screens) return fail();
  return {
    ok: true,
    manifest: Object.freeze({
      projectId,
      allowedTargetUrlPattern: pattern,
      blockedTargets: Object.freeze(blocked),
      testAccountVariableNames: Object.freeze(accounts),
      availableScenarios: Object.freeze(scenarios),
      screens: Object.freeze(screens.map((s) => Object.freeze(s))),
      forbiddenActions: Object.freeze(forbidden),
    }),
  };
}

/**
 * Migration path for manifests written against the first draft of docs/manifest.md, which listed `screensToHide`.
 * Each legacy entry becomes a hidden screen. Entries that are selectors rather than screen ids are then rejected by
 * `parseManifest` with a path, so they must be renamed by hand. Visible screens must be added to `screens`.
 */
export function migrateLegacyManifest(input: unknown): unknown {
  if (!isObject(input) || input.screensToHide === undefined) return input;
  const { screensToHide, ...rest } = input;
  const existing = Array.isArray(rest.screens) ? rest.screens : [];
  const legacy = Array.isArray(screensToHide) ? screensToHide.map((id) => ({ id, hidden: true })) : screensToHide;
  return { ...rest, screens: Array.isArray(legacy) ? [...existing, ...legacy] : legacy };
}
