import { describe, expect, it } from "vitest";
import { ConfigError, checkPreviewTarget, parseConfig, secretValues } from "../src/config.js";

const PREVIEW = "https://duel-git-qa-team.vercel.app";

const base = {
  GAME_BASE_URL: PREVIEW,
  QA_ALPHA_EMAIL: "alpha@qa.invalid",
  QA_ALPHA_PASSWORD: "alpha-pass-123",
  QA_BRAVO_EMAIL: "bravo@qa.invalid",
  QA_BRAVO_PASSWORD: "bravo-pass-456",
};

function problemsOf(env: Record<string, string | undefined>): string[] {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe("target guard", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["not a url", "not a valid URL"],
    ["https://duel.hugoviegas.dev", "Production"],
    ["https://duel.hugoviegas.dev/menu?x=1", "Production"],
    ["https://app.hugoviegas.dev", "Production"],
    ["https://bigbang-duel-prod.vercel.app", "Production"],
    ["https://www.bigbangduel.vercel.app", "Production"],
    ["http://duel-git-qa-team.vercel.app", "https"],
    ["https://example.com", "Vercel Preview"],
    ["https://user:pw@duel-git-qa-team.vercel.app", "credentials"],
  ])("rejects %s", (url, fragment) => {
    const problem = checkPreviewTarget(url);
    expect(problem).toContain(fragment);
    // The offending URL is never echoed in the message.
    if (url.trim()) expect(problem).not.toContain(url);
  });

  it("accepts a Vercel Preview URL and keeps only the origin", () => {
    expect(checkPreviewTarget(PREVIEW)).toBeNull();
    expect(parseConfig({ ...base, GAME_BASE_URL: `${PREVIEW}/menu?token=abc` }).baseUrl).toBe(PREVIEW);
  });

  it("fails before anything else when GAME_BASE_URL is missing", () => {
    expect(problemsOf({ ...base, GAME_BASE_URL: undefined })).toContain("GAME_BASE_URL is empty");
  });
});

describe("config validation", () => {
  it("parses defaults", () => {
    const c = parseConfig(base);
    expect(c).toMatchObject({
      headless: false,
      videoEnabled: false,
      traceEnabled: false,
      screenshotOnStep: true,
      scenarioTimeoutMs: 600_000,
    });
    expect(parseConfig({ ...base, QA_TRACE_ENABLED: "true" }).traceEnabled).toBe(true);
    expect(problemsOf({ ...base, QA_TRACE_ENABLED: "yes" })).toContain("QA_TRACE_ENABLED must be true or false");
    expect(c.devLogin.enabled).toBe(false);
  });

  it("reports missing credentials by variable name only", () => {
    const problems = problemsOf({ GAME_BASE_URL: PREVIEW });
    expect(problems).toEqual(
      expect.arrayContaining([
        "QA_ALPHA_EMAIL is required",
        "QA_ALPHA_PASSWORD is required",
        "QA_BRAVO_EMAIL is required",
        "QA_BRAVO_PASSWORD is required",
      ]),
    );
  });

  it("rejects identical Alpha and Bravo accounts", () => {
    expect(problemsOf({ ...base, QA_BRAVO_EMAIL: base.QA_ALPHA_EMAIL })).toContain(
      "QA_ALPHA_EMAIL and QA_BRAVO_EMAIL must be different accounts",
    );
  });

  it("rejects malformed flags and timeout without echoing values", () => {
    const problems = problemsOf({ ...base, QA_HEADLESS: "maybe", QA_SCENARIO_TIMEOUT_MS: "5" });
    expect(problems).toEqual(
      expect.arrayContaining(["QA_HEADLESS must be true or false", "QA_SCENARIO_TIMEOUT_MS must be an integer >= 10000"]),
    );
    expect(problems.join(" ")).not.toContain("maybe");
  });

  it("requires Dev Login names and secret only when enabled, and stops needing e-mail login", () => {
    expect(problemsOf({ GAME_BASE_URL: PREVIEW, QA_DEV_LOGIN_ENABLED: "true" })).toEqual(
      expect.arrayContaining([
        "QA_ALPHA_DEV_LOGIN_NAME is required",
        "QA_BRAVO_DEV_LOGIN_NAME is required",
        "QA_DEV_LOGIN_SECRET is required",
      ]),
    );
    const c = parseConfig({
      GAME_BASE_URL: PREVIEW,
      QA_DEV_LOGIN_ENABLED: "true",
      QA_DEV_LOGIN_SECRET: "dev-secret-value",
      QA_ALPHA_DEV_LOGIN_NAME: "Alpha QA",
      QA_BRAVO_DEV_LOGIN_NAME: "Bravo QA",
    });
    expect(c.devLogin).toEqual({ enabled: true, secret: "dev-secret-value" });
  });
});

describe("player isolation", () => {
  it("keeps Alpha and Bravo credentials separate", () => {
    const c = parseConfig(base);
    expect(c.players.alpha.email).toBe(base.QA_ALPHA_EMAIL);
    expect(c.players.bravo.email).toBe(base.QA_BRAVO_EMAIL);
    expect(c.players.alpha.password).not.toBe(c.players.bravo.password);
  });

  it("lists every secret for redaction, including the Preview origin", () => {
    const secrets = secretValues(parseConfig(base));
    for (const value of [PREVIEW, "duel-git-qa-team.vercel.app", base.QA_ALPHA_PASSWORD, base.QA_BRAVO_EMAIL]) {
      expect(secrets).toContain(value);
    }
  });
});
