/**
 * The part of the project manifest the generator needs (docs/manifest.md). No manifest parser exists in the
 * repository yet, so this is a local, minimal shape. `screens` is new: the doc only lists `screensToHide`.
 */
export interface GeneratorManifest {
  projectId: string;
  /** Strict allowlist of non-production targets, as a regular expression source anchored with ^ and $ (enforced by `createManifest`). */
  allowedTargetUrlPattern: string;
  /** Explicit blocked targets (case-insensitive substrings of the host). Always wins over the allowlist. */
  blockedTargets: readonly string[];
  /** Names of environment variables holding test accounts. Never values. */
  testAccountVariableNames: readonly string[];
  /** Screens a test may target. */
  screens: readonly { id: string; hidden?: boolean }[];
  /** Operations a generated test must never perform, as lower-case phrases (e.g. "delete account"). */
  forbiddenActions: readonly string[];
}

export class ManifestError extends Error {
  constructor(readonly code: "unanchored-pattern" | "invalid-pattern" | "empty-allowlist") {
    super(code);
    this.name = "ManifestError";
  }
}

/** True when the source starts with ^, ends with an unescaped $ and has no top-level alternation. */
function isAnchored(source: string): boolean {
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

/**
 * Builds a manifest from untrusted input. An unanchored allowlist pattern would match a URL that merely contains an
 * allowed host, so it is refused here, once, instead of being trusted at every call site.
 */
export function createManifest(input: GeneratorManifest): GeneratorManifest {
  if (!isAnchored(input.allowedTargetUrlPattern)) throw new ManifestError("unanchored-pattern");
  try {
    new RegExp(input.allowedTargetUrlPattern);
  } catch {
    throw new ManifestError("invalid-pattern");
  }
  return Object.freeze({
    ...input,
    blockedTargets: [...input.blockedTargets],
    testAccountVariableNames: [...input.testAccountVariableNames],
    screens: input.screens.map((x) => ({ ...x })),
    forbiddenActions: [...input.forbiddenActions],
  });
}

export class TargetBlockedError extends Error {
  constructor() {
    super("target not allowed by manifest");
    this.name = "TargetBlockedError";
  }
}

/** Throws unless `url` is on the manifest allowlist and not blocked. Called before every navigation. */
export function assertAllowedTarget(url: string, manifest: GeneratorManifest): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TargetBlockedError();
  }
  const host = parsed.hostname.toLowerCase();
  const blocked = manifest.blockedTargets.some((b) => b && host.includes(b.toLowerCase()));
  const allowed = new RegExp(manifest.allowedTargetUrlPattern).test(parsed.origin);
  if (blocked || !allowed || (parsed.protocol !== "https:" && parsed.hostname !== "localhost")) {
    throw new TargetBlockedError();
  }
  return parsed;
}
