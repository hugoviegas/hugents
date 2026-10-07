/**
 * The part of the project manifest the generator needs (docs/manifest.md). No manifest parser exists in the
 * repository yet, so this is a local, minimal shape. `screens` is new: the doc only lists `screensToHide`.
 */
export interface GeneratorManifest {
  projectId: string;
  /** Strict allowlist of non-production targets, as a regular expression source anchored with ^ and $. */
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
