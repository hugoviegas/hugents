import path from "node:path";
import { DEFAULT_IGNORED_NETWORK } from "./analyze.js";

export class ObserverConfigError extends Error {}

export interface ObserverConfig {
  artifactsDir: string;
  /** Explicit findings file; default is `<run>/findings.json` (one run) or `<artifactsDir>/findings.json`. */
  findingsFile?: string;
  ignoreNetworkFailures: string[];
  reportAborted: boolean;
  screenshotLimit: number;
  host: string;
  port: number;
  activeWindowMs: number;
}

export const OBSERVER_DEFAULTS = { host: "127.0.0.1", port: 4873, screenshotLimit: 12, activeWindowMs: 60 * 60 * 1000 } as const;
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

/**
 * Read from the process environment only. The observer never loads `.env` (it holds QA
 * credentials). Variables: QA_OBSERVER_ARTIFACTS_DIR, QA_OBSERVER_FINDINGS_FILE,
 * QA_OBSERVER_IGNORE_NETWORK (comma list), QA_OBSERVER_REPORT_ABORTED (true|false),
 * QA_OBSERVER_SCREENSHOT_LIMIT, QA_OBSERVER_HOST, QA_OBSERVER_PORT.
 */
export function loadObserverConfig(
  env: Record<string, string | undefined>,
  defaultArtifactsDir: string,
  overrides: { reportAborted?: boolean } = {},
): ObserverConfig {
  const problems: string[] = [];
  const int = (name: string, fallback: number, min: number, max: number): number => {
    const raw = (env[name] ?? "").trim();
    if (raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(`${name} must be an integer between ${min} and ${max}`);
      return fallback;
    }
    return n;
  };
  const bool = (name: string): boolean => {
    const raw = (env[name] ?? "").trim().toLowerCase();
    if (raw === "" || raw === "false") return false;
    if (raw === "true") return true;
    problems.push(`${name} must be true or false`);
    return false;
  };

  const host = (env.QA_OBSERVER_HOST ?? "").trim() || OBSERVER_DEFAULTS.host;
  if (!LOOPBACK_HOSTS.includes(host)) problems.push("QA_OBSERVER_HOST must be a loopback address (127.0.0.1, localhost or ::1)");

  const findingsRaw = (env.QA_OBSERVER_FINDINGS_FILE ?? "").trim();
  if (findingsRaw && !findingsRaw.toLowerCase().endsWith(".json")) problems.push("QA_OBSERVER_FINDINGS_FILE must be a .json file");

  const extraIgnore = (env.QA_OBSERVER_IGNORE_NETWORK ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const reportAborted = overrides.reportAborted ?? bool("QA_OBSERVER_REPORT_ABORTED");
  const defaults = reportAborted ? [] : [...DEFAULT_IGNORED_NETWORK];
  const artifactsRaw = (env.QA_OBSERVER_ARTIFACTS_DIR ?? "").trim();

  const config: ObserverConfig = {
    artifactsDir: artifactsRaw ? path.resolve(artifactsRaw) : defaultArtifactsDir,
    ...(findingsRaw ? { findingsFile: path.resolve(findingsRaw) } : {}),
    ignoreNetworkFailures: [...new Set([...defaults, ...extraIgnore])],
    reportAborted,
    screenshotLimit: int("QA_OBSERVER_SCREENSHOT_LIMIT", OBSERVER_DEFAULTS.screenshotLimit, 0, 50),
    host,
    port: int("QA_OBSERVER_PORT", OBSERVER_DEFAULTS.port, 0, 65535),
    activeWindowMs: OBSERVER_DEFAULTS.activeWindowMs,
  };
  // Names and rules only, never values.
  if (problems.length) throw new ObserverConfigError(`Invalid observer configuration: ${problems.join("; ")}`);
  return config;
}
