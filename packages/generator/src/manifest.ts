import { parseManifest, type Manifest } from "@hugents/core";

export class ManifestError extends Error {
  /** A fixed reason code from the core parser, with the field path. Never the offending value. */
  constructor(readonly code: string, readonly path = "$") {
    super(code);
    this.name = "ManifestError";
  }
}

/** Validates untrusted input with the core parser. Throws a `ManifestError` with the first reason code. */
export function createManifest(input: unknown): Manifest {
  const result = parseManifest(input);
  if (!result.ok) {
    const first = result.issues[0]!;
    throw new ManifestError(first.code, first.path);
  }
  return result.manifest;
}

export class TargetBlockedError extends Error {
  constructor() {
    super("target not allowed by manifest");
    this.name = "TargetBlockedError";
  }
}

/** Throws unless `url` is on the manifest allowlist and not blocked. Called before every navigation. */
export function assertAllowedTarget(url: string, manifest: Manifest): URL {
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
