import type { Manifest } from "@hugents/core";
import { assertAllowedTarget } from "./manifest.js";

/** The slice of a Playwright page the seed needs. Keeps this package free of a browser dependency. */
export interface PageLike {
  goto(url: string): Promise<unknown>;
}

export class SeedError extends Error {
  constructor(readonly code: "account-not-in-manifest" | "account-missing") {
    super(code);
    this.name = "SeedError";
  }
}

export interface SeedConfig<P extends PageLike> {
  manifest: Manifest;
  /** Supplied by the run task, never by the generated spec or a model. Checked against the manifest. */
  targetUrl: string;
  /** Name of the environment variable holding the test account. Must be listed in the manifest. */
  accountVariable: string;
  env: Readonly<Record<string, string | undefined>>;
  page: P;
  /** Project-specific login steps (an adapter). Receives the credential; the credential never leaves this call. */
  login(page: P, credential: string): Promise<void>;
}

/**
 * The shared seed fixture contract: enforces the manifest allowlist before any navigation, logs in with a test
 * account referenced by variable name, and returns a ready page. Every generated test starts here.
 */
export async function openSeededPage<P extends PageLike>(config: SeedConfig<P>): Promise<P> {
  const target = assertAllowedTarget(config.targetUrl, config.manifest);
  if (!config.manifest.testAccountVariableNames.includes(config.accountVariable)) {
    throw new SeedError("account-not-in-manifest");
  }
  const credential = config.env[config.accountVariable];
  if (!credential) throw new SeedError("account-missing");
  await config.page.goto(target.href);
  await config.login(config.page, credential);
  return config.page;
}
