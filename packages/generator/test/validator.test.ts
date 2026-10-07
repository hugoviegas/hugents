import { describe, expect, it } from "vitest";
import { MAX_SPEC_CHARS, validateSpec, type ReasonCode } from "../src/index.js";
import { GOOD_SPEC, manifest, wrap } from "./fixtures.js";

const codes = (spec: string): ReasonCode[] => validateSpec(spec, manifest).issues.map((i) => i.code);

describe("validateSpec", () => {
  it("accepts a well-formed generated spec", () => {
    expect(validateSpec(GOOD_SPEC, manifest)).toEqual({ ok: true, issues: [] });
  });

  const rejected: [string, string, ReasonCode][] = [
    ["a foreign import", wrap(``, `import { test, expect } from "@playwright/test";`), "disallowed-import"],
    ["a node import", wrap(``, `import { test, expect } from "hugents-seed";\nimport fs from "node:fs";`), "disallowed-import"],
    ["a namespace import", wrap(``, `import * as s from "hugents-seed";`), "disallowed-import"],
    ["a re-export from elsewhere", `${wrap(``)}export * from "node:fs";`, "disallowed-import"],
    ["a dynamic import", wrap(`await import("node:fs");`), "dynamic-code"],
    ["require", wrap(`const x = require("fs");`), "dynamic-code"],
    ["eval", wrap(`eval("1");`), "dynamic-code"],
    ["new Function", wrap(`new Function("return 1")();`), "dynamic-code"],
    ["an environment read", wrap(`const k = process.env.SECRET;`), "env-access"],
    ["a process spawn", wrap(`const cp = "child_process";`), "process-access"],
    ["a filesystem string", wrap(`const m = "node:fs";`), "filesystem-access"],
    ["fetch", wrap(`await fetch("/x");`), "network-access"],
    ["page.request", wrap(`await page.request.get("/x");`), "api-not-allowed"],
    ["page.route", wrap(`await page.route("**", (r) => r.abort());`), "network-access"],
    ["page.goto (its own URL)", wrap(`await page.goto("/somewhere");`), "network-access"],
    ["a hardcoded https URL", wrap(`const u = "https://other.example.test/x";`), "hardcoded-url"],
    ["a protocol-relative URL", wrap(`const u = "//other.example.test/x";`), "hardcoded-url"],
    ["a data URL", wrap(`const u = "data:text/html,x";`), "hardcoded-url"],
    ["page.locator", wrap(`await page.locator("#x").click();`), "locator-not-allowed"],
    ["getByPlaceholder", wrap(`await page.getByPlaceholder("x").fill("a");`), "locator-not-allowed"],
    ["a dynamic locator argument", wrap(`const n = "x";\nawait page.getByText(n).click();`), "locator-not-allowed"],
    ["evaluate", wrap(`await page.evaluate(() => 1);`), "api-not-allowed"],
    ["page.keyboard", wrap(`await page.keyboard.press("Enter");`), "api-not-allowed"],
    ["bracket access to dodge the allowlist", wrap(`await page["goto"]("/x");`), "api-not-allowed"],
    ["globalThis", wrap(`globalThis.x = 1;`), "api-not-allowed"],
    ["an e-mail address", wrap(`await page.getByLabel("Email").fill("someone@example.test");`), "secret-in-spec"],
    ["a token-like string", wrap(`await page.getByLabel("Key").fill("${"a1B2".repeat(10)}");`), "secret-in-spec"],
    ["a test without the seed fixture", `import { test } from "hugents-seed";\ntest("t", async () => {});\n`, "missing-seed-fixture"],
    ["a test that asks for a browser fixture", `import { test } from "hugents-seed";\ntest("t", async ({ page, browser }) => {});\n`, "missing-seed-fixture"],
    ["no tests at all", `import { test } from "hugents-seed";\n`, "missing-seed-fixture"],
    ["test not imported from the helper", `test("t", async ({ page }) => {});\n`, "missing-seed-fixture"],
    ["a syntax error", `import { test } from "hugents-seed";\ntest("t", async ({ page }) => {`, "syntax-error"],
    ["an oversized spec", wrap(`// ${"x".repeat(MAX_SPEC_CHARS)}`), "size-limit"],
  ];
  it.each(rejected)("rejects %s", (_name, spec, code) => {
    const result = validateSpec(spec, manifest);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain(code);
  });

  describe("forbiddenActions", () => {
    it.each([
      `await page.getByRole("button", { name: "Delete account" }).click();`,
      `await page.getByText("Purchase", { exact: true }).click();`,
      `await page.getByRole("button", { name: /sign out/i }).click();`,
      `const b = page.getByRole("button", { name: "Delete Account" });\nawait b.dblclick();`,
      `await page.getByTestId("purchase-button").first().click();`,
    ])("rejects %s", (body) => {
      expect(codes(wrap(body))).toContain("forbidden-action");
    });

    it("allows the same words in a non-action assertion", () => {
      expect(validateSpec(wrap(`await expect(page.getByText("Purchase")).toBeVisible();`), manifest).ok).toBe(true);
    });
  });

  it("never puts source text in an issue", () => {
    const result = validateSpec(wrap(`const u = "https://secret.example.test/x";`), manifest);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
