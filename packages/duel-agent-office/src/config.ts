import { config as loadDotenv } from "dotenv";

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid configuration: ${problems.join("; ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export interface PlayerCredentials {
  email: string;
  password: string;
  /** Display name shown by the Dev Login panel (Dev Login mode only). */
  devLoginName: string;
}

export interface Config {
  baseUrl: string;
  players: { alpha: PlayerCredentials; bravo: PlayerCredentials };
  devLogin: { enabled: boolean; secret: string };
  headless: boolean;
  videoEnabled: boolean;
  /** Off by default: traces are large and hold raw network data. */
  traceEnabled: boolean;
  screenshotOnStep: boolean;
  scenarioTimeoutMs: number;
}

const PRODUCTION_HOSTS = ["duel.hugoviegas.dev"];
const PREVIEW_SUFFIX = ".vercel.app";

/**
 * Returns a sanitized problem string, or null when the target is an acceptable
 * Vercel Preview URL. The URL itself is never echoed back.
 */
export function checkPreviewTarget(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return "GAME_BASE_URL is empty";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "GAME_BASE_URL is not a valid URL";
  }
  const host = url.hostname.toLowerCase();
  const productionLooking =
    PRODUCTION_HOSTS.some((p) => host === p || host.endsWith(`.${p}`)) ||
    host.endsWith(".hugoviegas.dev") ||
    /(^|[.-])(prod|production|live|www)([.-]|$)/.test(host.replace(PREVIEW_SUFFIX, ""));
  if (productionLooking) return "GAME_BASE_URL looks like a Production target and is rejected";
  if (url.protocol !== "https:") return "GAME_BASE_URL must use https";
  if (url.username || url.password) return "GAME_BASE_URL must not contain credentials";
  if (!host.endsWith(PREVIEW_SUFFIX)) return "GAME_BASE_URL must be a Vercel Preview URL (*.vercel.app)";
  return null;
}

function parseBool(name: string, raw: string | undefined, fallback: boolean, problems: string[]): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return fallback;
  if (v === "true") return true;
  if (v === "false") return false;
  problems.push(`${name} must be true or false`);
  return fallback;
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];
  const targetProblem = checkPreviewTarget(env.GAME_BASE_URL);
  if (targetProblem) problems.push(targetProblem);

  const opt = (name: string) => (env[name] ?? "").trim();
  const need = (name: string): string => {
    const v = opt(name);
    if (!v) problems.push(`${name} is required`);
    return v;
  };

  const devEnabled = parseBool("QA_DEV_LOGIN_ENABLED", env.QA_DEV_LOGIN_ENABLED, false, problems);
  const player = (prefix: "ALPHA" | "BRAVO"): PlayerCredentials =>
    devEnabled
      ? { email: "", password: "", devLoginName: need(`QA_${prefix}_DEV_LOGIN_NAME`) }
      : { email: need(`QA_${prefix}_EMAIL`), password: need(`QA_${prefix}_PASSWORD`), devLoginName: "" };
  const alpha = player("ALPHA");
  const bravo = player("BRAVO");
  const secret = devEnabled ? need("QA_DEV_LOGIN_SECRET") : opt("QA_DEV_LOGIN_SECRET");

  if (!devEnabled && alpha.email && alpha.email === bravo.email) {
    problems.push("QA_ALPHA_EMAIL and QA_BRAVO_EMAIL must be different accounts");
  }
  if (devEnabled && alpha.devLoginName && alpha.devLoginName === bravo.devLoginName) {
    problems.push("QA_ALPHA_DEV_LOGIN_NAME and QA_BRAVO_DEV_LOGIN_NAME must be different accounts");
  }

  let scenarioTimeoutMs = 600_000;
  const rawTimeout = opt("QA_SCENARIO_TIMEOUT_MS");
  if (rawTimeout) {
    const n = Number(rawTimeout);
    if (!Number.isInteger(n) || n < 10_000) problems.push("QA_SCENARIO_TIMEOUT_MS must be an integer >= 10000");
    else scenarioTimeoutMs = n;
  }

  const headless = parseBool("QA_HEADLESS", env.QA_HEADLESS, false, problems);
  const videoEnabled = parseBool("QA_VIDEO_ENABLED", env.QA_VIDEO_ENABLED, false, problems);
  const traceEnabled = parseBool("QA_TRACE_ENABLED", env.QA_TRACE_ENABLED, false, problems);
  const screenshotOnStep = parseBool("QA_SCREENSHOT_ON_STEP", env.QA_SCREENSHOT_ON_STEP, true, problems);

  if (problems.length) throw new ConfigError(problems);

  return {
    baseUrl: new URL(opt("GAME_BASE_URL")).origin,
    players: { alpha, bravo },
    devLogin: { enabled: devEnabled, secret },
    headless,
    videoEnabled,
    traceEnabled,
    screenshotOnStep,
    scenarioTimeoutMs,
  };
}

/** Loads the local ignored .env (if present) and validates it. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  if (env === process.env) loadDotenv({ quiet: true });
  return parseConfig(env);
}

/** Every value that must never reach an artifact, event or log. */
export function secretValues(config: Config): string[] {
  const { alpha, bravo } = config.players;
  return [
    config.baseUrl,
    new URL(config.baseUrl).host,
    config.devLogin.secret,
    alpha.email,
    alpha.password,
    bravo.email,
    bravo.password,
  ].filter((v) => v.length > 0);
}
